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

import { streamText, generateText, stepCountIs } from 'ai';
import type { ModelMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { ChatMessage, ToolActivity } from '../../types';
import type { ToolDefinition, ToolExecutor } from '../../utils/tools/shared';
import { getActiveProvider, getProviderKey, getActiveModel, getCustomEndpoint } from '../aiProvider';
import { buildProviderRequestDump, formatProviderError, setLastProviderRequestDump } from './diagnostics';
import { chatToModelMessages } from './messageConverter';
import { toVercelToolSet } from './tools-adapter';
import { providerModelSupportsVision } from './providerModels';
import { getModelTokenBudgets } from '../copilot/tokenBudget';

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

function normalizeOpenAICompatibleBaseURL(endpoint: string): string {
  return endpoint
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '')
    .replace(/\/responses$/, '');
}

function buildLanguageModel(provider: string, model: string) {
  const fetchOpt = { fetch: tauriFetch as unknown as typeof fetch };

  if (provider === 'openai') {
    return createOpenAI({
      apiKey: getProviderKey('openai'),
      ...fetchOpt,
    }).chat(model);
  }
  if (provider === 'anthropic') {
    return createAnthropic({ apiKey: getProviderKey('anthropic'), ...fetchOpt })(model);
  }
  if (provider === 'google') {
    return createGoogleGenerativeAI({ apiKey: getProviderKey('google'), ...fetchOpt })(model);
  }
  if (provider === 'groq') {
    // Groq is OpenAI-compatible, but only exposes chat completions.
    return createOpenAI({
      baseURL: 'https://api.groq.com/openai/v1',
      name: 'groq',
      apiKey: getProviderKey('groq'),
      ...fetchOpt,
    }).chat(model);
  }
  if (provider === 'custom') {
    const endpoint = normalizeOpenAICompatibleBaseURL(getCustomEndpoint());
    if (!endpoint) throw new Error('Endpoint customizado não configurado.');
    return createOpenAI({
      baseURL: endpoint,
      name: 'custom',
      // Some local servers (Ollama, LM Studio) don’t require an API key.
      // The SDK requires a non-empty string, so we fall back to 'no-key'.
      apiKey: getProviderKey('custom') || 'no-key',
      ...fetchOpt,
    }).chat(model);
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
    let streamedText = '';

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
    setLastProviderRequestDump(buildProviderRequestDump({
      provider,
      model: resolvedModel,
      messages,
      tools: activeTools,
    }));

    // Pending vision message to be injected before the next LLM step.
    let pendingVisionInject: { url: string; label: string } | null = null;
    const reasoningBuffers = new Map<string, string>();

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

      // Inject vision message and/or compress context before each LLM step.
      // Mirrors the context-management strategy used by the Copilot agent loop.
      prepareStep: async ({ messages: currentMessages }) => {
        let msgs: ModelMessage[] = currentMessages as ModelMessage[];

        // 1. Vision injection
        if (pendingVisionInject) {
          const { url, label } = pendingVisionInject;
          pendingVisionInject = null;
          msgs = [...msgs, {
            role: 'user',
            content: [{ type: 'text', text: label }, { type: 'image', image: url }],
          } as any as ModelMessage];
        }

        // 2. Compression: same budget rule as the Copilot agent loop.
        const estimatedTok = Math.ceil(JSON.stringify(msgs).length / 4);
        const budgets = getModelTokenBudgets(resolvedModel as any);
        if (estimatedTok > budgets.compressBudget) {
          onChunk('\n\n_[Context approaching limit — summarizing prior session and continuing...]_\n\n');
          // Strip vision messages before sending to summariser.
          const msgsForSummary = msgs.filter(
            (m) =>
              !(m.role === 'user' && Array.isArray(m.content) &&
                (m.content as any[]).some((p: any) => p.type === 'image')),
          );
          let summaryText = '[Summary unavailable — model did not respond]';
          try {
            const summaryResult = await generateText({
              model: langModel,
              messages: [
                {
                  role: 'system',
                  content:
                    'You are a technical session summarizer. The agent context window is full and needs to be compressed. ' +
                    'Summarize the conversation below into a dense technical briefing covering:\n' +
                    "1. The user's original goal\n" +
                    '2. Everything accomplished so far — each tool call, file created/modified\n' +
                    '3. Current state of the workspace\n' +
                    "4. What still needs to be done to complete the user's goal\n" +
                    '5. Any important findings, constraints, or decisions\n' +
                    '6. **Schema/rules/format changes**: if any data structures, file formats, database schemas, or workspace rules were discussed or corrected during this session, state the CURRENT (corrected) version explicitly. These are the most common source of confusion in future sessions — old assumptions must be overridden.\n\n' +
                    'Be precise and technical. Use bullet points. Aim for 400\u2013700 words.',
                },
                {
                  role: 'user',
                  content: `Conversation to summarize (${msgsForSummary.length} messages):\n\n${
                    JSON.stringify(msgsForSummary, null, 2).slice(0, 50_000)
                  }`,
                },
              ],
              maxOutputTokens: 1800,
              temperature: 0.2,
              abortSignal: signal,
            });
            summaryText = summaryResult.text;
          } catch (e) {
            console.warn('[runProviderAgent] summary generation failed:', e);
          }

          // Find last non-summary user message; keep everything from there onwards
          // (guarantees complete tool-call/result pairs in tail).
          const systemMsgs = msgs.filter((m) => m.role === 'system');
          let tailStart = -1;
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i];
            if (m.role !== 'user') continue;
            const textContent = Array.isArray(m.content)
              ? (m.content as any[]).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
              : (m.content as string ?? '');
            if (!textContent.startsWith('[SESSION SUMMARY')) { tailStart = i; break; }
          }
          const tail = (tailStart >= 0 ? msgs.slice(tailStart) : []).filter(
            (m) =>
              !(m.role === 'user' && Array.isArray(m.content) &&
                (m.content as any[]).some((p: any) => p.type === 'image')),
          );

          const compressed: ModelMessage[] = [
            ...systemMsgs,
            {
              role: 'user',
              content:
                `[SESSION SUMMARY]\n\nProgress summary:\n${summaryText}\n\n` +
                'Priority rule: follow the current user request if any older goal in the summary conflicts with it.\n\n---\nContinuing from here:',
            } as any as ModelMessage,
            {
              role: 'assistant',
              content: "Understood \u2014 resuming from the session summary above. I'll continue towards the original goal.",
            } as any as ModelMessage,
            ...tail.filter((m) => m.role !== 'system'),
          ];
          return { messages: compressed };
        }

        if (msgs !== currentMessages) return { messages: msgs };
        return undefined;
      },

      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          const text = (chunk as any).text ?? (chunk as any).delta ?? '';
          if (!text) return;
          streamedText += text;
          onChunk(text);
          return;
        }

        if (chunk.type === 'reasoning-delta') {
          const callId = `thinking_${(chunk as any).id ?? 'unknown'}`;
          const text = (chunk as any).text ?? (chunk as any).delta ?? '';
          if (!reasoningBuffers.has(callId)) {
            reasoningBuffers.set(callId, '');
          }
          const next = (reasoningBuffers.get(callId) ?? '') + text;
          reasoningBuffers.set(callId, next);
          onToolActivity({
            callId,
            name: '__thinking__',
            args: {},
            kind: 'thinking',
            thinkingText: next,
          });
        }
      },
      onFinish: ({ finishReason, text, steps }) => {
        for (const [callId, reasoningText] of reasoningBuffers.entries()) {
          onToolActivity({
            callId,
            name: '__thinking__',
            args: {},
            kind: 'thinking',
            thinkingText: reasoningText,
            result: reasoningText || 'Reasoning completed.',
          });
        }

        const aggregateText = [
          text,
          ...steps.map((step) => step.text),
        ].filter((value): value is string => typeof value === 'string' && value.length > 0)
          .join('');

        if (aggregateText && aggregateText.length > streamedText.length) {
          const suffix = aggregateText.slice(streamedText.length);
          if (suffix) {
            streamedText += suffix;
            onChunk(suffix);
          }
        }

        if (finishReason === 'length') onExhausted?.();
        onDone();
      },
      onError: ({ error }) => {
        onError(formatProviderError(error, {
          provider,
          model: resolvedModel,
          messages,
          tools: activeTools,
        }));
      },
    });

    await result.consumeStream();
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.message === 'AbortError')) {
      onDone();
      return;
    }
    onError(formatProviderError(err, {
      provider: getActiveProvider(),
      model: model || getActiveModel(),
      messages,
      tools,
    }));
  }
}
