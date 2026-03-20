/**
 * Provider-agnostic agentic loop using Vercel AI SDK streamText.
 *
 * Used for all non-Copilot providers (OpenAI, Anthropic, Google, Groq, ...).
 * The SDK handles the full tool-call → execute → respond loop via `stopWhen`.
 *
 * Canvas screenshot support:
 *  - Vision-capable models: screenshot sentinels injected as image messages via prepareStep.
 *  - Non-vision models: canvas/screenshot tools are filtered out and the user
 *    receives a warning at the start of the run.
 *
 * Copilot keeps its own custom loop (services/copilot/streaming.ts) because it
 * requires special auth (session token), custom vision injection, and context
 * compression that are tightly coupled to the GitHub auth flow.
 */

import { streamText, stepCountIs } from 'ai';
import type { ModelMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { ChatMessage, ToolActivity } from '../../types';
import type { ToolDefinition, ToolExecutor } from '../../utils/tools/shared';
import { getActiveProvider, getProviderKey, getActiveModel, getCustomEndpoint } from '../aiProvider';
import { chatToModelMessages } from './messageConverter';
import { toVercelToolSet } from './tools-adapter';
import { providerModelSupportsVision } from './providerModels';

// Sentinels emitted by canvasTools.ts — must match exactly.
const SENTINEL_CANVAS  = '__CANVAS_PNG__:';
const SENTINEL_PREVIEW = '__PREVIEW_PNG__:';

// Tool names that are canvas-specific and require vision to be useful.
const CANVAS_VISION_TOOLS = new Set([
  'canvas_screenshot',
  'screenshot_preview',
  'add_canvas_image',
]);

// ── Provider factory ──────────────────────────────────────────────────────────

function buildLanguageModel(provider: string, model: string) {
  const fetchOpt = { fetch: tauriFetch as unknown as typeof fetch };

  if (provider === 'openai') {
    return createOpenAI({ apiKey: getProviderKey('openai'), ...fetchOpt })(model);
  }
  if (provider === 'anthropic') {
    return createAnthropic({ apiKey: getProviderKey('anthropic'), ...fetchOpt })(model);
  }
  if (provider === 'google') {
    return createGoogleGenerativeAI({ apiKey: getProviderKey('google'), ...fetchOpt })(model);
  }
  if (provider === 'groq') {
    // Groq is OpenAI-compatible
    return createOpenAI({
      baseURL: 'https://api.groq.com/openai/v1',
      apiKey: getProviderKey('groq'),
      ...fetchOpt,
    })(model);
  }
  if (provider === 'custom') {
    const endpoint = getCustomEndpoint().replace(/\/+$/, '');
    if (!endpoint) throw new Error('Endpoint customizado não configurado.');
    return createOpenAI({
      baseURL: endpoint,
      // Some local servers (Ollama, LM Studio) don’t require an API key.
      // The SDK requires a non-empty string, so we fall back to 'no-key'.
      apiKey: getProviderKey('custom') || 'no-key',
      ...fetchOpt,
    })(model);
  }

  throw new Error(`Unsupported provider for agentic loop: ${provider}`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run an agentic loop for any non-Copilot provider.
 * Signature matches runCopilotAgent so useAIStream can swap them transparently.
 */
export async function runProviderAgent(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  executeTool: ToolExecutor,
  onChunk: (text: string) => void,
  onToolActivity: (activity: ToolActivity) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  model?: string,
  _workspacePath?: string,
  _sessionId?: string,
  signal?: AbortSignal,
  onExhausted?: () => void,
): Promise<void> {
  try {
    const provider = getActiveProvider();
    const resolvedModel = model || getActiveModel();
    const supportsVision = providerModelSupportsVision(provider, resolvedModel);

    // If the model has no vision, filter out canvas screenshot tools and warn.
    let activeTools = tools;
    const hasCanvasVisionTools = tools.some((t) => CANVAS_VISION_TOOLS.has(t.function.name));
    if (!supportsVision && hasCanvasVisionTools) {
      activeTools = tools.filter((t) => !CANVAS_VISION_TOOLS.has(t.function.name));
      onChunk(
        '\n> ⚠️ **Este modelo não suporta raciocínio visual.** ' +
        'Ferramentas de captura de tela do canvas foram desativadas. ' +
        'Para trabalhar com o canvas visual, use um modelo com suporte a imagem (ex: GPT-4.1, Claude Sonnet, Gemini Flash).\n\n',
      );
    }

    const langModel = buildLanguageModel(provider, resolvedModel);
    const modelMessages = chatToModelMessages(messages);

    // Pending vision message to be injected before the next LLM step.
    let pendingVisionInject: { url: string; label: string } | null = null;

    // Wrap executor: detect screenshot sentinels, replace with placeholder text,
    // store the image URL so prepareStep can inject it as a vision message.
    const wrappedExecute: ToolExecutor = async (name, args) => {
      const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const activity: ToolActivity = { callId, name, args };
      onToolActivity(activity);
      let result: string;
      try {
        result = await executeTool(name, args);
        onToolActivity({ ...activity, result });
      } catch (e) {
        const errMsg = `Error: ${e instanceof Error ? e.message : String(e)}`;
        onToolActivity({ ...activity, error: errMsg, result: errMsg });
        result = errMsg;
      }

      // Intercept screenshot sentinels — inject as vision message on next step.
      if (supportsVision && result.startsWith(SENTINEL_CANVAS)) {
        const url = result.slice(SENTINEL_CANVAS.length);
        const isValidDataUrl = url.startsWith('data:image/') && url.includes(';base64,') && url.length > 300;
        if (isValidDataUrl) {
          pendingVisionInject = {
            url,
            label: 'Canvas screenshot after your modifications — verify layout, colors, and content:',
          };
        }
        return 'Canvas screenshot taken — see image below.';
      }
      if (supportsVision && result.startsWith(SENTINEL_PREVIEW)) {
        const url = result.slice(SENTINEL_PREVIEW.length);
        const isValidDataUrl = url.startsWith('data:image/') && url.includes(';base64,') && url.length > 300;
        if (isValidDataUrl) {
          pendingVisionInject = {
            url,
            label: 'HTML preview screenshot — verify the rendered layout, spacing, and visual design:',
          };
        }
        return 'HTML preview screenshot taken — see image below.';
      }

      return result;
    };

    const toolSet = toVercelToolSet(activeTools, wrappedExecute);

    const result = streamText({
      model: langModel,
      messages: modelMessages,
      tools: toolSet,
      stopWhen: stepCountIs(100),
      abortSignal: signal,
      maxOutputTokens: 16000,
      temperature: 0.3,

      // Inject vision message (screenshot) before the next LLM call when available.
      prepareStep: ({ messages: currentMessages }) => {
        if (!pendingVisionInject) return;
        const { url, label } = pendingVisionInject;
        pendingVisionInject = null;
        const visionMessage: ModelMessage = {
          role: 'user',
          content: [
            { type: 'text', text: label },
            { type: 'image', image: url },
          ],
        } as any;
        return { messages: [...currentMessages, visionMessage] };
      },

      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          onChunk((chunk as any).delta ?? '');
        }
      },
      onFinish: ({ finishReason }) => {
        if (finishReason === 'length') onExhausted?.();
        onDone();
      },
      onError: ({ error }) => {
        onError(error instanceof Error ? error : new Error(String(error)));
      },
    });

    await result.consumeStream();
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.message === 'AbortError')) {
      onDone();
      return;
    }
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}
