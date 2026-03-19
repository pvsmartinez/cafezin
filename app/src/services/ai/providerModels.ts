/**
 * Curated model catalog for BYOK providers (non-Copilot).
 *
 * Only models with verified, reliable tool/function-calling support are listed.
 * Vision capability is marked per model — used to enable/disable canvas tools.
 *
 * Favorites (the subset shown in the chat model picker) are stored per-provider
 * in localStorage as a JSON array of model IDs. Default = full catalog.
 */

import type { AIProviderType } from '../aiProvider';
import type { CopilotModelInfo } from '../../types';

export interface ProviderModelInfo {
  id: string;
  name: string;
  /** All models in this list support tools. Field kept for explicitness. */
  supportsTools: true;
  /** Whether the model accepts image/vision input. */
  supportsVision: boolean;
}

const VENDOR_LABELS: Record<Exclude<AIProviderType, 'copilot'>, string> = {
  openai:    'OpenAI',
  anthropic: 'Anthropic',
  groq:      'Groq',
  google:    'Google',
};

/**
 * Curated, tool-capable model catalog per provider.
 * Only models that reliably support function calling are listed.
 */
export const PROVIDER_CATALOG: Record<Exclude<AIProviderType, 'copilot'>, ProviderModelInfo[]> = {
  openai: [
    { id: 'gpt-4.1',      name: 'GPT-4.1',       supportsTools: true, supportsVision: true  },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini',  supportsTools: true, supportsVision: true  },
    { id: 'gpt-4.1-nano', name: 'GPT-4.1 nano',  supportsTools: true, supportsVision: true  },
    { id: 'gpt-4o',       name: 'GPT-4o',         supportsTools: true, supportsVision: true  },
    { id: 'gpt-4o-mini',  name: 'GPT-4o mini',    supportsTools: true, supportsVision: true  },
    { id: 'o4-mini',      name: 'o4 mini',         supportsTools: true, supportsVision: true  },
    { id: 'o3',           name: 'o3',              supportsTools: true, supportsVision: false },
  ],
  anthropic: [
    { id: 'claude-opus-4-5',   name: 'Claude Opus 4.5',   supportsTools: true, supportsVision: true },
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', supportsTools: true, supportsVision: true },
    { id: 'claude-haiku-4-5',  name: 'Claude Haiku 4.5',  supportsTools: true, supportsVision: true },
  ],
  groq: [
    { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick', supportsTools: true, supportsVision: true  },
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct',     name: 'Llama 4 Scout',    supportsTools: true, supportsVision: true  },
    { id: 'llama-3.3-70b-versatile',                       name: 'Llama 3.3 70B',    supportsTools: true, supportsVision: false },
    { id: 'moonshotai/kimi-k2-instruct',                   name: 'Kimi K2',           supportsTools: true, supportsVision: false },
  ],
  google: [
    { id: 'gemini-2.5-pro',   name: 'Gemini 2.5 Pro',   supportsTools: true, supportsVision: true },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', supportsTools: true, supportsVision: true },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', supportsTools: true, supportsVision: true },
  ],
};

// ── Favorites (localStorage) ──────────────────────────────────────────────────

const FAV_PREFIX = 'cafezin-fav-models-';

/**
 * Returns the user's favorite model IDs for a provider.
 * Defaults to all catalog models when no favorites have been saved.
 */
export function getFavoriteModelIds(provider: Exclude<AIProviderType, 'copilot'>): string[] {
  const raw = localStorage.getItem(FAV_PREFIX + provider);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as string[];
    } catch { /* fall through to default */ }
  }
  return PROVIDER_CATALOG[provider].map((m) => m.id);
}

/**
 * Saves favorites and dispatches `cafezin-provider-changed` so the model
 * picker in AIPanel refreshes immediately.
 */
export function setFavoriteModelIds(
  provider: Exclude<AIProviderType, 'copilot'>,
  ids: string[],
): void {
  localStorage.setItem(FAV_PREFIX + provider, JSON.stringify(ids));
  window.dispatchEvent(new CustomEvent('cafezin-provider-changed', { detail: provider }));
}

// ── Picker helpers ─────────────────────────────────────────────────────────────

function resolveModelInfo(id: string, catalog: ProviderModelInfo[]): ProviderModelInfo {
  return (
    catalog.find((m) => m.id === id) ?? {
      id,
      name: id,
      supportsTools: true,
      supportsVision: true, // optimistic default for custom IDs
    }
  );
}

/**
 * Returns the model list for the chat picker:
 * favorites if set, otherwise the full catalog.
 */
export function getProviderModelsForPicker(
  provider: Exclude<AIProviderType, 'copilot'>,
): CopilotModelInfo[] {
  const favIds = getFavoriteModelIds(provider);
  const catalog = PROVIDER_CATALOG[provider] ?? [];
  const vendor = VENDOR_LABELS[provider];

  return favIds.map((id) => {
    const info = resolveModelInfo(id, catalog);
    return {
      id: info.id,
      name: info.name,
      multiplier: 1,
      isPremium: false,
      vendor,
      supportsVision: info.supportsVision,
    } satisfies CopilotModelInfo;
  });
}

// ── Vision capability ─────────────────────────────────────────────────────────

/**
 * Returns true when the given model accepts image/vision input.
 * Used by `runProviderAgent` to decide whether canvas screenshot tools are active.
 */
export function providerModelSupportsVision(provider: string, modelId: string): boolean {
  if (provider === 'copilot') {
    // Copilot's own logic: o-series reasoning models don't accept images
    return !/^o\d/.test(modelId);
  }
  const catalog = PROVIDER_CATALOG[provider as Exclude<AIProviderType, 'copilot'>];
  const found = catalog?.find((m) => m.id === modelId);
  if (found) return found.supportsVision;
  // Custom / unknown model: assume vision-capable unless it's an o-series pattern
  return !/^o\d/.test(modelId);
}
