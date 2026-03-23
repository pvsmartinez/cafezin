import { useState, useRef, useCallback, useEffect } from 'react';
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
  AgentContextSnapshot,
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
  onPathRenamed?: (fromPath: string, toPath: string) => void;
  getLiveFileContent?: (relPath: string) => string | null;
  isFileDirty?: (relPath: string) => boolean;
  getAgentContextSnapshot?: () => AgentContextSnapshot;
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
  retryContext?: {
    partialForRetry?: string;
    errorContextForRetry?: string;
  },
): ChatMessage[] {
  const partial = retryContext?.partialForRetry?.trim();
  const errorContext = retryContext?.errorContextForRetry?.trim();
  if (!partial && !errorContext) return newMessages;

  const compactErrorContext = (() => {
    if (!errorContext) return '';
    const important = errorContext
      .split('\n')
      .filter((line) => /copilot api error|status\s+:|error body:|request id|github request|invalid json|tool_call id=|raw arguments preview:/i.test(line))
      .join('\n')
      .trim();
    const source = important.length >= 80 ? important : errorContext;
    return source.length > 1400 ? `${source.slice(0, 1400)}\n[truncated]` : source;
  })();
  const compactPartial = (() => {
    if (!partial) return '';
    if (partial.length <= 1200) return partial;
    return `[earlier partial output omitted]\n${partial.slice(-1100)}`;
  })();

  const blocks = [
    '[Retry note]',
  ];

  if (compactErrorContext) {
    blocks.push(
      'Your previous attempt failed. Use the compact error details below to avoid repeating the same mistake.',
      '',
      'Previous error details:',
      '---',
      compactErrorContext,
      '---',
    );
  }

  if (compactPartial) {
    blocks.push(
      'Your previous response was interrupted before completion.',
      'Continue from the partial assistant output below without restarting from the beginning.',
      'Do not repeat text that was already written unless needed to finish the sentence cleanly.',
      '',
      'Partial assistant output:',
      '---',
      compactPartial,
      '---',
    );
  }

  const retryInstruction = blocks.join('\n');

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
  onPathRenamed,
  getLiveFileContent,
  isFileDirty,
  getAgentContextSnapshot,
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
    /** Diagnostic error context captured on failure so retry can avoid repeating it. */
    errorContextForRetry?: string;
  }
  const retryPayloadRef = useRef<RetryPayload | null>(null);
  const lastSeenContextRef = useRef<Pick<AgentContextSnapshot, 'activeFile' | 'activeFileRevision' | 'workspaceStructureRevision' | 'workspaceChangeSeq'> & { activeFileContent?: string } | null>(null);

  /**
   * Computes a compact unified-diff-style summary of what changed between two text versions.
   * Covers the contiguous changed region (first diff from top, first diff from bottom)
   * with `ctx` lines of surrounding context. Capped at `maxLines` to avoid flooding context.
   */
  function computeLineDiff(oldText: string, newText: string, ctx = 3, maxLines = 80): string {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    // Find first differing line from the top
    let top = 0;
    while (top < oldLines.length && top < newLines.length && oldLines[top] === newLines[top]) top++;
    if (top === oldLines.length && top === newLines.length) return '(no textual changes detected)';
    // Find first differing line from the bottom
    let oldBot = oldLines.length - 1;
    let newBot = newLines.length - 1;
    while (oldBot > top && newBot > top && oldLines[oldBot] === newLines[newBot]) { oldBot--; newBot--; }
    // Build diff block with context
    const ctxStart = Math.max(0, top - ctx);
    const parts: string[] = [];
    const oldFrom = top + 1;
    const newFrom = top + 1;
    const oldCount = oldBot - top + 1;
    const newCount = newBot - top + 1;
    parts.push(`@@ -${oldFrom},${oldCount} +${newFrom},${newCount} @@`);
    for (let i = ctxStart; i < top; i++) parts.push(` ${oldLines[i]}`);
    for (let i = top; i <= oldBot; i++) parts.push(`-${oldLines[i]}`);
    for (let i = top; i <= newBot; i++) parts.push(`+${newLines[i]}`);
    for (let i = 1; i <= ctx; i++) {
      if (oldBot + i < oldLines.length) parts.push(` ${oldLines[oldBot + i]}`);
    }
    if (parts.length > maxLines) {
      return parts.slice(0, maxLines).join('\n') + '\n[… diff truncated]';
    }
    return parts.join('\n');
  }

  function setIsStreaming(v: boolean) {
    setIsStreamingState(v);
    onStreamingChange?.(v);
  }

  function buildContextFreshnessNote(snapshot: AgentContextSnapshot): string {
    const previous = lastSeenContextRef.current;
    const lines = [
      '[Live editor/workspace state for this request]',
      `Active file: ${snapshot.activeFile ?? '(none)'}`,
      `Active file revision: ${snapshot.activeFileRevision}`,
      `Unsaved changes in active file: ${snapshot.activeFileDirty ? 'yes' : 'no'}`,
      `Autosave pending for active file: ${snapshot.autosavePending ? 'yes' : 'no'}`,
      `Workspace structure revision: ${snapshot.workspaceStructureRevision}`,
    ];

    if (!previous) {
      lines.push('This agent has not seen this live editor/workspace snapshot yet.');
    } else {
      const sameFile = snapshot.activeFile === previous.activeFile;
      const activeFileChanged = !sameFile || snapshot.activeFileRevision !== previous.activeFileRevision;
      const workspaceChanged = snapshot.workspaceStructureRevision !== previous.workspaceStructureRevision;
      lines.push(
        `Changed since this agent last sent a request: active file ${activeFileChanged ? 'yes' : 'no'}; workspace structure ${workspaceChanged ? 'yes' : 'no'}.`,
      );

      if (activeFileChanged && sameFile && previous.activeFileContent && snapshot.activeFileContent) {
        // Show a compact diff so the agent sees exactly what changed without needing to re-read the whole file
        const diff = computeLineDiff(previous.activeFileContent, snapshot.activeFileContent);
        lines.push(
          `\n⚠ IMPORTANT: "${snapshot.activeFile}" was edited since your last response. ` +
          'Do NOT rely on file content from earlier in this conversation — it is stale. ' +
          'The diff below shows exactly what changed. If you need the full current text, call read_workspace_file.',
        );
        lines.push(`\n--- ${snapshot.activeFile} (previous)\n+++ ${snapshot.activeFile} (current)\n${diff}`);
      } else if (activeFileChanged) {
        lines.push(
          `\n⚠ IMPORTANT: The active file has changed since your last response. ` +
          'Any file content from earlier in this conversation may be stale. ' +
          'Call read_workspace_file to get the current content before answering questions about its text.',
        );
      }

      const recentChanges = snapshot.recentWorkspaceChanges
        .filter((change) => change.seq > previous.workspaceChangeSeq)
        .slice(-6);
      if (recentChanges.length > 0) {
        lines.push('Recent workspace changes since the last request:');
        for (const change of recentChanges) lines.push(`- ${change.summary}`);
      }
    }

    lines.push(
      'Treat this live state as newer than earlier conversation turns. ' +
      'If file paths or structure matter and the workspace changed, rerun outline_workspace or search_workspace_index. ' +
      'If exact text matters, prefer search_workspace and read_workspace_file because they can inspect live open buffers.',
    );

    return lines.join('\n');
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

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      unlockAllByAgent(agentId);
      askUserResolveRef.current?.('');
      askUserResolveRef.current = null;
      onStreamingChange?.(false);
    };
  }, [agentId, onStreamingChange]);

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
        if (retryPayloadRef.current) {
          const maybeDetail = typeof (err as Error & { detail?: unknown }).detail === 'string'
            ? String((err as Error & { detail?: unknown }).detail).trim()
            : '';
          retryPayloadRef.current.errorContextForRetry = maybeDetail || err.message;
        }
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
        onPathRenamed,
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
        getLiveFileContent,
        isFileDirty,
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
    const contextFreshness = getAgentContextSnapshot?.();
    const freshnessContext = contextFreshness
      ? `${buildContextFreshnessNote(contextFreshness)}\n\n`
      : '';
    if (contextFreshness) {
      lastSeenContextRef.current = {
        activeFile: contextFreshness.activeFile,
        activeFileRevision: contextFreshness.activeFileRevision,
        workspaceStructureRevision: contextFreshness.workspaceStructureRevision,
        workspaceChangeSeq: contextFreshness.workspaceChangeSeq,
        activeFileContent: contextFreshness.activeFileContent,
      };
    }
    const apiText = `${freshnessContext}${fileContext}${selectionContext}${prefix}${textToSend || 'Describe what you see in this screenshot and note any issues.'}`;

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
    const { newMessages, messagesWithUserMsg, userMsg, partialForRetry, errorContextForRetry } = retryPayloadRef.current;
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
    const apiMessages = buildRetryMessages(newMessages, { partialForRetry, errorContextForRetry });
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
