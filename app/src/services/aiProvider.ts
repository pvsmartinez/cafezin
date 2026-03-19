/**
 * Multi-provider AI streaming service — BYOK (Bring Your Own Key).
 *
 * Supported providers:
 *   copilot   — GitHub Copilot (OAuth device flow, existing auth)
 *   openai    — OpenAI API (sk-...)
 *   anthropic — Anthropic API (sk-ant-...)
 *   groq      — Groq API (gsk_...)
 *
 * User-level settings (provider choice + keys) are persisted in localStorage
 * and synced encrypted to Supabase via saveApiSecret — available on every device.
 * Workspace config can override the model via workspace.config.preferredModel.
 */

import type { ChatMessage } from '../types';
import { DEFAULT_MODEL } from '../types';
import { fetch } from '@tauri-apps/plugin-http';
import { resolveCopilotModelForChatCompletions, streamCopilotChat } from './copilot';
import type { CopilotModel } from '../types';

// ── Provider types ────────────────────────────────────────────────────────────

export type AIProviderType = 'copilot' | 'openai' | 'anthropic' | 'groq' | 'google';

export const PROVIDER_LABELS: Record<AIProviderType, string> = {
  copilot:   'GitHub Copilot',
  openai:    'OpenAI',
  anthropic: 'Anthropic (Claude)',
  groq:      'Groq',
  google:    'Google (Gemini)',
};

export const PROVIDER_MODELS: Record<AIProviderType, string[]> = {
  copilot:   [], // dynamically loaded from /models endpoint
  openai:    ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o3'],
  anthropic: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
  groq:      ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'meta-llama/llama-4-scout-17b-16e-instruct'],
  google:    ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
};

export const PROVIDER_DEFAULT_MODELS: Record<AIProviderType, string> = {
  copilot:   DEFAULT_MODEL,
  openai:    'gpt-4.1',
  anthropic: 'claude-sonnet-4-5',
  groq:      'llama-3.3-70b-versatile',
  google:    'gemini-2.5-flash',
};

// ── Storage keys ──────────────────────────────────────────────────────────────

const PROVIDER_STORAGE_KEY = 'cafezin-ai-provider';
const MODEL_STORAGE_KEY    = 'cafezin-ai-model'; // legacy key — used only for copilot
const MODEL_KEY_PREFIX     = 'cafezin-ai-model-'; // per-provider keys for BYOK

/** Storage key for each non-Copilot provider's API key. */
const PROVIDER_KEY_MAP: Record<Exclude<AIProviderType, 'copilot'>, string> = {
  openai:    'cafezin-openai-key',
  anthropic: 'cafezin-anthropic-key',
  groq:      'cafezin-groq-key',
  google:    'cafezin-google-key',
};

// ── Accessors ─────────────────────────────────────────────────────────────────

export function getActiveProvider(): AIProviderType {
  return (localStorage.getItem(PROVIDER_STORAGE_KEY) as AIProviderType) ?? 'copilot';
}

export function setActiveProvider(p: AIProviderType): void {
  localStorage.setItem(PROVIDER_STORAGE_KEY, p);
  window.dispatchEvent(new CustomEvent('cafezin-provider-changed', { detail: p }));
}

export function getActiveModel(): string {
  const provider = getActiveProvider();
  if (provider === 'copilot') {
    const stored = localStorage.getItem(MODEL_STORAGE_KEY) || PROVIDER_DEFAULT_MODELS['copilot'];
    return resolveCopilotModelForChatCompletions(stored);
  }
  return localStorage.getItem(MODEL_KEY_PREFIX + provider) || PROVIDER_DEFAULT_MODELS[provider];
}

export function setActiveModel(m: string): void {
  const provider = getActiveProvider();
  if (provider === 'copilot') {
    localStorage.setItem(MODEL_STORAGE_KEY, resolveCopilotModelForChatCompletions(m));
  } else {
    localStorage.setItem(MODEL_KEY_PREFIX + provider, m);
  }
}

/** Returns the stored API key for a non-Copilot provider. */
export function getProviderKey(p: Exclude<AIProviderType, 'copilot'>): string {
  return localStorage.getItem(PROVIDER_KEY_MAP[p]) ?? '';
}

/** True when the current provider has its required credential stored. */
export function isAIConfigured(): boolean {
  const p = getActiveProvider();
  if (p === 'copilot') {
    return !!localStorage.getItem('copilot-github-oauth-token') ||
      Object.keys(localStorage).some((key) => key.startsWith('copilot-github-oauth-token:'));
  }
  return !!getProviderKey(p);
}

// ── Internal streaming adapters ───────────────────────────────────────────────

/**
 * Stream using any OpenAI-compatible endpoint (OpenAI, Groq).
 * Parses SSE text/event-stream line-by-line.
 */
async function streamOpenAICompatible(
  url: string,
  apiKey: string,
  messages: ChatMessage[],
  model: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    if (signal?.aborted) return;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : m.content,
          ...(m.tool_calls      ? { tool_calls: m.tool_calls }           : {}),
          ...(m.tool_call_id    ? { tool_call_id: m.tool_call_id }       : {}),
          ...(m.name            ? { name: m.name }                       : {}),
        })),
        stream: true,
        max_tokens: 16384,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
        throw new Error(parsed?.error?.message ?? parsed?.message ?? `Erro ${response.status}`);
      } catch {
        throw new Error(`Erro ${response.status}: ${body.slice(0, 200)}`);
      }
    }

    const text = await response.text();
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') break;
      try {
        const chunk = JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string } }> };
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) onChunk(content);
      } catch { /* skip malformed SSE line */ }
    }
    onDone();
  } catch (e) {
    if ((e as Error).name === 'AbortError') { onDone(); return; }
    onError(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Stream using the Anthropic Messages API.
 * Handles `content_block_delta` SSE events with `text_delta` type.
 *
 * Key differences from OpenAI:
 *  - `system` is a top-level field, not a message
 *  - Messages only have `user` / `assistant` roles
 *  - SSE uses `event:` lines and `data:` lines with `content_block_delta`
 */
async function streamAnthropic(
  apiKey: string,
  messages: ChatMessage[],
  model: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    if (signal?.aborted) return;

    const systemMsg = messages.find((m) => m.role === 'system');
    const conversation = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: typeof m.content === 'string' ? m.content : m.content,
      }));

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        model,
        max_tokens: 16384,
        ...(systemMsg
          ? { system: typeof systemMsg.content === 'string' ? systemMsg.content : JSON.stringify(systemMsg.content) }
          : {}),
        messages: conversation,
        stream: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string } };
        throw new Error(parsed?.error?.message ?? `Erro Anthropic ${response.status}`);
      } catch {
        throw new Error(`Erro Anthropic ${response.status}: ${body.slice(0, 200)}`);
      }
    }

    const text = await response.text();
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      try {
        const event = JSON.parse(raw) as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
          onChunk(event.delta.text);
        }
      } catch { /* skip */ }
    }
    onDone();
  } catch (e) {
    if ((e as Error).name === 'AbortError') { onDone(); return; }
    onError(e instanceof Error ? e : new Error(String(e)));
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Stream a chat completion using the user's configured AI provider.
 *
 * Routes to:
 *  - GitHub Copilot  → existing `streamCopilotChat` (requires OAuth token)
 *  - OpenAI          → api.openai.com (requires API key)
 *  - Anthropic       → api.anthropic.com (requires API key, different format)
 *  - Groq            → api.groq.com (requires API key, OpenAI-compatible)
 *
 * Note: the full agent loop with workspace tools is only supported when
 * provider === 'copilot'. Other providers run plain streaming chat.
 *
 * @param model  Override model (e.g. workspace.config.preferredModel). Falls
 *               back to the user's stored model preference via getActiveModel().
 */
export async function streamChat(
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  model?: string,
  signal?: AbortSignal,
  /** GitHub OAuth client ID — only used when provider === 'copilot'. */
  oauthClientId?: string,
): Promise<void> {
  const provider = getActiveProvider();
  const resolvedModel = provider === 'copilot'
    ? resolveCopilotModelForChatCompletions(model || getActiveModel())
    : (model || getActiveModel());

  if (provider === 'copilot') {
    return streamCopilotChat(
      messages,
      onChunk,
      onDone,
      onError,
      resolvedModel as CopilotModel,
      undefined,
      signal,
      oauthClientId,
    );
  }

  const key = getProviderKey(provider);
  if (!key) {
    onError(new Error(
      `Chave de API para ${PROVIDER_LABELS[provider]} não configurada. ` +
      'Acesse Configurações > Assistente IA.',
    ));
    return;
  }

  if (provider === 'anthropic') {
    return streamAnthropic(key, messages, resolvedModel, onChunk, onDone, onError, signal);
  }

  if (provider === 'google') {
    // Google Gemini via OpenAI-compatible endpoint
    const url = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`;
    return streamOpenAICompatible(url, key, messages, resolvedModel, onChunk, onDone, onError, signal);
  }

  const url = provider === 'openai'
    ? 'https://api.openai.com/v1/chat/completions'
    : 'https://api.groq.com/openai/v1/chat/completions';

  return streamOpenAICompatible(url, key, messages, resolvedModel, onChunk, onDone, onError, signal);
}
