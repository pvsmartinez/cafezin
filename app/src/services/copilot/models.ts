import { fetch } from '@tauri-apps/plugin-http';
import type { CopilotModel, CopilotModelInfo } from '../../types';
import { FALLBACK_MODELS, DEFAULT_MODEL } from '../../types';
import {
  COPILOT_API_URL,
  EDITOR_HEADERS,
  BLOCKED_PREFIXES,
  BLOCKED_EXACT,
  CHAT_COMPLETIONS_BLOCKED_MODELS,
} from './constants';
import { getCopilotSessionToken } from './auth';
import { registerModelTokenMetadata } from './tokenBudget';

// ── Chat completions compatibility ────────────────────────────────────────────

export function isChatCompletionsCompatibleModel(modelId: string): boolean {
  return !!modelId && !CHAT_COMPLETIONS_BLOCKED_MODELS.has(modelId);
}

export function filterChatCompletionsCompatibleModels<T extends { id: string }>(models: T[]): T[] {
  return models.filter((model) => isChatCompletionsCompatibleModel(model.id));
}

export function resolveCopilotModelForChatCompletions(
  requestedModel: string | null | undefined,
  availableModels?: Array<{ id: string }>,
): CopilotModel {
  if (requestedModel && isChatCompletionsCompatibleModel(requestedModel)) {
    return requestedModel as CopilotModel;
  }

  const compatibleAvailable = filterChatCompletionsCompatibleModels(availableModels ?? []);
  const preferred = compatibleAvailable.find((model) => model.id === DEFAULT_MODEL) ?? compatibleAvailable[0];
  if (preferred) return preferred.id as CopilotModel;

  const compatibleFallback = filterChatCompletionsCompatibleModels(FALLBACK_MODELS);
  const fallback = compatibleFallback.find((model) => model.id === DEFAULT_MODEL) ?? compatibleFallback[0];
  return (fallback?.id ?? DEFAULT_MODEL) as CopilotModel;
}

// ── Vision & API params ───────────────────────────────────────────────────────

/**
 * OpenAI o-series reasoning models (o1, o3, o3-mini, o4-mini, …) do not
 * accept image_url content — the API returns 400. Everything else supports vision.
 */
export function modelSupportsVision(modelId: string): boolean {
  return !/^o\d/.test(modelId);
}

/**
 * Returns the model-specific API body parameters for completions.
 * o-series must omit `temperature` and use `max_completion_tokens` instead of `max_tokens`.
 */
export function modelApiParams(
  model: CopilotModel,
  temperature: number,
  maxTokens: number,
): { temperature?: number; max_tokens?: number; max_completion_tokens?: number } {
  if (/^o\d/.test(model)) {
    return { max_completion_tokens: maxTokens };
  }
  return { temperature, max_tokens: maxTokens };
}

// ── Model filtering ───────────────────────────────────────────────────────────

export function isBlockedModel(id: string): boolean {
  if (BLOCKED_EXACT.has(id)) return true;
  return BLOCKED_PREFIXES.some((p) => id.startsWith(p));
}

/**
 * Derive a "family key" used for deduplication.
 * Strips trailing minor-version segments so multiple patch/minor releases of
 * the same model family collapse into one entry (keeping the latest).
 */
export function familyKey(id: string): string {
  let key = id.replace(/-\d{8}$/, '');
  key = key.replace(/-(\d+)$/, '');
  return key;
}

// ── Model discovery ───────────────────────────────────────────────────────────

interface RawModel {
  id: string;
  name?: string;
  billing_multiplier?: number;
  multiplier?: number;
  vendor?: string;
  capabilities?: { family?: string };
  context_window?: number;
  contextWindow?: number;
  max_input_tokens?: number;
  maxInputTokens?: number;
  max_output_tokens?: number;
  maxOutputTokens?: number;
  input_token_limit?: number;
  output_token_limit?: number;
  prompt_token_limit?: number;
  completion_token_limit?: number;
  max_prompt_tokens?: number;
  max_completion_tokens?: number;
}

/** Fetches available models from the GitHub Copilot /models endpoint. */
export async function fetchCopilotModels(oauthClientId?: string): Promise<CopilotModelInfo[]> {
  try {
    const sessionToken = await getCopilotSessionToken(oauthClientId);
    const res = await fetch('https://api.githubcopilot.com/models', {
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'Content-Type': 'application/json',
        ...EDITOR_HEADERS,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as { data?: RawModel[] };
    const raw: RawModel[] = json.data ?? [];

    const mapped: CopilotModelInfo[] = raw
      .filter((m) =>
        m.id &&
        !m.id.includes('embedding') &&
        !m.id.includes('whisper') &&
        !isBlockedModel(m.id),
      )
      .map((m) => {
        const mult = m.billing_multiplier ?? m.multiplier ?? 1;
        const tokenMeta = registerModelTokenMetadata(m as Record<string, unknown> & { id: string });
        return {
          id: m.id,
          name: m.name ?? m.id,
          multiplier: mult,
          isPremium: mult > 1,
          vendor: m.vendor,
          supportsVision: modelSupportsVision(m.id),
          ...(tokenMeta?.contextWindow ? { contextWindow: tokenMeta.contextWindow } : {}),
          ...(tokenMeta?.maxInputTokens ? { maxInputTokens: tokenMeta.maxInputTokens } : {}),
          ...(tokenMeta?.maxOutputTokens ? { maxOutputTokens: tokenMeta.maxOutputTokens } : {}),
        };
      });

    // Deduplicate by family: keep the model with the highest numeric version
    function versionScore(id: string): number[] {
      return id.split(/[^\d]+/).filter(Boolean).map(Number);
    }
    function newerVersion(a: string, b: string): boolean {
      const va = versionScore(a);
      const vb = versionScore(b);
      for (let i = 0; i < Math.max(va.length, vb.length); i++) {
        const diff = (va[i] ?? 0) - (vb[i] ?? 0);
        if (diff !== 0) return diff > 0;
      }
      return false;
    }
    const byFamily = new Map<string, CopilotModelInfo>();
    for (const m of filterChatCompletionsCompatibleModels(mapped)) {
      const key = familyKey(m.id);
      const existing = byFamily.get(key);
      if (!existing || newerVersion(m.id, existing.id)) {
        byFamily.set(key, m);
      }
    }

    const models = [...byFamily.values()]
      .sort((a, b) => a.multiplier - b.multiplier || a.name.localeCompare(b.name));

    return models.length > 0 ? models : FALLBACK_MODELS;
  } catch {
    return FALLBACK_MODELS;
  }
}

// Re-export for use within this sub-module directory
export { COPILOT_API_URL };
