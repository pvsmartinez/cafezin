/**
 * Provider model catalogs for BYOK providers (non-Copilot).
 *
 * We keep a small local fallback catalog so the app works offline, but allow
 * the user to refresh the selected provider against its own models endpoint.
 * Refreshed catalogs are cached in localStorage and immediately propagated to
 * the chat model picker.
 */

import { fetch } from '@tauri-apps/plugin-http';
import type { AIProviderType } from '../aiProvider';
import { getCustomEndpoint, getProviderKey } from '../aiProvider';
import type { CopilotModelInfo } from '../../types';
import { SK } from '../storageKeys';

type RefreshableProvider = Exclude<AIProviderType, 'copilot'>;
type ListedProvider = Exclude<AIProviderType, 'copilot' | 'custom'>;

export interface ProviderModelInfo {
  id: string;
  name: string;
  /** All models in this list are intended for chat/tool usage. */
  supportsTools: true;
  /** Whether the model accepts image/vision input. */
  supportsVision: boolean;
}

interface ProviderCatalogMeta {
  updatedAt: string;
  source: 'fallback' | 'provider-api';
}

type ProviderCatalogStore = Partial<Record<RefreshableProvider, ProviderModelInfo[]>>;
type ProviderCatalogMetaStore = Partial<Record<RefreshableProvider, ProviderCatalogMeta>>;

const VENDOR_LABELS: Record<RefreshableProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  groq: 'Groq',
  google: 'Google',
  custom: 'Custom',
};

const PROVIDER_MODEL_STORAGE_KEY = 'cafezin-provider-model-catalog-v1';
const PROVIDER_MODEL_META_STORAGE_KEY = 'cafezin-provider-model-catalog-meta-v1';

export const PROVIDER_MODELS_CHANGED_EVENT = 'cafezin-provider-models-changed';

/**
 * Conservative offline fallback catalog.
 * This is only used before the user refreshes from the provider API.
 */
export const DEFAULT_PROVIDER_CATALOG: Record<RefreshableProvider, ProviderModelInfo[]> = {
  openai: [
    { id: 'gpt-5',         name: 'GPT-5',         supportsTools: true, supportsVision: true  },
    { id: 'gpt-5-mini',    name: 'GPT-5 mini',    supportsTools: true, supportsVision: true  },
    { id: 'gpt-5-nano',    name: 'GPT-5 nano',    supportsTools: true, supportsVision: true  },
    { id: 'gpt-4.1',       name: 'GPT-4.1',       supportsTools: true, supportsVision: true  },
    { id: 'gpt-4.1-mini',  name: 'GPT-4.1 mini',  supportsTools: true, supportsVision: true  },
    { id: 'gpt-4o',        name: 'GPT-4o',        supportsTools: true, supportsVision: true  },
    { id: 'gpt-4o-mini',   name: 'GPT-4o mini',   supportsTools: true, supportsVision: true  },
    { id: 'o4-mini',       name: 'o4 mini',       supportsTools: true, supportsVision: false },
    { id: 'o3',            name: 'o3',            supportsTools: true, supportsVision: false },
  ],
  anthropic: [
    { id: 'claude-opus-4-1',     name: 'Claude Opus 4.1',     supportsTools: true, supportsVision: true },
    { id: 'claude-opus-4',       name: 'Claude Opus 4',       supportsTools: true, supportsVision: true },
    { id: 'claude-sonnet-4',     name: 'Claude Sonnet 4',     supportsTools: true, supportsVision: true },
    { id: 'claude-3-7-sonnet',   name: 'Claude 3.7 Sonnet',   supportsTools: true, supportsVision: true },
    { id: 'claude-3-5-haiku',    name: 'Claude 3.5 Haiku',    supportsTools: true, supportsVision: true },
  ],
  groq: [
    { id: 'moonshotai/kimi-k2-instruct',                   name: 'Kimi K2',           supportsTools: true, supportsVision: false },
    { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick',  supportsTools: true, supportsVision: true  },
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct',     name: 'Llama 4 Scout',     supportsTools: true, supportsVision: true  },
    { id: 'openai/gpt-oss-120b',                           name: 'GPT-OSS 120B',      supportsTools: true, supportsVision: false },
    { id: 'llama-3.3-70b-versatile',                       name: 'Llama 3.3 70B',     supportsTools: true, supportsVision: false },
  ],
  google: [
    { id: 'gemini-2.5-pro',        name: 'Gemini 2.5 Pro',        supportsTools: true, supportsVision: true },
    { id: 'gemini-2.5-flash',      name: 'Gemini 2.5 Flash',      supportsTools: true, supportsVision: true },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite', supportsTools: true, supportsVision: true },
    { id: 'gemini-2.0-flash',      name: 'Gemini 2.0 Flash',      supportsTools: true, supportsVision: true },
  ],
  custom: [],
};

function readCatalogStore(): ProviderCatalogStore {
  try {
    const raw = localStorage.getItem(PROVIDER_MODEL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as ProviderCatalogStore : {};
  } catch {
    return {};
  }
}

function writeCatalogStore(store: ProviderCatalogStore): void {
  localStorage.setItem(PROVIDER_MODEL_STORAGE_KEY, JSON.stringify(store));
}

function readCatalogMetaStore(): ProviderCatalogMetaStore {
  try {
    const raw = localStorage.getItem(PROVIDER_MODEL_META_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as ProviderCatalogMetaStore : {};
  } catch {
    return {};
  }
}

function writeCatalogMetaStore(store: ProviderCatalogMetaStore): void {
  localStorage.setItem(PROVIDER_MODEL_META_STORAGE_KEY, JSON.stringify(store));
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function prettifyModelName(id: string): string {
  return id
    .split('/')
    .pop()
    ?.replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase()) ?? id;
}

function normalizeCatalog(models: ProviderModelInfo[]): ProviderModelInfo[] {
  const deduped = new Map<string, ProviderModelInfo>();
  for (const model of models) {
    const id = model.id.trim();
    if (!id) continue;
    deduped.set(id, {
      id,
      name: model.name.trim() || prettifyModelName(id),
      supportsTools: true,
      supportsVision: model.supportsVision,
    });
  }
  return [...deduped.values()].sort((a, b) => naturalCompare(a.name, b.name));
}

function persistCatalog(
  provider: RefreshableProvider,
  models: ProviderModelInfo[],
  source: ProviderCatalogMeta['source'],
): ProviderModelInfo[] {
  const normalized = normalizeCatalog(models);
  const store = readCatalogStore();
  store[provider] = normalized;
  writeCatalogStore(store);

  const metaStore = readCatalogMetaStore();
  metaStore[provider] = {
    updatedAt: new Date().toISOString(),
    source,
  };
  writeCatalogMetaStore(metaStore);

  window.dispatchEvent(new CustomEvent(PROVIDER_MODELS_CHANGED_EVENT, { detail: provider }));
  window.dispatchEvent(new CustomEvent('cafezin-provider-changed', { detail: provider }));
  return normalized;
}

export function getProviderCatalog(provider: RefreshableProvider): ProviderModelInfo[] {
  const stored = readCatalogStore()[provider];
  if (Array.isArray(stored) && stored.length > 0) return normalizeCatalog(stored);
  return normalizeCatalog(DEFAULT_PROVIDER_CATALOG[provider] ?? []);
}

export function getProviderCatalogMeta(provider: RefreshableProvider): ProviderCatalogMeta | null {
  return readCatalogMetaStore()[provider] ?? null;
}

// ── Favorites (localStorage) ──────────────────────────────────────────────────

const FAV_PREFIX = 'cafezin-fav-models-';

/**
 * Returns the user's favorite model IDs for a provider.
 * Defaults to all catalog models when no favorites have been saved.
 */
export function getFavoriteModelIds(provider: ListedProvider): string[] {
  const raw = localStorage.getItem(FAV_PREFIX + provider);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const filtered = parsed
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
        if (filtered.length !== parsed.length) {
          localStorage.setItem(FAV_PREFIX + provider, JSON.stringify(filtered));
        }
        if (filtered.length > 0) return filtered;
      }
    } catch { /* fall through to default */ }
  }
  return getProviderCatalog(provider).map((m) => m.id);
}

/**
 * Saves favorites and dispatches `cafezin-provider-changed` so the model
 * picker in AIPanel refreshes immediately.
 */
export function setFavoriteModelIds(provider: ListedProvider, ids: string[]): void {
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
      supportsVision: true,
    }
  );
}

/**
 * Returns the model list for the chat picker:
 * favorites if set, otherwise the full catalog.
 *
 * For the 'custom' provider the catalog is always empty — we return the
 * configured model ID (if any) as a single option so the chat picker
 * has something to render.
 */
export function getProviderModelsForPicker(provider: RefreshableProvider): CopilotModelInfo[] {
  if (provider === 'custom') {
    const modelId = localStorage.getItem(SK.AI_MODEL_CUSTOM) ?? '';
    if (!modelId) return [];
    return [{
      id: modelId,
      name: modelId,
      multiplier: 1,
      isPremium: false,
      vendor: 'Custom',
      supportsVision: false,
    }];
  }

  const favIds = getFavoriteModelIds(provider);
  const catalog = getProviderCatalog(provider);
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

// ── Remote refresh ────────────────────────────────────────────────────────────

interface OpenAIModelResponse {
  data?: Array<{ id?: string }>;
}

interface AnthropicModelResponse {
  data?: Array<{ id?: string; display_name?: string }>;
}

interface GoogleModelResponse {
  models?: Array<{
    name?: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
  }>;
}

function isLikelyOpenAIChatModel(id: string): boolean {
  if (!id || id.startsWith('ft:')) return false;
  if (/(audio|realtime|transcribe|transcription|tts|image|embedding|moderation|whisper|search|computer-use)/i.test(id)) {
    return false;
  }
  return /^(gpt-|o\d|chatgpt-|codex-|omni-)/i.test(id);
}

function isLikelyGroqChatModel(id: string): boolean {
  if (!id || /(embedding|whisper|tts|transcribe|transcription|moderation|guard|playai-tts)/i.test(id)) {
    return false;
  }
  return !/preview-(?:image|audio)/i.test(id);
}

function supportsVisionHeuristic(provider: ListedProvider, id: string): boolean {
  if (/^o\d/i.test(id)) return false;
  if (provider === 'openai') return true;
  if (provider === 'anthropic') return true;
  if (provider === 'google') return !/(tts|embedding)/i.test(id);
  return /(llama-4|vision|vl|gemini|claude|gpt-4o)/i.test(id);
}

async function refreshOpenAIModels(apiKey: string): Promise<ProviderModelInfo[]> {
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`OpenAI respondeu HTTP ${res.status}`);
  const json = await res.json() as OpenAIModelResponse;
  return normalizeCatalog(
    (json.data ?? [])
      .map((item) => item.id?.trim() ?? '')
      .filter(isLikelyOpenAIChatModel)
      .map((id) => ({
        id,
        name: prettifyModelName(id),
        supportsTools: true as const,
        supportsVision: supportsVisionHeuristic('openai', id),
      })),
  );
}

async function refreshAnthropicModels(apiKey: string): Promise<ProviderModelInfo[]> {
  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Anthropic respondeu HTTP ${res.status}`);
  const json = await res.json() as AnthropicModelResponse;
  return normalizeCatalog(
    (json.data ?? [])
      .filter((item) => !!item.id?.startsWith('claude-'))
      .map((item) => ({
        id: item.id!.trim(),
        name: item.display_name?.trim() || prettifyModelName(item.id!.trim()),
        supportsTools: true as const,
        supportsVision: true,
      })),
  );
}

async function refreshGroqModels(apiKey: string): Promise<ProviderModelInfo[]> {
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Groq respondeu HTTP ${res.status}`);
  const json = await res.json() as OpenAIModelResponse;
  return normalizeCatalog(
    (json.data ?? [])
      .map((item) => item.id?.trim() ?? '')
      .filter(isLikelyGroqChatModel)
      .map((id) => ({
        id,
        name: prettifyModelName(id),
        supportsTools: true as const,
        supportsVision: supportsVisionHeuristic('groq', id),
      })),
  );
}

async function refreshGoogleModels(apiKey: string): Promise<ProviderModelInfo[]> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, {
    headers: {
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Google respondeu HTTP ${res.status}`);
  const json = await res.json() as GoogleModelResponse;
  return normalizeCatalog(
    (json.models ?? [])
      .map((item) => {
        const id = item.name?.replace(/^models\//, '').trim() ?? '';
        return { id, item };
      })
      .filter(({ id, item }) =>
        !!id &&
        id.startsWith('gemini') &&
        !/(embedding|imagen|veo|tts)/i.test(id) &&
        (item.supportedGenerationMethods ?? []).some((method) => /generateContent/i.test(method)),
      )
      .map(({ id, item }) => ({
        id,
        name: item.displayName?.trim() || prettifyModelName(id),
        supportsTools: true as const,
        supportsVision: supportsVisionHeuristic('google', id),
      })),
  );
}

async function refreshCustomModels(endpoint: string, apiKey: string): Promise<ProviderModelInfo[]> {
  const normalized = endpoint.replace(/\/+$/, '');
  if (!normalized) throw new Error('Servidor customizado não configurado.');
  const url = normalized.endsWith('/models') ? normalized : `${normalized}/models`;
  const res = await fetch(url, {
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Servidor customizado respondeu HTTP ${res.status}`);
  const json = await res.json() as OpenAIModelResponse;
  return normalizeCatalog(
    (json.data ?? [])
      .map((item) => item.id?.trim() ?? '')
      .filter(Boolean)
      .map((id) => ({
        id,
        name: prettifyModelName(id),
        supportsTools: true as const,
        supportsVision: !/^o\d/i.test(id),
      })),
  );
}

export async function refreshProviderCatalog(
  provider: RefreshableProvider,
  options?: { apiKey?: string; endpoint?: string },
): Promise<ProviderModelInfo[]> {
  let models: ProviderModelInfo[] = [];

  if (provider === 'openai') {
    const apiKey = options?.apiKey?.trim() || getProviderKey('openai');
    if (!apiKey) throw new Error('Chave da OpenAI não configurada.');
    models = await refreshOpenAIModels(apiKey);
  } else if (provider === 'anthropic') {
    const apiKey = options?.apiKey?.trim() || getProviderKey('anthropic');
    if (!apiKey) throw new Error('Chave da Anthropic não configurada.');
    models = await refreshAnthropicModels(apiKey);
  } else if (provider === 'groq') {
    const apiKey = options?.apiKey?.trim() || getProviderKey('groq');
    if (!apiKey) throw new Error('Chave da Groq não configurada.');
    models = await refreshGroqModels(apiKey);
  } else if (provider === 'google') {
    const apiKey = options?.apiKey?.trim() || getProviderKey('google');
    if (!apiKey) throw new Error('Chave do Google não configurada.');
    models = await refreshGoogleModels(apiKey);
  } else {
    const endpoint = options?.endpoint?.trim() || getCustomEndpoint();
    const apiKey = options?.apiKey?.trim() || getProviderKey('custom');
    models = await refreshCustomModels(endpoint, apiKey);
  }

  if (models.length === 0) {
    throw new Error('O provider respondeu, mas não retornou modelos compatíveis para o chat.');
  }

  return persistCatalog(provider, models, 'provider-api');
}

// ── Vision capability ─────────────────────────────────────────────────────────

/**
 * Returns true when the given model accepts image/vision input.
 * Used by `runProviderAgent` to decide whether canvas screenshot tools are active.
 */
export function providerModelSupportsVision(provider: string, modelId: string): boolean {
  if (provider === 'copilot') {
    return !/^o\d/.test(modelId);
  }
  if (provider === 'custom') {
    const customCatalog = getProviderCatalog('custom');
    const customModel = customCatalog.find((m) => m.id === modelId);
    if (customModel) return customModel.supportsVision;
    return false;
  }
  const catalog = getProviderCatalog(provider as ListedProvider);
  const found = catalog.find((m) => m.id === modelId);
  if (found) return found.supportsVision;
  return !/^o\d/.test(modelId);
}
