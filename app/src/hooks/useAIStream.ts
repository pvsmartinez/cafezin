import { useState, useRef, useCallback } from 'react';
import {
  runCopilotAgent,
  getLastRateLimit,
  isQuotaError,
  estimateTokens,
  getModelTokenBudgets,
  modelSupportsVision,
} from '../services/copilot';
import { streamChat, getActiveProvider } from '../services/aiProvider';
import { runProviderAgent } from '../services/ai/runProviderAgent';
import { appendLogEntry } from '../services/copilotLog';
import { getWorkspaceTools, buildToolExecutor } from '../utils/workspaceTools';
import { applyRiskGate } from '../utils/riskGate';
import type { RiskLevel } from '../utils/toolRisk';
import { canvasToDataUrl, compressDataUrl } from '../utils/canvasAI';
import { unlockAllByAgent } from '../services/copilotLock';
import type {
  AIRecordedTextMark,
  AISelectionContext,
  ChatMessage,
  ContentPart,
  CopilotModel,
  MessageItem,
  ToolActivity,
  Workspace,
  WorkspaceConfig,
  WorkspaceExportConfig,
} from '../types';
import type { Editor as TldrawEditor } from 'tldraw';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface QuotaInfo {
  remaining: number | null;
  limit: number | null;
  quotaExceeded: boolean;
}

export interface UseAIStreamParams {
  // ── Model / history ───────────────────────────────────────────────────────
  model: CopilotModel;
  systemPrompt: ChatMessage;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  sessionIdRef: React.MutableRefObject<string>;
  sessionStartedAtRef: React.MutableRefObject<string>;
  /** Called when the API returns NOT_AUTHENTICATED error. */
  onNotAuthenticated?: () => void;
  // ── Workspace / tools ─────────────────────────────────────────────────────
  workspace?: Workspace | null;
  workspacePath?: string;
  canvasEditorRef?: React.RefObject<TldrawEditor | null>;
  activeFile?: string;
  rescanFramesRef?: React.MutableRefObject<(() => void) | null>;
  workspaceExportConfig?: WorkspaceExportConfig;
  onExportConfigChange?: (cfg: WorkspaceExportConfig) => void;
  workspaceConfig?: WorkspaceConfig;
  onWorkspaceConfigChange?: (patch: Partial<WorkspaceConfig>) => void;
  onFileWritten?: (path: string) => void;
  onMarkRecorded?: (relPath: string, content: string, model: string, recordedMarks?: AIRecordedTextMark[]) => void;
  onCanvasMarkRecorded?: (relPath: string, shapeIds: string[], model: string) => void;
  // ── Misc ──────────────────────────────────────────────────────────────────
  webPreviewRef?: React.RefObject<{ getScreenshot: () => Promise<string | null> } | null>;
  getActiveHtml?: () => { html: string; absPath: string } | null;
  onStreamingChange?: (v: boolean) => void;
  setMemoryContent: (v: string) => void;
  setUserProfileContent?: (v: string) => void;
  /** Called after any task is created or a step is updated, so the UI can reload tasks. */
  onTaskChanged?: () => void;
  /** Identifier for this agent instance — used to release only this agent's file locks. */
  agentId?: string;
  /**
   * Current in-memory content of the active file (unsaved editor state).
   * Passed to patch tools so they operate on the live editor content rather
   * than potentially stale disk content.
   */
  activeFileContent?: string;
  /**
   * When false, all AI calls are blocked at the hook level (defence-in-depth,
   * even if the UI gate already handles it). Defaults to true when omitted so
   * existing callers are unaffected.
   */
  canUseAI?: boolean;
}

export function buildRetryMessages(
  newMessages: ChatMessage[],
  partialForRetry?: string,
): ChatMessage[] {
  const partial = partialForRetry?.trim();
  if (!partial) return newMessages;

  const retryInstruction = [
    '[Retry note]',
    'Your previous response was interrupted before completion.',
    'Continue from the partial assistant output below without restarting from the beginning.',
    'Do not repeat text that was already written unless needed to finish the sentence cleanly.',
    '',
    'Partial assistant output:',
    '---',
    partial,
    '---',
  ].join('\n');

  const nextMessages = [...newMessages];
  const lastMessage = nextMessages[nextMessages.length - 1];

  if (lastMessage?.role === 'user') {
    if (typeof lastMessage.content === 'string') {
      nextMessages[nextMessages.length - 1] = {
        ...lastMessage,
        content: `${lastMessage.content}\n\n${retryInstruction}`,
      };
      return nextMessages;
    }

    nextMessages[nextMessages.length - 1] = {
      ...lastMessage,
      content: [...lastMessage.content, { type: 'text', text: retryInstruction }],
    };
    return nextMessages;
  }

  return [...nextMessages, { role: 'user', content: retryInstruction }];
}

// ── useAIStream ───────────────────────────────────────────────────────────────
export function useAIStream({
  model,
  systemPrompt,
  messages,
  setMessages,
  sessionIdRef,
  sessionStartedAtRef,
  workspace,
  workspacePath,
  canvasEditorRef,
  activeFile,
  rescanFramesRef,
  workspaceExportConfig,
  onExportConfigChange,
  workspaceConfig,
  onWorkspaceConfigChange,
  onFileWritten,
  onMarkRecorded,
  onCanvasMarkRecorded,
  webPreviewRef,
  getActiveHtml,
  onStreamingChange,
  setMemoryContent,
  setUserProfileContent,
  onTaskChanged,
  onNotAuthenticated,
  agentId = 'agent-1',
  activeFileContent,
  canUseAI = true,
}: UseAIStreamParams) {
  const copilotOAuthClientId = workspaceConfig?.githubOAuth?.clientId?.trim() || undefined;
  const [isStreaming, setIsStreamingState] = useState(false);
  const [agentExhausted, setAgentExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaInfo, setQuotaInfo] = useState<QuotaInfo>({ remaining: null, limit: null, quotaExceeded: false });

  // ── ask_user (human-in-the-loop) ──────────────────────────────────────────
  const [askUserState, setAskUserState] = useState<{ question: string; options?: string[] } | null>(null);
  const [askUserInput, setAskUserInput] = useState('');
  const askUserResolveRef = useRef<((answer: string) => void) | null>(null);
  // ── Risk gate — session-level permission grants ───────────────────────────
  // This Set persists for the lifetime of this hook instance (i.e. one workspace session).
  // Medium/high risk tools will not re-prompt once the user grants for the session.
  const sessionRiskGrantedRef = useRef<Set<RiskLevel>>(new Set<RiskLevel>());
  // ── Live streaming items (text + tool calls interleaved) ──────────────────
  const [liveItems, setLiveItemsState] = useState<MessageItem[]>([]);
  const liveItemsRef = useRef<MessageItem[]>([]);

  function setLiveItems(updater: MessageItem[] | ((prev: MessageItem[]) => MessageItem[])) {
    setLiveItemsState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      liveItemsRef.current = next;
      return next;
    });
  }

  // ── Abort / run-id tracking ───────────────────────────────────────────────
  const abortRef  = useRef<AbortController | null>(null);
  const runIdRef  = useRef(0);

  interface RetryPayload {
    newMessages: ChatMessage[];
    messagesWithUserMsg: ChatMessage[];
    userMsg: ChatMessage;
    /** Partial assistant content captured on error — included in API context on retry
     *  so the model can continue its thread of thought. Not shown in UI. */
    partialForRetry?: string;
  }
  const retryPayloadRef = useRef<RetryPayload | null>(null);

  function setIsStreaming(v: boolean) {
    setIsStreamingState(v);
    onStreamingChange?.(v);
  }

  // ── ask_user ──────────────────────────────────────────────────────────────
  function onAskUser(question: string, options?: string[]): Promise<string> {
    return new Promise((resolve) => {
      askUserResolveRef.current = resolve;
      setAskUserInput('');
      setAskUserState({ question, options });
    });
  }

  function handleAskUserAnswer(answer: string) {
    if (!answer.trim()) return;
    setAskUserState(null);
    setAskUserInput('');
    askUserResolveRef.current?.(answer.trim());
    askUserResolveRef.current = null;
  }

  // Stable refs so the callbacks below can be wrapped in useCallback([]) without
  // capturing stale state. Updated on every render (same pattern as dirtyFilesRef).
  const isStreamingRef = useRef(false);
  isStreamingRef.current = isStreaming;

  // ── Stop ─────────────────────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleStop = useCallback(() => {
    if (!isStreamingRef.current) return;
    const partial = liveItemsRef.current
      .filter((it): it is { type: 'text'; content: string } => it.type === 'text')
      .map((it) => it.content).join('');
    if (partial.trim()) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: partial.trim() + '\n\n_[stopped]_' },
      ]);
    }
    abortRef.current?.abort();
    setLiveItems([]);
    setIsStreaming(false);
    unlockAllByAgent(agentId);
    setAskUserState(null);
    askUserResolveRef.current?.('');
    askUserResolveRef.current = null;
    runIdRef.current++;
  // agentId is a prop — stable for the lifetime of the agent instance.
  // All other accesses go through refs or stable setters.
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stream runner (shared by handleSend and retryLastSend) ───────────────
  async function _runStream(
    newMessages: ChatMessage[],
    userMsg: ChatMessage,
    runId: number,
    signal: AbortSignal,
  ): Promise<void> {
    let fullResponse = '';

    const onChunk = (chunk: string) => {
      if (runIdRef.current !== runId) return;
      fullResponse += chunk;
      setLiveItems((prev) => {
        const last = prev[prev.length - 1];
        if (last?.type === 'text') {
          return [...prev.slice(0, -1), { type: 'text', content: last.content + chunk }];
        }
        return [...prev, { type: 'text', content: chunk }];
      });
    };

    const onDone = () => {
      if (runIdRef.current !== runId) return;
      const capturedItems = liveItemsRef.current;
      const toolCount     = capturedItems.filter((it) => it.type === 'tool').length;
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: fullResponse,
          items: capturedItems.length > 0 ? capturedItems : undefined,
        },
      ]);
      setLiveItems([]);
      setIsStreaming(false);
      unlockAllByAgent(agentId);
      setQuotaInfo(getLastRateLimit());
      if (workspacePath) {
        void appendLogEntry(workspacePath, {
          sessionId: sessionIdRef.current,
          sessionStartedAt: sessionStartedAtRef.current,
          timestamp: new Date().toISOString(),
          model,
          userMessage: typeof userMsg.content === 'string' ? userMsg.content : '',
          aiResponse: fullResponse,
          ...(toolCount > 0 ? { toolCalls: toolCount } : {}),
        });
      }
    };

    const onError = (err: Error) => {
      if (runIdRef.current !== runId) return;
      const partial = liveItemsRef.current
        .filter((it): it is { type: 'text'; content: string } => it.type === 'text')
        .map((it) => it.content).join('');
      if (partial.trim()) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: partial.trim(),
            items: liveItemsRef.current.length > 0 ? liveItemsRef.current : undefined,
          },
        ]);
        // Save partial so retryLastSend can include it in API context (model continues
        // its thread of thought) while the UI is reset to a clean state.
        if (retryPayloadRef.current) {
          retryPayloadRef.current.partialForRetry = partial.trim();
        }
      }
      if (err.message === 'NOT_AUTHENTICATED') {
        onNotAuthenticated?.();
      } else {
        setError(err.message);
      }
      setLiveItems([]);
      setIsStreaming(false);
      unlockAllByAgent(agentId);
      setAskUserState(null);
      askUserResolveRef.current?.('');
      askUserResolveRef.current = null;
      setQuotaInfo(getLastRateLimit());
    };

    // ── Sliding-window token budget ──────────────────────────────────────
    const apiMessages = (() => {
      const CHAT_TOKEN_BUDGET = getModelTokenBudgets(model).chatBudget;
      const all = [systemPrompt, ...newMessages];
      if (estimateTokens(all) <= CHAT_TOKEN_BUDGET) return all;
      const firstUserIdx = all.findIndex((m, i) => i > 0 && m.role === 'user');
      const pinned = firstUserIdx >= 0 ? all.slice(0, firstUserIdx + 1) : [all[0]];
      const pinnedTokens = estimateTokens(pinned);
      const tail: typeof all = [];
      let tailTokens = 0;
      for (let i = all.length - 1; i > (firstUserIdx >= 0 ? firstUserIdx : 0); i--) {
        const t = estimateTokens([all[i]]);
        if (pinnedTokens + tailTokens + t > CHAT_TOKEN_BUDGET) break;
        tail.unshift(all[i]);
        tailTokens += t;
      }
      return [...pinned, ...tail];
    })();

    if (workspace) {
      const rawExecutor = buildToolExecutor({
        workspacePath: workspace.path,
        canvasEditor: canvasEditorRef ?? { current: null },
        onFileWritten,
        onMarkRecorded: (relPath, content, recordedMarks) =>
          onMarkRecorded?.(relPath, content, model, recordedMarks),
        onCanvasModified: (shapeIds) => {
          if (shapeIds.length > 0 && activeFile) {
            onCanvasMarkRecorded?.(activeFile, shapeIds, model);
          }
          rescanFramesRef?.current?.();
        },
        activeFile,
        workspaceExportConfig,
        onExportConfigChange,
        onMemoryWritten: setMemoryContent,
        webPreviewRef: webPreviewRef as { current: { getScreenshot: () => Promise<string | null> } | null } | undefined,
        onAskUser,
        getActiveHtml,
        workspaceConfig,
        onWorkspaceConfigChange,
        agentId,
        activeFileContent,
        onUserProfileWritten: setUserProfileContent,
        onTaskChanged,
      });
      const executor = applyRiskGate(rawExecutor, {
        workspaceConfig,
        onWorkspaceConfigChange,
        onAskUser,
        sessionGranted: sessionRiskGrantedRef.current,
      });

      const isMobilePlatform    = import.meta.env.VITE_TAURI_MOBILE === 'true';
      const activeTools = getWorkspaceTools(workspace, workspaceExportConfig).filter((t) => {
        if (isMobilePlatform && t.function.name === 'run_command') return false;
        return true;
      });

      const activeProvider = getActiveProvider();
      if (activeProvider === 'copilot') {
        await runCopilotAgent(
          apiMessages,
          activeTools,
          executor,
          onChunk,
          (activity: ToolActivity) => {
            if (runIdRef.current !== runId) return;
            setLiveItems((prev) => {
              const pIdx = prev.findIndex(
                (it) => it.type === 'tool' && it.activity.callId === activity.callId,
              );
              if (pIdx >= 0) {
                const next = [...prev]; next[pIdx] = { type: 'tool', activity }; return next;
              }
              return [...prev, { type: 'tool', activity }];
            });
          },
          onDone,
          onError,
          model,
          workspacePath,
          sessionIdRef.current,
          signal,
          () => { if (runIdRef.current === runId) setAgentExhausted(true); },
          copilotOAuthClientId,
        );
      } else {
        // Non-Copilot provider: full agentic loop via Vercel AI SDK streamText.
        await runProviderAgent(
          apiMessages,
          activeTools,
          executor,
          onChunk,
          (activity: ToolActivity) => {
            if (runIdRef.current !== runId) return;
            setLiveItems((prev) => {
              const pIdx = prev.findIndex(
                (it) => it.type === 'tool' && it.activity.callId === activity.callId,
              );
              if (pIdx >= 0) {
                const next = [...prev]; next[pIdx] = { type: 'tool', activity }; return next;
              }
              return [...prev, { type: 'tool', activity }];
            });
          },
          onDone,
          onError,
          model,
          workspacePath,
          sessionIdRef.current,
          signal,
          () => { if (runIdRef.current === runId) setAgentExhausted(true); },
        );
      }
    } else {
      await streamChat(
        apiMessages,
        onChunk,
        onDone,
        onError,
        model,
        signal,
        copilotOAuthClientId,
      );
    }
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  async function handleSend(
    imageOverride?: string,
    textOverride?: string,
    pendingImagesRef?: string[],
    pendingFileRefVal?: { name: string; content: string } | null,
    pendingSelectionContextVal?: AISelectionContext | null,
    input?: string,
    clearInputAndAttachments?: () => void,
  ): Promise<void> {    // Defence-in-depth: block AI calls when the account is not entitled.
    // The UI gate (PremiumGate component) is the primary barrier; this is the
    // safety net in case the gate is bypassed or the component is used directly.
    if (!canUseAI) {
      setError('Recurso disponível apenas no plano Premium. Acesse cafezin.app/premium para fazer upgrade.');
      return;
    }
    const textToSend = (textOverride ?? input ?? '').trim();
    if (!textToSend && !imageOverride && (!pendingImagesRef || pendingImagesRef.length === 0)) {
      if (isStreaming) handleStop();
      return;
    }

    // If an agent run is in progress, commit the partial response and abort it.
    if (isStreaming) {
      const partial = liveItemsRef.current
        .filter((it): it is { type: 'text'; content: string } => it.type === 'text')
        .map((it) => it.content).join('');
      if (partial.trim()) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: partial.trim() + '\n\n_[interrupted]_' },
        ]);
      }
      abortRef.current?.abort();
      setLiveItems([]);
      setAskUserState(null);
      askUserResolveRef.current?.('');
      askUserResolveRef.current = null;
    }

    const runId = ++runIdRef.current;
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setError(null);
    setLiveItems([]);
    clearInputAndAttachments?.();

    const capturedImages  = imageOverride ? [imageOverride] : (pendingImagesRef ?? []);
    const capturedFileRef = pendingFileRefVal ?? null;
    const capturedSelectionContext = pendingSelectionContextVal ?? null;
    const userMsg: ChatMessage = {
      role: 'user',
      content: textToSend || '📸',
      activeFile,
      ...(capturedImages.length === 1 ? { attachedImage: capturedImages[0] } : {}),
      ...(capturedImages.length > 0 ? { attachedImages: capturedImages } : {}),
      ...(capturedFileRef  ? { attachedFile: capturedFileRef.name }   : {}),
      ...(capturedSelectionContext ? { attachedSelectionLabel: capturedSelectionContext.label } : {}),
    };
    setMessages((prev) => [...prev, userMsg]); // show user message immediately
    setIsStreaming(true);
    setAgentExhausted(false);

    // Build multipart user message for the API
    const prefix     = activeFile ? `[Context: user sent this prompt while "${activeFile.split('/').pop()}" was open]\n` : '';
    const fileContext = capturedFileRef
      ? `[Attached file: "${capturedFileRef.name}"]\n---\n${capturedFileRef.content}\n---\n\n`
      : '';
    const selectionContext = capturedSelectionContext
      ? `[Attached selection: "${capturedSelectionContext.label}"]\n---\n${capturedSelectionContext.content}\n---\n\n`
      : '';
    const apiText = `${fileContext}${selectionContext}${prefix}${textToSend || 'Describe what you see in this screenshot and note any issues.'}`;

    let finalUserMsg: ChatMessage = (activeFile || capturedFileRef || capturedSelectionContext)
      ? { role: 'user', content: apiText }
      : userMsg;

    if (modelSupportsVision(model)) {
      const parts: ContentPart[] = [];
      if (canvasEditorRef?.current) {
        const url = await canvasToDataUrl(canvasEditorRef.current, 0.5);
        if (url) {
          const compressed = await compressDataUrl(url, 512, 0.65);
          parts.push({ type: 'text', text: 'Current canvas state (before any edits) — study this carefully before making changes:' });
          parts.push({ type: 'image_url', image_url: { url: compressed } });
        }
      }
      if (capturedImages.length > 0) {
        parts.push({
          type: 'text',
          text: capturedImages.length === 1 ? 'Attached image:' : `Attached images (${capturedImages.length}):`,
        });
        for (const capturedImage of capturedImages) {
          const compressedCapture = await compressDataUrl(capturedImage, 512, 0.65);
          parts.push({ type: 'image_url', image_url: { url: compressedCapture } });
        }
      }
      if (parts.length > 0) {
        parts.push({ type: 'text', text: apiText });
        finalUserMsg = { role: 'user', content: parts };
      }
    }

    const newMessages: ChatMessage[] = [...messages, finalUserMsg];

    retryPayloadRef.current = { newMessages, messagesWithUserMsg: [...messages, userMsg], userMsg };
    await _runStream(newMessages, userMsg, runId, signal);
  }

  /** Re-sends the last failed message without re-appending it to the messages array. */
  async function retryLastSend(): Promise<void> {
    if (!retryPayloadRef.current || isStreaming) return;
    const { newMessages, messagesWithUserMsg, userMsg, partialForRetry } = retryPayloadRef.current;
    const runId = ++runIdRef.current;
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setError(null);
    setLiveItems([]);
    setIsStreaming(true);
    setAgentExhausted(false);
    // Reset UI to before the partial — the continuation will replace it
    setMessages(messagesWithUserMsg);
    // Retry payloads must end with a user message. Claude rejects assistant prefill,
    // so we encode any partial output as continuation instructions on the last user turn.
    const apiMessages = buildRetryMessages(newMessages, partialForRetry);
    await _runStream(apiMessages, userMsg, runId, signal);
  }

  /** Clears live stream state — call alongside session.handleNewChat(). */
  const clearStream = useCallback(() => {
    setLiveItems([]);
    setIsStreamingState(false);
    setError(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isStreaming,
    agentExhausted,
    error,
    setError,
    quotaInfo,
    liveItems,
    askUserState,
    askUserInput,
    setAskUserInput,
    handleStop,
    handleSend,
    retryLastSend,
    handleAskUserAnswer,
    clearStream,
    isQuotaError,
  };
}
