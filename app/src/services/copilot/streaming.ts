import { fetch } from '@tauri-apps/plugin-http';
import type { ChatMessage, CopilotStreamChunk, CopilotModel, ToolActivity, TokenUsage } from '../../types';
import { DEFAULT_MODEL } from '../../types';
import type { ToolDefinition, ToolExecutor } from '../../utils/workspaceTools';
import {
  COPILOT_API_URL,
  COPILOT_CLIENT_MACHINE_STORAGE_KEY,
  COPILOT_CLIENT_SESSION_STORAGE_KEY,
  EDITOR_HEADERS,
} from './constants';
import {
  CopilotDiagnosticError,
  buildRequestDump,
  type CopilotRequestDumpMeta,
  setLastRequestDump,
  updateRateLimit,
  isQuotaError,
} from './diagnostics';
import { getModelTokenBudgets, estimateTokens } from './tokenBudget';
import { sanitizeLoop } from './messages';
import { getCopilotSessionToken } from './auth';
import {
  resolveCopilotModelForChatCompletions,
  modelApiParams,
  modelSupportsVision,
  registerIncompatibleChatCompletionsModelFromError,
} from './models';
import { parseTextToolCalls, parseToolArguments, humanizeNetworkError } from './toolParsing';
import { summarizeAndCompress } from './compression';

type CopilotInitiator = 'user' | 'agent';
type CopilotInteractionType = 'chat' | 'agent';

const EXPORT_TOOL_NAMES = new Set(['export_workspace', 'configure_export_targets']);
const MEMORY_TOOL_NAMES = new Set(['remember', 'manage_memory']);
const SETTINGS_TOOL_NAMES = new Set(['configure_workspace']);
const OPTIONAL_TASK_TOOL_NAMES = new Set(['save_desktop_task']);
const DESTRUCTIVE_TOOL_NAMES = new Set(['rename_workspace_file', 'delete_workspace_file', 'scaffold_workspace']);

function newCopilotId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getPersistentCopilotId(storageKey: string, prefix: string): string {
  if (typeof localStorage === 'undefined') return newCopilotId(prefix);
  try {
    const existing = localStorage.getItem(storageKey)?.trim();
    if (existing) return existing;
    const created = newCopilotId(prefix);
    localStorage.setItem(storageKey, created);
    return created;
  } catch {
    return newCopilotId(prefix);
  }
}

function contentToPlainText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((part) => (part.type === 'text' ? part.text : '[image]'))
    .join(' ');
}

function buildCopilotRequestContext(interactionType: CopilotInteractionType) {
  return {
    interactionType,
    interactionId: newCopilotId(interactionType),
    clientSessionId: getPersistentCopilotId(COPILOT_CLIENT_SESSION_STORAGE_KEY, 'cs'),
    clientMachineId: getPersistentCopilotId(COPILOT_CLIENT_MACHINE_STORAGE_KEY, 'cm'),
  };
}

function buildCopilotHeaders(
  sessionToken: string,
  requestContext: ReturnType<typeof buildCopilotRequestContext>,
  initiator: CopilotInitiator,
): Record<string, string> {
  return {
    Authorization: `Bearer ${sessionToken}`,
    'Content-Type': 'application/json',
    ...EDITOR_HEADERS,
    'X-Interaction-Id': requestContext.interactionId,
    'X-Interaction-Type': requestContext.interactionType,
    'X-Client-Session-Id': requestContext.clientSessionId,
    'X-Client-Machine-Id': requestContext.clientMachineId,
    'X-Initiator': initiator,
  };
}

function buildDumpMeta(
  requestContext: ReturnType<typeof buildCopilotRequestContext>,
  initiator: CopilotInitiator,
  patch?: Partial<CopilotRequestDumpMeta>,
): CopilotRequestDumpMeta {
  return {
    interactionType: requestContext.interactionType,
    interactionId: requestContext.interactionId,
    clientSessionId: requestContext.clientSessionId,
    clientMachineId: requestContext.clientMachineId,
    initiator,
    ...patch,
  };
}

function inferCopilotToolIntent(messages: ChatMessage[]) {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  const prompt = contentToPlainText(lastUser?.content ?? '').trim();
  const normalized = prompt.toLowerCase();
  const hasInjectedContext =
    normalized.includes('[context: user sent this prompt while') ||
    normalized.includes('[attached file:') ||
    normalized.includes('[attached selection:');

  return {
    hasInjectedContext,
    isGreetingOnly: /^(hi|hello|hey|oi|ola|olá|bom dia|boa tarde|boa noite|yo|sup)[!. ]*$/i.test(prompt),
    isReviewOrEdit:
      /\b(review|revise|revisar|rewrite|edit|improve|improve it|melhor|polish|refine|fix|corrig|coeso|engajan|coes[oa])\b/i.test(prompt),
    isSearchOrResearch:
      /\b(search|find|look for|buscar|procura|onde|where|consisten|cross[- ]reference|compare|compare with|pesquis)\b/i.test(prompt),
    isExport:
      /\b(export|publish|deploy|build|gerar pdf|pdf|subir|publicar)\b/i.test(prompt),
    isMemory:
      /\b(remember|memory|memor|lembra|lembre|perfil|preference|preferencia)\b/i.test(prompt),
    isSettings:
      /\b(setting|settings|config|configura|workspace config|configure workspace)\b/i.test(prompt),
    isTask:
      /\b(task|todo|plan|steps|plano|etapas|track)\b/i.test(prompt),
    wantsDangerousMutation:
      /\b(rename|renome|delete|remove|apaga|exclui|scaffold|novo workspace|new workspace)\b/i.test(prompt),
  };
}

function filterCopilotToolsForTurn(
  tools: ToolDefinition[],
  messages: ChatMessage[],
  _round: number,
): ToolDefinition[] {
  const intent = inferCopilotToolIntent(messages);
  if (intent.isGreetingOnly && !intent.hasInjectedContext) return [];

  return tools.filter((tool) => {
    const name = tool.function.name;
    if (!intent.isExport && EXPORT_TOOL_NAMES.has(name)) return false;
    if (!intent.isMemory && MEMORY_TOOL_NAMES.has(name)) return false;
    if (!intent.isSettings && SETTINGS_TOOL_NAMES.has(name)) return false;
    if (!intent.isTask && OPTIONAL_TASK_TOOL_NAMES.has(name)) return false;
    if (!intent.wantsDangerousMutation && DESTRUCTIVE_TOOL_NAMES.has(name)) return false;
    return true;
  });
}

// ── streamCopilotChat ─────────────────────────────────────────────────────────

/**
 * Stream a Copilot chat completion.
 * Calls the GitHub Copilot API with the provided messages and
 * invokes `onChunk` with each streamed text fragment.
 */
export async function streamCopilotChat(
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  model: CopilotModel = DEFAULT_MODEL,
  tools?: ToolDefinition[],
  signal?: AbortSignal,
  oauthClientId?: string,
): Promise<void> {
  try {
    if (signal?.aborted) return;
    const sessionToken = await getCopilotSessionToken(oauthClientId);
    const requestContext = buildCopilotRequestContext('chat');
    const resolvedModel = resolveCopilotModelForChatCompletions(model);
    if (resolvedModel !== model) {
      console.warn(`[Copilot] model "${model}" is not accessible via /chat/completions; using "${resolvedModel}" instead`);
    }

    const cleanMessages = sanitizeLoop([...messages]);

    const MAX_RETRIES = 3;
    let response: Awaited<ReturnType<typeof fetch>> | null = null;
    let lastError: Error | null = null;
    let messagesForRequest = cleanMessages;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (signal?.aborted) return;
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      }
      const MAX_PAYLOAD_BYTES = 6 * 1024 * 1024; // 6 MB
      messagesForRequest = cleanMessages;
      const bodyCandidate = JSON.stringify({
        model: resolvedModel,
        messages: cleanMessages,
        ...(tools ? { tools, tool_choice: 'auto' } : {}),
        stream: true,
        stream_options: { include_usage: true },
        ...modelApiParams(resolvedModel, 0.7, 16384),
      });
      if (bodyCandidate.length > MAX_PAYLOAD_BYTES) {
        console.warn(
          `[Copilot] payload ${(bodyCandidate.length / 1024).toFixed(0)} KB exceeds ${MAX_PAYLOAD_BYTES / 1024 / 1024} MB limit — stripping vision messages`,
        );
        messagesForRequest = cleanMessages.filter(
          (m) =>
            !(m.role === 'user' &&
              Array.isArray(m.content) &&
              (m.content as any[]).some((p: any) => p.type === 'image_url')),
        );
      }
      setLastRequestDump(buildRequestDump(
        messagesForRequest,
        resolvedModel,
        tools,
        undefined,
        undefined,
        buildDumpMeta(requestContext, 'user'),
      ));
      let r: Awaited<ReturnType<typeof fetch>>;
      try {
        r = await fetch(COPILOT_API_URL, {
          method: 'POST',
          headers: buildCopilotHeaders(sessionToken, requestContext, 'user'),
          signal,
          body: JSON.stringify({
            model: resolvedModel,
            messages: messagesForRequest,
            ...(tools ? { tools, tool_choice: 'auto' } : {}),
            stream: true,
            stream_options: { include_usage: true },
            ...modelApiParams(resolvedModel, 0.7, 16384),
          }),
        });
      } catch (fetchErr) {
        if (fetchErr instanceof Error && (fetchErr.name === 'AbortError' || fetchErr.message === 'AbortError')) return;
        lastError = humanizeNetworkError(fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr)));
        console.warn(`[Copilot] network error on attempt ${attempt + 1}:`, lastError.message);
        continue;
      }
      if (r.ok || r.status < 500) { response = r; break; }
      const errorText = await r.text();
      const cleanError = errorText.trim().startsWith('<')
        ? `GitHub returned a ${r.status} (server error) — please retry in a moment`
        : `Copilot API error ${r.status}: ${errorText}`;
      lastError = new Error(cleanError);
      response = null;
    }

    if (!response) throw lastError!;

    if (!response.ok) {
      const errorText = await response.text();
      const errorMeta = buildDumpMeta(requestContext, 'user', {
        requestId: response.headers.get('request-id'),
        githubRequestId: response.headers.get('x-github-request-id'),
        copilotUsage: response.headers.get('copilot_usage'),
      });
      setLastRequestDump(buildRequestDump(messagesForRequest, resolvedModel, tools, response.status, errorText, errorMeta));
      console.error('[Copilot] API error diagnostic:\n' + buildRequestDump(messagesForRequest, resolvedModel, tools, response.status, errorText, errorMeta));

      let cleanError: string;
      if (errorText.trim().startsWith('<')) {
        cleanError = `GitHub returned a ${response.status} (server error) — please retry in a moment`;
      } else {
        try {
          const parsed = JSON.parse(errorText);
          const msg = parsed?.error?.message ?? parsed?.message ?? errorText;
          cleanError = `Copilot API error ${response.status}: ${msg}`;
        } catch {
          cleanError = `Copilot API error ${response.status}: ${errorText}`;
        }
      }
      if (response.status === 429 || response.status === 402 || isQuotaError(cleanError)) {
        updateRateLimit({ quotaExceeded: true, remaining: 0 });
      }
      registerIncompatibleChatCompletionsModelFromError(cleanError);
      throw new CopilotDiagnosticError(cleanError, buildRequestDump(cleanMessages, resolvedModel, tools, response.status, errorText));
    }

    // Capture rate limit headers
    {
      const remaining = response.headers.get('x-ratelimit-remaining') ?? response.headers.get('x-copilot-quota-remaining');
      const limit = response.headers.get('x-ratelimit-limit') ?? response.headers.get('x-copilot-quota-limit');
      updateRateLimit({
        remaining: remaining !== null ? parseInt(remaining, 10) : undefined,
        limit: limit !== null ? parseInt(limit, 10) : undefined,
        quotaExceeded: false,
      });
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let finalUsage: TokenUsage | null = null;
    const requestId = response.headers.get('request-id');
    const githubRequestId = response.headers.get('x-github-request-id');
    const copilotUsage = response.headers.get('copilot_usage');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const chunk: CopilotStreamChunk = JSON.parse(trimmed.slice(6));
          if (chunk.usage) finalUsage = chunk.usage;
          const text = chunk.choices[0]?.delta?.content;
          if (text) onChunk(text);
        } catch {
          // skip malformed lines
        }
      }
    }

    setLastRequestDump(buildRequestDump(
      messagesForRequest,
      resolvedModel,
      tools,
      undefined,
      undefined,
      buildDumpMeta(requestContext, 'user', {
        requestId,
        githubRequestId,
        usage: finalUsage,
        copilotUsage,
      }),
    ));

    onDone();
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.message === 'AbortError')) return;
    onError(humanizeNetworkError(err instanceof Error ? err : new Error(String(err))));
  }
}

// ── copilotComplete ───────────────────────────────────────────────────────────

/**
 * Helper: get a one-shot (non-streamed) completion for internal use.
 */
export async function copilotComplete(
  messages: ChatMessage[],
  model: CopilotModel = DEFAULT_MODEL,
  oauthClientId?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let result = '';
    streamCopilotChat(
      messages,
      (chunk) => { result += chunk; },
      () => resolve(result),
      reject,
      model,
      undefined,
      undefined,
      oauthClientId,
    );
  });
}

// ── fetchGhostCompletion ──────────────────────────────────────────────────────

/**
 * Inline ghost-text completion for the editor.
 * Returns the predicted continuation at the cursor position, or '' on any error.
 */
export async function fetchGhostCompletion(
  prefix: string,
  suffix: string,
  language: string,
  signal: AbortSignal,
  oauthClientId?: string,
): Promise<string> {
  const sessionToken = await getCopilotSessionToken(oauthClientId);
  const requestContext = buildCopilotRequestContext('chat');

  const prefixSnip = prefix.slice(-1500);
  const suffixSnip = suffix.slice(0, 400);

  const langHint = language && language !== 'markdown' ? ` language="${language}"` : '';
  const userContent = `<file${langHint}>${prefixSnip}<CURSOR>${suffixSnip}</file>\nComplete from <CURSOR>. Output the completion text only, no markdown fences, no explanations.`;

  const body = JSON.stringify({
    model: resolveCopilotModelForChatCompletions('gpt-5-mini'),
    messages: [
      {
        role: 'system',
        content:
          'You are an inline code/text completion assistant. Given a file snippet with a <CURSOR> marker, output the most natural continuation. Output ONLY the completion text — no markdown fences, no explanations, no introductory phrases. If no useful completion exists, output nothing.',
      },
      { role: 'user', content: userContent },
    ],
    stream: false,
    temperature: 0,
    max_tokens: 100,
    stop: ['\n\n\n'],
  });

  const res = await fetch(COPILOT_API_URL, {
    method: 'POST',
    headers: buildCopilotHeaders(sessionToken, requestContext, 'user'),
    signal,
    body,
  });

  if (!res.ok) return '';
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trimEnd() ?? '';
}

// ── runCopilotAgent ───────────────────────────────────────────────────────────

/**
 * Agentic Copilot call with tool calling.
 *
 * Flow:
 *   1. POST messages + tools (streaming) in a loop.
 *   2. For each tool_calls response: execute tools, append results, loop.
 *   3. When finish_reason === 'stop': we are done.
 *
 * Tool activity is reported via onToolActivity so the UI can show what's happening.
 */
export async function runCopilotAgent(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  executeTool: ToolExecutor,
  onChunk: (text: string) => void,
  onToolActivity: (activity: ToolActivity) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  model: CopilotModel = DEFAULT_MODEL,
  workspacePath?: string,
  sessionId?: string,
  signal?: AbortSignal,
  onExhausted?: () => void,
  oauthClientId?: string,
): Promise<void> {
  try {
    const sessionToken = await getCopilotSessionToken(oauthClientId);
    const requestContext = buildCopilotRequestContext('agent');
    const resolvedModel = resolveCopilotModelForChatCompletions(model);
    if (resolvedModel !== model) {
      console.warn(`[agent] model "${model}" is not accessible via /chat/completions; using "${resolvedModel}" instead`);
    }

    const loop = sanitizeLoop([...messages]);
    const MAX_ROUNDS = 100;
    const budgets = getModelTokenBudgets(resolvedModel);

    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (signal?.aborted) return;

      {
        const clean = sanitizeLoop(loop);
        loop.splice(0, loop.length, ...clean);
      }

      let res: Awaited<ReturnType<typeof fetch>> | null = null;
      let lastFetchError: Error | null = null;
      let loopForRequest = loop as typeof loop;
      const initiator: CopilotInitiator = round === 0 ? 'user' : 'agent';
      let activeTools = filterCopilotToolsForTurn(tools, loopForRequest, round);
      let requestUsage: TokenUsage | null = null;
      let requestId: string | null = null;
      let githubRequestId: string | null = null;
      let copilotUsage: string | null = null;

      for (let attempt = 0; attempt < 3; attempt++) {
        if (signal?.aborted) return;
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
        activeTools = filterCopilotToolsForTurn(tools, loopForRequest, round);
        setLastRequestDump(buildRequestDump(
          loopForRequest,
          resolvedModel,
          activeTools,
          undefined,
          undefined,
          buildDumpMeta(requestContext, initiator),
        ));
        let r: Awaited<ReturnType<typeof fetch>>;
        try {
          r = await fetch(COPILOT_API_URL, {
            method: 'POST',
            headers: buildCopilotHeaders(sessionToken, requestContext, initiator),
            signal,
            body: JSON.stringify({
              model: resolvedModel,
              messages: loopForRequest,
              ...(activeTools.length > 0 ? { tools: activeTools, tool_choice: 'auto' } : {}),
              stream: true,
              stream_options: { include_usage: true },
              ...modelApiParams(resolvedModel, 0.3, 16000),
            }),
          });
        } catch (fetchErr) {
          if (fetchErr instanceof Error && (fetchErr.name === 'AbortError' || fetchErr.message === 'AbortError')) return;
          lastFetchError = humanizeNetworkError(fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr)));
          console.warn(`[agent] network error on attempt ${attempt + 1}:`, lastFetchError.message);
          continue;
        }
        if (r.ok) { res = r; break; }
        if (r.status === 400) {
          const lastMsg = loopForRequest[loopForRequest.length - 1];
          const hasTrailingVision =
            lastMsg?.role === 'user' &&
            Array.isArray(lastMsg.content) &&
            (lastMsg.content as any[]).some((p: any) => p.type === 'image_url');
          if (hasTrailingVision && attempt === 0) {
            const label = (lastMsg.content as any[]).find((p: any) => p.type === 'text')?.text ?? 'Canvas screenshot taken';
            loopForRequest = [
              ...loopForRequest.slice(0, -1),
              { role: 'user' as const, content: `${label} (image omitted — too large for API)` },
            ];
            activeTools = filterCopilotToolsForTurn(tools, loopForRequest, round);
            console.warn('[agent] 400 with vision message — retrying without image');
            continue;
          }
          res = r; break;
        }
        if (r.status < 500) { res = r; break; }
        const errText = await r.text();
        const cleanMsg = errText.trim().startsWith('<')
          ? `GitHub returned a ${r.status} (server error) — please retry in a moment`
          : `Copilot API error ${r.status}: ${errText}`;
        lastFetchError = new Error(cleanMsg);
      }
      if (!res) throw lastFetchError!;

      if (!res.ok) {
        const errText = await res.text();
        const errorMeta = buildDumpMeta(requestContext, initiator, {
          requestId: res.headers.get('request-id'),
          githubRequestId: res.headers.get('x-github-request-id'),
          copilotUsage: res.headers.get('copilot_usage'),
        });
        setLastRequestDump(buildRequestDump(loopForRequest, resolvedModel, activeTools, res.status, errText, errorMeta));
        console.error('[agent] API error diagnostic:\n' + buildRequestDump(loopForRequest, resolvedModel, activeTools, res.status, errText, errorMeta));
        let cleanMsg: string;
        if (errText.trim().startsWith('<')) {
          cleanMsg = `GitHub returned a ${res.status} (server error) — please retry in a moment`;
        } else {
          try {
            const parsed = JSON.parse(errText);
            const msg = parsed?.error?.message ?? parsed?.message ?? errText;
            cleanMsg = `Copilot API error ${res.status}: ${msg}`;
          } catch {
            cleanMsg = `Copilot API error ${res.status}: ${errText}`;
          }
        }
        if (res.status === 429 || res.status === 402 || isQuotaError(cleanMsg)) {
          updateRateLimit({ quotaExceeded: true, remaining: 0 });
        }
        registerIncompatibleChatCompletionsModelFromError(cleanMsg);
        throw new Error(cleanMsg);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');
      {
        const remaining = res.headers.get('x-ratelimit-remaining') ?? res.headers.get('x-copilot-quota-remaining');
        const limit = res.headers.get('x-ratelimit-limit') ?? res.headers.get('x-copilot-quota-limit');
        updateRateLimit({
          remaining: remaining !== null ? parseInt(remaining, 10) : undefined,
          limit: limit !== null ? parseInt(limit, 10) : undefined,
          quotaExceeded: false,
        });
      }
      requestId = res.headers.get('request-id');
      githubRequestId = res.headers.get('x-github-request-id');
      copilotUsage = res.headers.get('copilot_usage');

      const decoder = new TextDecoder();
      let buffer = '';

      let fullContent = '';
      const toolCallsMap = new Map<number, any>();
      let finishReason: string | null = null;
      let functionCallFallback: any = null;

      let streamBuffer = '';
      let isInsideToolCall = false;
      let toolCallBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const chunk: CopilotStreamChunk = JSON.parse(trimmed.slice(6));
            if (chunk.usage) requestUsage = chunk.usage;
            const choice = chunk.choices[0];
            if (!choice) continue;

            if (choice.finish_reason) {
              finishReason = choice.finish_reason;
            }

            const delta = choice.delta;
            if (!delta) continue;

            if (delta.content) {
              fullContent += delta.content;

              streamBuffer += delta.content;
              while (true) {
                if (!isInsideToolCall) {
                  const invokeIdx = streamBuffer.indexOf('<invoke');
                  const toolCallIdx = streamBuffer.indexOf('<tool_call');
                  const jsonIdx = streamBuffer.indexOf('```json\n');

                  let startIdx = -1;
                  if (invokeIdx !== -1) startIdx = startIdx === -1 ? invokeIdx : Math.min(startIdx, invokeIdx);
                  if (toolCallIdx !== -1) startIdx = startIdx === -1 ? toolCallIdx : Math.min(startIdx, toolCallIdx);
                  if (jsonIdx !== -1) startIdx = startIdx === -1 ? jsonIdx : Math.min(startIdx, jsonIdx);

                  if (startIdx !== -1) {
                    const textBefore = streamBuffer.slice(0, startIdx);
                    if (textBefore) onChunk(textBefore);
                    isInsideToolCall = true;
                    toolCallBuffer = streamBuffer.slice(startIdx);
                    streamBuffer = '';
                  } else {
                    const lastLess = streamBuffer.lastIndexOf('<');
                    const lastTick = streamBuffer.lastIndexOf('`');
                    const holdIdx = Math.max(lastLess, lastTick);
                    if (holdIdx !== -1) {
                      // Cap the holdback window to avoid blocking visible text indefinitely.
                      // We only need to hold back enough chars to detect any tool-call prefix
                      // (<invoke=7, <tool_call=10, ```json\n=8) → 12 chars is ample.
                      // Without this cap, a literal '<' early in the buffer (e.g. "x < y")
                      // causes everything after it to be withheld until the stream ends,
                      // making the UI appear frozen mid-response.
                      const MAX_HOLDBACK = 12;
                      const safeHoldIdx = Math.max(holdIdx, streamBuffer.length - MAX_HOLDBACK);
                      const textToFlush = streamBuffer.slice(0, safeHoldIdx);
                      if (textToFlush) onChunk(textToFlush);
                      streamBuffer = streamBuffer.slice(safeHoldIdx);
                    } else {
                      if (streamBuffer) onChunk(streamBuffer);
                      streamBuffer = '';
                    }
                    break;
                  }
                } else {
                  toolCallBuffer += streamBuffer;
                  streamBuffer = '';
                  const invokeEnd = toolCallBuffer.indexOf('</invoke>');
                  const toolCallEnd = toolCallBuffer.indexOf('</tool_call>');
                  const jsonEnd = toolCallBuffer.indexOf('\n```', 8);
                  let endIdx = -1;
                  if (invokeEnd !== -1) endIdx = invokeEnd + 9;
                  else if (toolCallEnd !== -1) endIdx = toolCallEnd + 12;
                  else if (jsonEnd !== -1) endIdx = jsonEnd + 4;
                  if (endIdx !== -1) {
                    isInsideToolCall = false;
                    streamBuffer = toolCallBuffer.slice(endIdx);
                    toolCallBuffer = '';
                  } else {
                    break;
                  }
                }
              }
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (!toolCallsMap.has(tc.index)) {
                  toolCallsMap.set(tc.index, {
                    id: tc.id || `call_${Date.now()}_${tc.index}`,
                    type: 'function',
                    function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' }
                  });
                } else {
                  const existing = toolCallsMap.get(tc.index);
                  if (tc.function?.name) existing.function.name += tc.function.name;
                  if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
                }
              }
            }

            if ((delta as any).function_call) {
              const fc = (delta as any).function_call;
              if (!functionCallFallback) {
                functionCallFallback = { name: fc.name || '', arguments: fc.arguments || '' };
              } else {
                if (fc.name) functionCallFallback.name += fc.name;
                if (fc.arguments) functionCallFallback.arguments += fc.arguments;
              }
            }
          } catch {
            // skip malformed lines
          }
        }
      }

      // Flush remaining stream buffer
      if (!isInsideToolCall && streamBuffer) {
        onChunk(streamBuffer);
      }

      console.debug('[agent] round', round, 'finish_reason:', finishReason,
        'native tool_calls:', toolCallsMap.size,
        'content length:', fullContent.length);

      setLastRequestDump(buildRequestDump(
        loopForRequest,
        resolvedModel,
        activeTools,
        undefined,
        undefined,
        buildDumpMeta(requestContext, initiator, {
          requestId,
          githubRequestId,
          usage: requestUsage,
          copilotUsage,
        }),
      ));

      const nativeToolCalls = Array.from(toolCallsMap.values());
      if (nativeToolCalls.length === 0 && functionCallFallback) {
        nativeToolCalls.push({
          id: `call_${Date.now()}`,
          type: 'function',
          function: functionCallFallback
        });
      }
      const textToolCalls = nativeToolCalls.length === 0
        ? parseTextToolCalls(fullContent)
        : [];
      const allToolCalls = [...nativeToolCalls, ...textToolCalls];
      console.debug('[agent] allToolCalls:', allToolCalls.map(tc => tc.function.name));

      if (allToolCalls.length === 0) {
        onDone();
        return;
      }

      const cleanAssistantContent = fullContent
        .replace(/<(?:tool_call|invoke)[^>]*>[\s\S]*?<\/(?:tool_call|invoke)>/g, '')
        .replace(/<(?:tool_response|function_results)[^>]*>[\s\S]*?<\/(?:tool_response|function_results)>/g, '')
        .replace(/<\/?function_calls>/g, '')
        .trim();
      loop.push({
        role: 'assistant',
        content: cleanAssistantContent,
        tool_calls: allToolCalls,
      });

      if (cleanAssistantContent) {
        onChunk('\n\n');
      }

      const toolResultsOrdered = await Promise.all(
        allToolCalls.map(async (tc) => {
          const parsedArgs = parseToolArguments(tc.function.arguments);
          const args = parsedArgs.ok
            ? parsedArgs.value
            : { _invalid_json: parsedArgs.preview };

          const activity: ToolActivity = { callId: tc.id, name: tc.function.name, args };
          onToolActivity(activity);

          let result: string;
          try {
            if (!parsedArgs.ok) {
              const rewriteHint = tc.function.name === 'write_workspace_file'
                ? [
                    '',
                    'This usually means the JSON was truncated mid-write.',
                    'If you are editing an existing large file, resend the change with patch_workspace_file or multi_patch instead of rewriting the whole file.',
                    'If you really need write_workspace_file, resend a complete JSON object with both "path" and "content".',
                  ].join('\n')
                : '';
              result = [
                `Error: Invalid JSON format in tool call arguments for ${tc.function.name}.`,
                parsedArgs.error,
                rewriteHint,
                '',
                'Raw arguments preview:',
                parsedArgs.preview,
              ].filter(Boolean).join('\n');
              activity.error = result;
            } else {
              result = await executeTool(tc.function.name, args);
              activity.result = result;
            }
          } catch (e) {
            result = `Error: ${e}`;
            activity.error = result;
          }
          onToolActivity({ ...activity, result, error: activity.error });
          return { tc, result };
        }),
      );

      for (const { tc, result } of toolResultsOrdered) {
        const MAX_TOOL_RESULT = 32_000;
        const safeResult = result.length > MAX_TOOL_RESULT
          ? result.slice(0, MAX_TOOL_RESULT) + `\n[...truncated ${result.length - MAX_TOOL_RESULT} chars]`
          : result;
        loop.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: safeResult || '(empty result)',
        });
      }

      // ── Context management ────────────────────────────────────────────────
      // Prune stale vision messages BEFORE the budget check so images don't
      // artificially inflate the estimate or block compression when it's needed.
      const firstAssistantIdxForPrune = loop.findIndex((m) => m.role === 'assistant');
      if (firstAssistantIdxForPrune !== -1) {
        const staleVisionIdxs = loop.reduce<number[]>((acc, m, i) => {
          if (i > firstAssistantIdxForPrune &&
              m.role === 'user' && Array.isArray(m.content) &&
              (m.content as any[]).some((p: any) => p.type === 'image_url')) acc.push(i);
          return acc;
        }, []);
        // Keep only the most recent vision message; drop all older ones.
        if (staleVisionIdxs.length > 1) {
          for (let i = staleVisionIdxs.length - 2; i >= 0; i--) {
            loop.splice(staleVisionIdxs[i], 1);
          }
        }
      }

      const estimatedTok = estimateTokens(loop);
      console.debug('[agent] estimated tokens after round', round, ':', estimatedTok);

      if (estimatedTok > budgets.compressBudget) {
        onChunk('\n\n_[Context approaching limit — summarizing prior session and continuing...]_\n\n');
        const compressed = await summarizeAndCompress(
          loop,
          buildCopilotHeaders(sessionToken, requestContext, 'agent'),
          resolvedModel,
          workspacePath,
          sessionId ?? 's_unknown',
          round,
        );
        loop.splice(0, loop.length, ...compressed);
        console.debug('[agent] context compressed to', loop.length, 'messages (~', estimateTokens(loop), 'tokens)');
      } else {
        const MAX_KEEP_ROUNDS = 25;
        const firstAssistantIdx = loop.findIndex((m) => m.role === 'assistant');
        if (firstAssistantIdx !== -1) {
          const assistantIdxs: number[] = [];
          for (let i = firstAssistantIdx; i < loop.length; i++) {
            if (loop[i].role === 'assistant') assistantIdxs.push(i);
          }
          if (assistantIdxs.length > MAX_KEEP_ROUNDS) {
            const keepFrom = assistantIdxs[assistantIdxs.length - MAX_KEEP_ROUNDS];
            loop.splice(firstAssistantIdx, keepFrom - firstAssistantIdx);
          }
        }
      }

      // ── Inject canvas / HTML preview screenshots as vision messages ───────
      const SENTINEL_CANVAS  = '__CANVAS_PNG__:';
      const SENTINEL_PREVIEW = '__PREVIEW_PNG__:';
      if (modelSupportsVision(resolvedModel)) {
        let latestScreenshotUrl = '';
        let latestScreenshotLabel = '';

        for (const msg of loop) {
          if (msg.role === 'tool' && typeof msg.content === 'string') {
            const c = msg.content as string;
            if (c.startsWith(SENTINEL_CANVAS)) {
              latestScreenshotUrl   = c.slice(SENTINEL_CANVAS.length);
              latestScreenshotLabel = 'Canvas screenshot after your modifications — verify layout, colors, and content:';
              (msg as any).content  = 'Canvas screenshot taken — see image below.';
            } else if (c.startsWith(SENTINEL_PREVIEW)) {
              latestScreenshotUrl   = c.slice(SENTINEL_PREVIEW.length);
              latestScreenshotLabel = 'HTML preview screenshot — verify the rendered layout, spacing, and visual design:';
              (msg as any).content  = 'HTML preview screenshot taken — see image below.';
            }
          }
        }

        const firstAssistantIdxForVision = loop.findIndex((m) => m.role === 'assistant');
        const visionIdxsForPrune = loop.reduce<number[]>((acc, m, i) => {
          if (i > firstAssistantIdxForVision &&
              m.role === 'user' && Array.isArray(m.content) &&
              (m.content as any[]).some((p: any) => p.type === 'image_url')) acc.push(i);
          return acc;
        }, []);
        if (visionIdxsForPrune.length > 0) {
          for (let i = visionIdxsForPrune.length - 1; i >= 0; i--) {
            loop.splice(visionIdxsForPrune[i], 1);
          }
        }

        if (latestScreenshotUrl) {
          const isValidDataUrl =
            latestScreenshotUrl.startsWith('data:image/') &&
            latestScreenshotUrl.includes(';base64,') &&
            latestScreenshotUrl.length > 300;
          if (isValidDataUrl) {
            loop.push({
              role: 'user',
              content: [
                { type: 'text', text: latestScreenshotLabel },
                { type: 'image_url', image_url: { url: latestScreenshotUrl } },
              ],
            } as any);
          }
        }
      } else {
        for (const msg of loop) {
          if (msg.role === 'tool' && typeof msg.content === 'string') {
            const c = msg.content as string;
            if (c.startsWith(SENTINEL_CANVAS)) {
              (msg as any).content = 'Canvas screenshot skipped (model does not support vision).';
            } else if (c.startsWith(SENTINEL_PREVIEW)) {
              (msg as any).content = 'HTML preview screenshot skipped (model does not support vision).';
            }
          }
        }
      }
    }

    onChunk(
      `\n\n⚠️ O agente atingiu o limite de ${MAX_ROUNDS} rodadas e pode não ter terminado. ` +
      `Clique em **Continuar** para retomar aonde parou.`,
    );
    onExhausted?.();
    onDone();
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.message === 'AbortError')) return;
    onError(humanizeNetworkError(err instanceof Error ? err : new Error(String(err))));
  }
}
