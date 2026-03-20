import { fetch } from '@tauri-apps/plugin-http';
import type { ChatMessage, CopilotStreamChunk, CopilotModel, ToolActivity } from '../../types';
import { DEFAULT_MODEL } from '../../types';
import type { ToolDefinition, ToolExecutor } from '../../utils/workspaceTools';
import { COPILOT_API_URL, EDITOR_HEADERS } from './constants';
import {
  CopilotDiagnosticError,
  buildRequestDump,
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
} from './models';
import { parseTextToolCalls, humanizeNetworkError } from './toolParsing';
import { summarizeAndCompress } from './compression';

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
    const resolvedModel = resolveCopilotModelForChatCompletions(model);
    if (resolvedModel !== model) {
      console.warn(`[Copilot] model "${model}" is not accessible via /chat/completions; using "${resolvedModel}" instead`);
    }

    const cleanMessages = sanitizeLoop([...messages]);
    setLastRequestDump(buildRequestDump(cleanMessages, resolvedModel, tools));

    const MAX_RETRIES = 3;
    let response: Awaited<ReturnType<typeof fetch>> | null = null;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (signal?.aborted) return;
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      }
      const MAX_PAYLOAD_BYTES = 6 * 1024 * 1024; // 6 MB
      let messagesForRequest = cleanMessages;
      const bodyCandidate = JSON.stringify({
        model: resolvedModel,
        messages: cleanMessages,
        ...(tools ? { tools, tool_choice: 'auto' } : {}),
        stream: true,
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
      let r: Awaited<ReturnType<typeof fetch>>;
      try {
        r = await fetch(COPILOT_API_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sessionToken}`,
            'Content-Type': 'application/json',
            ...EDITOR_HEADERS,
          },
          signal,
          body: JSON.stringify({
            model: resolvedModel,
            messages: messagesForRequest,
            ...(tools ? { tools, tool_choice: 'auto' } : {}),
            stream: true,
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
      setLastRequestDump(buildRequestDump(cleanMessages, resolvedModel, tools, response.status, errorText));
      console.error('[Copilot] API error diagnostic:\n' + buildRequestDump(cleanMessages, resolvedModel, tools));

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
          const text = chunk.choices[0]?.delta?.content;
          if (text) onChunk(text);
        } catch {
          // skip malformed lines
        }
      }
    }

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
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      'Content-Type': 'application/json',
      ...EDITOR_HEADERS,
    },
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
    const resolvedModel = resolveCopilotModelForChatCompletions(model);
    if (resolvedModel !== model) {
      console.warn(`[agent] model "${model}" is not accessible via /chat/completions; using "${resolvedModel}" instead`);
    }
    const headers = {
      Authorization: `Bearer ${sessionToken}`,
      'Content-Type': 'application/json',
      ...EDITOR_HEADERS,
    };

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

      for (let attempt = 0; attempt < 3; attempt++) {
        if (signal?.aborted) return;
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
        setLastRequestDump(buildRequestDump(loopForRequest, resolvedModel, tools));
        let r: Awaited<ReturnType<typeof fetch>>;
        try {
          r = await fetch(COPILOT_API_URL, {
            method: 'POST',
            headers,
            signal,
            body: JSON.stringify({
              model: resolvedModel,
              messages: loopForRequest,
              tools,
              tool_choice: 'auto',
              stream: true,
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
        setLastRequestDump(buildRequestDump(loopForRequest, resolvedModel, tools, res.status, errText));
        console.error('[agent] API error diagnostic:\n' + buildRequestDump(loopForRequest, resolvedModel, tools));
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
        throw new Error(cleanMsg);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

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
            const chunk = JSON.parse(trimmed.slice(6));
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
                      const textToFlush = streamBuffer.slice(0, holdIdx);
                      if (textToFlush) onChunk(textToFlush);
                      streamBuffer = streamBuffer.slice(holdIdx);
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
          const args = (() => {
            try { return JSON.parse(tc.function.arguments) as Record<string, unknown>; }
            catch { return {} as Record<string, unknown>; }
          })();

          const activity: ToolActivity = { callId: tc.id, name: tc.function.name, args };
          onToolActivity(activity);

          let result: string;
          try {
            result = await executeTool(tc.function.name, args);
            activity.result = result;
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
          headers,
          resolvedModel,
          workspacePath,
          sessionId ?? 's_unknown',
          round,
        );
        loop.splice(0, loop.length, ...compressed);
        console.debug('[agent] context compressed to', loop.length, 'messages (~', estimateTokens(loop), 'tokens)');
      } else {
        const MAX_KEEP_ROUNDS = 14;
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
