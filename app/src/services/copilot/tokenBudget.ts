import type { ChatMessage, CopilotModel } from '../../types';

// ── Interfaces ────────────────────────────────────────────────────────────────

interface ModelTokenMetadata {
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  source: 'api' | 'heuristic';
}

export interface ModelTokenBudgets {
  contextWindow: number;
  chatBudget: number;
  compressBudget: number;
  maxOutputTokens?: number;
  source: 'api' | 'heuristic';
}

// ── Internal state ────────────────────────────────────────────────────────────

export const MODEL_TOKEN_METADATA = new Map<string, ModelTokenMetadata>();

const MIN_CHAT_BUDGET = 48_000;
const MAX_CHAT_BUDGET = 180_000;
const MIN_COMPRESS_BUDGET = 64_000;
const MAX_COMPRESS_BUDGET = 220_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function readPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function firstNumericField(raw: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = readPositiveNumber(raw[key]);
    if (value) return value;
  }
  return undefined;
}

export function inferContextWindow(model: string): number {
  const id = model.toLowerCase();
  if (/gemini-3(?:\.1)?-pro|gemini-2\.5-pro/.test(id)) return 320_000;
  if (/gemini-3-flash|gemini-2\.5-flash/.test(id)) return 220_000;
  if (/claude-.*opus/.test(id)) return 180_000;
  if (/claude-.*sonnet/.test(id)) return 160_000;
  if (/claude-.*haiku/.test(id)) return 120_000;
  if (/^o\d|codex|gpt-5/.test(id)) return 128_000;
  if (/gpt-4\.1|gpt-4o|grok/.test(id)) return 128_000;
  return 128_000;
}

/** Parses token metadata from a raw model object and caches it. */
export function registerModelTokenMetadata(raw: Record<string, unknown> & { id: string }): ModelTokenMetadata | null {
  const contextWindow = firstNumericField(raw, [
    'context_window', 'contextWindow', 'max_input_tokens', 'maxInputTokens',
    'input_token_limit', 'prompt_token_limit', 'max_prompt_tokens',
  ]);
  const maxInputTokens = firstNumericField(raw, [
    'max_input_tokens', 'maxInputTokens', 'input_token_limit',
    'prompt_token_limit', 'max_prompt_tokens',
  ]);
  const maxOutputTokens = firstNumericField(raw, [
    'max_output_tokens', 'maxOutputTokens', 'output_token_limit',
    'completion_token_limit', 'max_completion_tokens',
  ]);

  if (!contextWindow && !maxInputTokens && !maxOutputTokens) return null;

  const meta: ModelTokenMetadata = {
    contextWindow: contextWindow ?? maxInputTokens,
    maxInputTokens,
    maxOutputTokens,
    source: 'api',
  };
  MODEL_TOKEN_METADATA.set(raw.id, meta);
  return meta;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getModelTokenBudgets(model: CopilotModel): ModelTokenBudgets {
  const discovered = MODEL_TOKEN_METADATA.get(model);
  const contextWindow = discovered?.contextWindow ?? discovered?.maxInputTokens ?? inferContextWindow(model);
  const source = discovered?.source ?? 'heuristic';

  const rawChatBudget = Math.min(Math.floor(contextWindow * 0.62), contextWindow - 36_000);
  const chatBudget = Math.max(MIN_CHAT_BUDGET, Math.min(MAX_CHAT_BUDGET, rawChatBudget));

  const rawCompressBudget = Math.min(Math.floor(contextWindow * 0.78), contextWindow - 24_000);
  const compressBudget = Math.max(
    Math.max(chatBudget + 12_000, MIN_COMPRESS_BUDGET),
    Math.min(MAX_COMPRESS_BUDGET, rawCompressBudget),
  );

  return {
    contextWindow,
    chatBudget,
    compressBudget,
    maxOutputTokens: discovered?.maxOutputTokens,
    source,
  };
}

/**
 * Rough token estimate: 1 token ≈ 4 characters of JSON-serialized content.
 * Base64 images are counted at their actual size (they DO consume context tokens).
 */
export function estimateTokens(messages: ChatMessage[]): number {
  return Math.ceil(
    messages.reduce((sum, m) => {
      const raw = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return sum + raw.length / 4;
    }, 0),
  );
}

/** Return a copy of the messages array with base64 image blobs removed (for safe log storage). */
export function stripBase64ForLog(messages: ChatMessage[]): object[] {
  return messages.map((m) => {
    if (typeof m.content === 'string') {
      return { ...m, content: m.content.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '[base64 image stripped]') };
    }
    if (Array.isArray(m.content)) {
      return {
        ...m,
        content: (m.content as any[]).map((p: any) =>
          p.type === 'image_url' ? { type: 'image_url', image_url: { url: '[stripped]' } } : p,
        ),
      };
    }
    return m;
  });
}

/**
 * Pick the most relevant user instruction to keep when compressing context.
 * Preserving the very first prompt verbatim can anchor the model to stale intent
 * even after the conversation has moved on — so we prefer recent user turns.
 */
export function getCompressionAnchorUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user' || typeof msg.content !== 'string') continue;
    const text = msg.content.trim();
    if (!text) continue;
    if (text.startsWith('[SESSION SUMMARY')) continue;
    return text;
  }

  const fallback = messages.find((m) => m.role === 'user' && typeof m.content === 'string');
  return typeof fallback?.content === 'string' && fallback.content.trim()
    ? fallback.content.trim()
    : '(current user request not recoverable)';
}
