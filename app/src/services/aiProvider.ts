/**
 * Multi-provider AI streaming service — BYOK (Bring Your Own Key).
 *
 * Supported providers:
 *   copilot   — GitHub Copilot (OAuth device flow, existing auth)
 *   openai    — OpenAI API (sk-...)
 *   anthropic — Anthropic API (sk-ant-...)
 *   groq      — Groq API (gsk_...)
 *   google    — Google Gemini (AIza...)
 *   custom    — Any OpenAI-compatible server (Ollama, LM Studio, OpenRouter, etc.)
 *
 * User-level settings (provider choice + keys) are persisted in localStorage
 * and synced encrypted to Supabase via saveApiSecret — available on every device.
 * Exception: custom endpoint URL and model ID are localStorage-only (privacy).
 * Workspace config can override the model via workspace.config.preferredModel.
 */

import type { ChatMessage } from '../types';
import { DEFAULT_MODEL } from '../types';
import { fetch } from '@tauri-apps/plugin-http';
import { resolveCopilotModelForChatCompletions, streamCopilotChat } from './copilot';
import type { CopilotModel } from '../types';

// ── Provider types ────────────────────────────────────────────────────────────

export type AIProviderType = 'copilot' | 'cafezin' | 'openai' | 'anthropic' | 'groq' | 'google' | 'custom';

export const PROVIDER_LABELS: Record<AIProviderType, string> = {
  copilot:   'GitHub Copilot',
  cafezin:   'Cafezin IA',
  openai:    'OpenAI',
  anthropic: 'Anthropic (Claude)',
  groq:      'Groq',
  google:    'Google (Gemini)',
  custom:    'Custom / Local',
};

export const PROVIDER_SHORT_LABELS: Record<AIProviderType, string> = {
  copilot:   'Copilot',
  cafezin:   'Cafezin IA',
  openai:    'OpenAI',
  anthropic: 'Claude',
  groq:      'Groq',
  google:    'Gemini',
  custom:    'Local',
};

export const PROVIDER_MODELS: Record<AIProviderType, string[]> = {
  copilot:   [], // dynamically loaded from /models endpoint
  cafezin:   [], // models loaded from CAFEZIN_MANAGED_MODELS catalog
  openai:    ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o3'],
  anthropic: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
  groq:      ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'meta-llama/llama-4-scout-17b-16e-instruct'],
  google:    ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  custom:    [], // model ID is typed freely by the user
};

export const PROVIDER_DEFAULT_MODELS: Record<AIProviderType, string> = {
  copilot:   DEFAULT_MODEL,
  cafezin:   'google/gemini-2.0-flash', // cheapest model — available on all tiers
  openai:    'gpt-4.1',
  anthropic: 'claude-sonnet-4-5',
  groq:      'llama-3.3-70b-versatile',
  google:    'gemini-2.5-flash',
  custom:    '',
};

/**
 * Managed AI models available via the Cafezin proxy (OpenRouter backend).
 *
 * consumptionRate: estimated prompts consumed per $1 of budget, normalized so
 * that 1.0 = the standard-tier baseline budget. Shown in the UI as
 * a relative multiplier for lighter/heavier models.
 *
 * Tiers: 'basic' = only basic-tier models; 'all' = available to standard+pro.
 */
export interface CafezinManagedModel {
  id: string;           // OpenRouter model ID
  name: string;         // Display name
  vendor: string;
  supportsVision: boolean;
  /** Consumption multiplier relative to standard baseline (1.0 = normal speed). Higher = burns more budget. */
  consumptionRate: number;
  /** Minimum tier required to use this model. */
  minTier: 'basic' | 'standard' | 'pro';
}

export const CAFEZIN_MANAGED_MODELS: CafezinManagedModel[] = [
  // ── Basic tier models (budget-friendly) ────────────────────────────────
  { id: 'google/gemini-2.0-flash',              name: 'Gemini 2.0 Flash',        vendor: 'Google',    supportsVision: true,  consumptionRate: 0.5,  minTier: 'basic'    },
  { id: 'google/gemini-2.5-flash',              name: 'Gemini 2.5 Flash',        vendor: 'Google',    supportsVision: true,  consumptionRate: 0.5,  minTier: 'basic'    },
  { id: 'meta-llama/llama-3.3-70b-instruct',    name: 'Llama 3.3 70B',           vendor: 'Meta',      supportsVision: false, consumptionRate: 0.5,  minTier: 'basic'    },
  { id: 'meta-llama/llama-4-scout',             name: 'Llama 4 Scout',           vendor: 'Meta',      supportsVision: true,  consumptionRate: 0.5,  minTier: 'basic'    },
  { id: 'deepseek/deepseek-chat-v3-0324',       name: 'DeepSeek Chat V3',        vendor: 'DeepSeek',  supportsVision: false, consumptionRate: 0.5,  minTier: 'basic'    },
  { id: 'mistralai/mistral-small-3.2',          name: 'Mistral Small 3.2',       vendor: 'Mistral',   supportsVision: true,  consumptionRate: 0.5,  minTier: 'basic'    },
  // ── Standard / Pro tier models ────────────────────────────────────────
  { id: 'anthropic/claude-3-5-haiku',           name: 'Claude 3.5 Haiku',        vendor: 'Anthropic', supportsVision: true,  consumptionRate: 1.0,  minTier: 'standard' },
  { id: 'anthropic/claude-3-7-sonnet',          name: 'Claude 3.7 Sonnet',       vendor: 'Anthropic', supportsVision: true,  consumptionRate: 2.0,  minTier: 'standard' },
  { id: 'anthropic/claude-sonnet-4',            name: 'Claude Sonnet 4',         vendor: 'Anthropic', supportsVision: true,  consumptionRate: 2.0,  minTier: 'standard' },
  { id: 'openai/gpt-4.1',                       name: 'GPT-4.1',                  vendor: 'OpenAI',    supportsVision: true,  consumptionRate: 1.5,  minTier: 'standard' },
  { id: 'openai/gpt-4.1-mini',                  name: 'GPT-4.1 mini',             vendor: 'OpenAI',    supportsVision: true,  consumptionRate: 0.5,  minTier: 'standard' },
  { id: 'google/gemini-2.5-pro',                name: 'Gemini 2.5 Pro',           vendor: 'Google',    supportsVision: true,  consumptionRate: 2.0,  minTier: 'standard' },
  { id: 'meta-llama/llama-4-maverick',          name: 'Llama 4 Maverick',         vendor: 'Meta',      supportsVision: true,  consumptionRate: 1.0,  minTier: 'standard' },
  // ── Pro-only (heavy models) ────────────────────────────────────────────
  { id: 'anthropic/claude-opus-4',              name: 'Claude Opus 4',            vendor: 'Anthropic', supportsVision: true,  consumptionRate: 5.0,  minTier: 'pro'      },
  { id: 'openai/gpt-5',                         name: 'GPT-5',                    vendor: 'OpenAI',    supportsVision: true,  consumptionRate: 4.0,  minTier: 'pro'      },
];

// ── Storage keys ──────────────────────────────────────────────────────────────

const PROVIDER_STORAGE_KEY = 'cafezin-ai-provider';
const MODEL_STORAGE_KEY    = 'cafezin-ai-model'; // legacy key — used only for copilot
const MODEL_KEY_PREFIX     = 'cafezin-ai-model-'; // per-provider keys for BYOK

/** Storage key for each non-Copilot provider's API key. */
const PROVIDER_KEY_MAP: Record<Exclude<AIProviderType, 'copilot' | 'cafezin'>, string> = {
  openai:    'cafezin-openai-key',
  anthropic: 'cafezin-anthropic-key',
  groq:      'cafezin-groq-key',
  google:    'cafezin-google-key',
  custom:    'cafezin-custom-key',
};

// Custom provider — endpoint URL and model ID stored only in localStorage (never synced)
const CUSTOM_ENDPOINT_KEY = 'cafezin-custom-endpoint';

export function getCustomEndpoint(): string {
  return localStorage.getItem(CUSTOM_ENDPOINT_KEY) ?? '';
}

export function setCustomEndpoint(url: string): void {
  localStorage.setItem(CUSTOM_ENDPOINT_KEY, url);
}

/** Returns the stored model ID for the custom provider. */
export function getCustomModelId(): string {
  return localStorage.getItem(MODEL_KEY_PREFIX + 'custom') ?? '';
}

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

/** Returns the stored API key for a non-Copilot BYOK provider. */
export function getProviderKey(p: Exclude<AIProviderType, 'copilot' | 'cafezin'>): string {
  return localStorage.getItem(PROVIDER_KEY_MAP[p]) ?? '';
}

/** True when the current provider has its required credential stored. */
export function isAIConfigured(): boolean {
  const p = getActiveProvider();
  if (p === 'copilot') {
    return !!localStorage.getItem('copilot-github-oauth-token') ||
      Object.keys(localStorage).some((key) => key.startsWith('copilot-github-oauth-token:'));
  }
  // cafezin managed AI — always configured (auth comes from Supabase session)
  if (p === 'cafezin') return true;
  if (p === 'custom') {
    return !!getCustomEndpoint() && !!getCustomModelId();
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

// ── Cafezin managed AI adapter ────────────────────────────────────────────────

/**
 * Streams a chat completion through the Cafezin ai-proxy Edge Function.
 * The proxy validates the user's Supabase session, checks their monthly quota,
 * and forwards to OpenRouter. Auth token is read from the active Supabase session.
 */
async function streamCafezinManagedAI(
  messages: ChatMessage[],
  model: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const { supabase } = await import('./supabase');
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      onError(new Error('Sessão expirada. Faça login novamente para usar a Cafezin IA.'));
      return;
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const proxyUrl = `${supabaseUrl}/functions/v1/ai-proxy`;

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      signal,
      body: JSON.stringify({ model, messages, stream: true }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      let parsed: { error?: string; message?: string; resets_at?: string } = {};
      try { parsed = JSON.parse(body); } catch { /* raw error */ }

      if (response.status === 401 && parsed.error === 'no_managed_ai_plan') {
        onError(new Error('Sua conta Cafezin precisa de um plano Basic ou superior para usar a Cafezin IA.'));
        return;
      }

      if (response.status === 402 || parsed.error === 'quota_exceeded') {
        const resetDate = parsed.resets_at ? new Date(parsed.resets_at).toLocaleDateString('pt-BR') : '';
        onError(new Error(
          `Cota mensal da Cafezin IA esgotada.${resetDate ? ` Renova em ${resetDate}.` : ''} Faça upgrade do plano ou escolha outro provider.`,
        ));
        return;
      }

      if (response.status === 403 && parsed.error === 'model_not_allowed') {
        onError(new Error(`Modelo "${model}" não disponível no seu plano. Escolha outro modelo.`));
        return;
      }

      onError(new Error(parsed.message ?? `Erro ${response.status} do servidor de IA.`));
      return;
    }

    // SSE passthrough \u2014 same parsing as streamOpenAICompatible
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

// ── Ghost text — cheapest model per provider ─────────────────────────────────

/**
 * The cheapest (or free) model to use for inline ghost-text completions
 * per provider. These models are used for background calls the user did not
 * explicitly initiate, so we prefer zero or low cost.
 */
const PROVIDER_GHOST_MODELS: Record<AIProviderType, string> = {
  copilot:   'gpt-5-mini',              // multiplier 0 — completely free
  cafezin:   '',                        // ghost text disabled for managed AI (costs budget)
  openai:    'gpt-4o-mini',             // cheapest OpenAI chat model
  anthropic: 'claude-3-5-haiku',        // cheapest Anthropic model
  groq:      'llama-3.1-8b-instant',    // fast & free-tier on Groq
  google:    'gemini-2.0-flash',        // fastest/cheapest Gemini
  custom:    '',                        // resolved at call time from stored config
};

/**
 * Fetches a single inline ghost-text completion using the active provider
 * and its cheapest configured model.
 * Returns '' on any error so the editor fails silently.
 */
export async function fetchProviderGhostCompletion(
  prefix: string,
  suffix: string,
  language: string,
  signal: AbortSignal,
  oauthClientId?: string,
): Promise<string> {
  const provider = getActiveProvider();

  // Delegate Copilot to its dedicated implementation (uses Copilot session token).
  if (provider === 'copilot') {
    const { fetchGhostCompletion } = await import('./copilot/streaming');
    return fetchGhostCompletion(prefix, suffix, language, signal, oauthClientId);
  }

  // Cafezin managed AI does not support ghost completions.
  if (provider === 'cafezin') return '';

  const langHint = language && language !== 'markdown' ? ` language="${language}"` : '';
  const prefixSnip = prefix.slice(-1500);
  const suffixSnip = suffix.slice(0, 400);
  const userContent = `<file${langHint}>${prefixSnip}<CURSOR>${suffixSnip}</file>\nComplete from <CURSOR>. Output the completion text only, no markdown fences, no explanations.`;
  const messages = [
    {
      role: 'system',
      content:
        'You are an inline text completion assistant. Given a file snippet with a <CURSOR> marker, output the most natural continuation. Output ONLY the completion text — no markdown fences, no explanations, no introductory phrases. If no useful completion exists, output nothing.',
    },
    { role: 'user', content: userContent },
  ];
  const commonParams = { max_tokens: 100, temperature: 0, stop: ['\n\n\n'] };

  try {
    if (provider === 'custom') {
      const endpoint = getCustomEndpoint();
      const model = getCustomModelId();
      if (!endpoint || !model) return '';
      const normalized = endpoint.replace(/\/+$/, '');
      const url = normalized.endsWith('/chat/completions')
        ? normalized
        : `${normalized}/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getProviderKey('custom')}`,
          'Content-Type': 'application/json',
        },
        signal,
        body: JSON.stringify({ model, messages, stream: false, ...commonParams }),
      });
      if (!res.ok) return '';
      const data = await res.json() as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content?.trimEnd() ?? '';
    }

    const key = getProviderKey(provider);
    if (!key) return '';
    const model = PROVIDER_GHOST_MODELS[provider];

    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        signal,
        body: JSON.stringify({
          model,
          max_tokens: commonParams.max_tokens,
          system: messages[0].content,
          messages: [{ role: 'user', content: userContent }],
          stop_sequences: commonParams.stop,
          temperature: commonParams.temperature,
        }),
      });
      if (!res.ok) return '';
      const data = await res.json() as { content?: { type: string; text: string }[] };
      const block = data.content?.find((b) => b.type === 'text');
      return block?.text?.trimEnd() ?? '';
    }

    const url =
      provider === 'openai'  ? 'https://api.openai.com/v1/chat/completions' :
      provider === 'groq'    ? 'https://api.groq.com/openai/v1/chat/completions' :
      /* google */             'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    const authHeader: Record<string, string> = provider === 'google'
      ? { 'x-goog-api-key': key }
      : { Authorization: `Bearer ${key}` };
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ model, messages, stream: false, ...commonParams }),
    });
    if (!res.ok) return '';
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content?.trimEnd() ?? '';
  } catch {
    return '';
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Stream a chat completion using the user's configured AI provider.
 *
 * Routes to:
 *  - GitHub Copilot  → existing `streamCopilotChat` (requires OAuth token)
 *  - Cafezin IA      → Supabase Edge Function ai-proxy → OpenRouter (managed budget)
 *  - OpenAI          → api.openai.com (requires API key)
 *  - Anthropic       → api.anthropic.com (requires API key, different format)
 *  - Groq            → api.groq.com (requires API key, OpenAI-compatible)
 *  - Custom          → user-configured OpenAI-compatible endpoint (Ollama, LM Studio, etc.)
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

  // Cafezin managed AI — call our Supabase Edge Function ai-proxy
  if (provider === 'cafezin') {
    return streamCafezinManagedAI(messages, resolvedModel, onChunk, onDone, onError, signal);
  }

  if (provider === 'custom') {
    const endpoint = getCustomEndpoint();
    const customModel = model || getCustomModelId();
    if (!endpoint || !customModel) {
      onError(new Error(
        'Servidor customizado não configurado. Acesse Configurações > Assistente IA.',
      ));
      return;
    }
    const normalized = endpoint.replace(/\/+$/, '');
    const url = normalized.endsWith('/chat/completions')
      ? normalized
      : `${normalized}/chat/completions`;
    return streamOpenAICompatible(url, getProviderKey('custom'), messages, customModel, onChunk, onDone, onError, signal);
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

// ── Custom endpoint diagnostics ───────────────────────────────────────────────

export type CustomEndpointDiagnostic =
  | { ok: true; latencyMs: number }
  | { ok: false; error: string; hint: string };

/**
 * Tests a custom OpenAI-compatible endpoint with a minimal request.
 * Returns structured diagnostic info ready to display in Settings.
 *
 * A 400 response where the server mentions "model" is treated as
 * "server reachable but model not found" and reported as a distinct error.
 * Other 400s are optimistically treated as OK (server is live, bad payload).
 */
export async function testCustomEndpoint(
  baseUrl: string,
  apiKey: string,
  modelId: string,
): Promise<CustomEndpointDiagnostic> {
  const normalized = baseUrl.replace(/\/+$/, '');
  const url = normalized.endsWith('/chat/completions')
    ? normalized
    : `${normalized}/chat/completions`;

  const start = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
        stream: false,
      }),
    });

    const latencyMs = Date.now() - start;

    if (response.ok) {
      return { ok: true, latencyMs };
    }

    const body = await response.text().catch(() => '');

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        error: `Erro ${response.status} — não autorizado`,
        hint: 'Chave de API inválida ou ausente. Verifique o campo "Chave da API".',
      };
    }
    if (response.status === 404) {
      return {
        ok: false,
        error: 'Endpoint não encontrado (404)',
        hint: 'Verifique se a URL termina em /v1 — ex: http://localhost:11434/v1',
      };
    }
    if (response.status === 400) {
      const bodyLower = body.toLowerCase();
      if (bodyLower.includes('model')) {
        return {
          ok: false,
          error: 'Modelo não encontrado',
          hint: `O servidor respondeu, mas o modelo "${modelId}" não existe. Verifique o ID do modelo.`,
        };
      }
      // Other 400: server is reachable, our minimal payload was invalid — close enough
      return { ok: true, latencyMs };
    }

    return {
      ok: false,
      error: `Erro ${response.status}`,
      hint: body.slice(0, 180) || 'Resposta inesperada do servidor.',
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isLocal = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');
    const isConnRefused =
      msg.includes('Connection refused') ||
      msg.includes('connection refused') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('os error 61') ||
      msg.includes('os error 111') ||
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError');
    if (isConnRefused) {
      return {
        ok: false,
        error: 'Sem conexão',
        hint: isLocal
          ? 'Servidor local não encontrado. Certifique-se que o serviço está rodando (ex: ollama serve).'
          : 'Não foi possível conectar ao servidor. Verifique a URL e se o serviço está acessível.',
      };
    }
    return {
      ok: false,
      error: 'Erro de conexão',
      hint: msg.slice(0, 180),
    };
  }
}
