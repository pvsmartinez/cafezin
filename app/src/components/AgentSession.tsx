/**
 * AgentSession — one self-contained Copilot agent instance (model, messages,
 * input, tools). Multiple AgentSession components can be mounted inside
 * AIPanel at the same time; only the active one is visible.
 */
import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import {
  X, ArrowUp, Warning, Camera, Paperclip,
  Microphone, Stop, ArrowCounterClockwise, Sparkle, FileText,
} from '@phosphor-icons/react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { readFile } from '../services/fs';

import { getLastRequestDump, modelSupportsVision, resolveCopilotModelForChatCompletions } from '../services/copilot';
import { getActiveModel, type AIProviderType, PROVIDER_SHORT_LABELS } from '../services/aiProvider';
import { getLastProviderRequestDump } from '../services/ai/diagnostics';
import { getProviderCatalog } from '../services/ai/providerModels';
import { DEFAULT_MODEL } from '../types';
import type { AIRecordedTextMark, AISelectionContext, CopilotModel, CopilotModelInfo, MessageItem, Task } from '../types';
import type { Workspace, WorkspaceExportConfig, WorkspaceConfig } from '../types';
import type { Editor as TldrawEditor } from 'tldraw';
import { getMimeType, IMAGE_EXTS } from '../utils/mime';
import { getActiveTask } from '../services/taskService';

import { ModelPicker } from './ai/AIModelPicker';
import { CodeBlock, parseSegments } from './ai/AICodeBlock';
import { AIMarkdownText } from './ai/AIMarkdownText';
import { ToolItem, useSessionStats } from './ai/AIToolProcess';

import { useAISession, contentToString, fmtRelative } from '../hooks/useAISession';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { useSystemPrompt, useWorkspaceMemory, useUserProfile } from '../hooks/useSystemPrompt';
import { useAIStream } from '../hooks/useAIStream';
import { useAIScreenshot } from '../hooks/useAIScreenshot';
import { loadHistoricalSessions, type HistoricalSession } from '../services/aiSessionHistory';

// ── Types ─────────────────────────────────────────────────────────────────────

const MAX_PENDING_IMAGES = 4;

export interface AgentSessionProps {
  /** Stable unique id for this agent tab (e.g. "agent-1", "agent-2-1710000000"). */
  agentId: string;
  /** Human-readable label shown in the tab. */
  agentLabel: string;
  /** Whether this tab is the visible one. Hidden tabs stay mounted so streaming continues. */
  isActive: boolean;

  // ── Auth (managed by parent AIPanel) ─────────────────────────────────────
  onNotAuthenticated: () => void;
  onSignOut?: () => void;
  activeProvider: AIProviderType;
  /** Shared model list loaded once by AIPanel. */
  availableModels: CopilotModelInfo[];
  modelsLoading: boolean;

  // ── Navigation ────────────────────────────────────────────────────────────
  onClose: () => void;

  // ── Workspace props (same as the old AIPanel) ─────────────────────────────
  initialPrompt?: string;
  initialModel?: string;
  onModelChange?: (model: string) => void;
  documentContext?: string;
  agentContext?: string;
  workspacePath?: string;
  workspace?: Workspace | null;
  memoryRefreshKey?: number;
  canvasEditorRef?: React.RefObject<TldrawEditor | null>;
  onFileWritten?: (path: string) => void;
  onMarkRecorded?: (relPath: string, content: string, model: string, recordedMarks?: AIRecordedTextMark[]) => void;
  onCanvasMarkRecorded?: (relPath: string, shapeIds: string[], model: string) => void;
  activeFile?: string;
  rescanFramesRef?: React.MutableRefObject<(() => void) | null>;
  workspaceExportConfig?: WorkspaceExportConfig;
  onExportConfigChange?: (config: WorkspaceExportConfig) => void;
  onStreamingChange?: (streaming: boolean) => void;
  /** Called when the agent's observable status changes (for tab indicators). */
  onStatusChange?: (status: 'idle' | 'thinking' | 'error') => void;
  /** Called when the user has scrolled to the bottom of the messages (clears unread). */
  onMessagesSeen?: () => void;
  screenshotTargetRef?: React.RefObject<HTMLElement | null>;
  webPreviewRef?: React.RefObject<{ getScreenshot: () => Promise<string | null> } | null>;
  getActiveHtml?: () => { html: string; absPath: string } | null;
  workspaceConfig?: WorkspaceConfig;
  appLocale?: 'en' | 'pt-BR';
  onWorkspaceConfigChange?: (patch: Partial<WorkspaceConfig>) => void;
  onOpenFileReference?: (relPath: string, lineNo?: number) => void | Promise<void>;
  selectionContext?: AISelectionContext | null;
}

export interface AgentSessionHandle {
  receiveFinderFiles(paths: string[]): void;
  /** Puts text into the agent input box and focuses it */
  injectText(text: string): void;
}

// ── Component ─────────────────────────────────────────────────────────────────

const AgentSession = forwardRef<AgentSessionHandle, AgentSessionProps>(function AgentSession({
  agentId,
  agentLabel,
  isActive,
  onNotAuthenticated,
  onSignOut,
  activeProvider,
  availableModels,
  modelsLoading,
  onClose,
  initialPrompt = '',
  initialModel,
  onModelChange,
  documentContext = '',
  agentContext = '',
  workspacePath,
  workspace,
  memoryRefreshKey = 0,
  canvasEditorRef,
  onFileWritten,
  onMarkRecorded,
  onCanvasMarkRecorded,
  activeFile,
  rescanFramesRef,
  workspaceExportConfig,
  onExportConfigChange,
  workspaceConfig,
  appLocale,
  onWorkspaceConfigChange,
  onStreamingChange,
  onStatusChange,
  onMessagesSeen,
  screenshotTargetRef,
  webPreviewRef,
  getActiveHtml,
  onOpenFileReference,
  selectionContext,
}, ref) {

  function resolveSessionModel(requestedModel?: string | null): CopilotModel {
    if (activeProvider === 'copilot') {
      return resolveCopilotModelForChatCompletions(requestedModel ?? DEFAULT_MODEL, availableModels);
    }

    const providerCatalog = getProviderCatalog(activeProvider);
    const providerCatalogIds = new Set(providerCatalog.map((item) => item.id));

    const requested = (requestedModel ?? '').trim();
    if (requested && providerCatalogIds.has(requested)) {
      return requested as CopilotModel;
    }

    const stored = getActiveModel();
    if (stored && providerCatalogIds.has(stored)) {
      return stored as CopilotModel;
    }

    return (providerCatalog[0]?.id ?? availableModels[0]?.id ?? requestedModel ?? DEFAULT_MODEL) as CopilotModel;
  }

  // ── Model ─────────────────────────────────────────────────────────────────
  const [model, setModel] = useState<CopilotModel>(() =>
    resolveSessionModel(initialModel ?? DEFAULT_MODEL),
  );
  useEffect(() => {
    setModel(resolveSessionModel(initialModel ?? DEFAULT_MODEL));
  }, [initialModel, availableModels, activeProvider]);

  // ── Input / attachments ───────────────────────────────────────────────────
  const [input, setInput] = useState(initialPrompt);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [pendingFileRef, setPendingFileRef] = useState<{ name: string; content: string } | null>(null);
  const [pendingSelectionContext, setPendingSelectionContext] = useState<AISelectionContext | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historicalSessions, setHistoricalSessions] = useState<HistoricalSession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  // true  → user is at the bottom → keep auto-scrolling during streaming
  // false → user scrolled up to read → freeze scroll
  const isPinnedToBottom = useRef(true);

  // When this tab becomes active, immediately clear unread if already scrolled to bottom
  useEffect(() => {
    if (!isActive) return;
    const el = messagesContainerRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 60) {
      onMessagesSeen?.();
    }
  // onMessagesSeen is stable from parent — safe to omit from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  // Focus when this tab becomes active
  useEffect(() => {
    if (!isActive) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    setInput(initialPrompt);
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const capped = el.scrollHeight > 200;
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    el.style.overflowY = capped ? 'auto' : 'hidden';
  }, [input]);

  // ── Domain hooks ──────────────────────────────────────────────────────────
  const [memoryContent, setMemoryContent] = useWorkspaceMemory(workspacePath, memoryRefreshKey);  const [userProfileContent, setUserProfileContent] = useUserProfile();

  // ── Active task (loaded from .cafezin/tasks.json) ─────────────────────────
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const reloadTask = useCallback(() => {
    if (!workspacePath) { setActiveTask(null); return; }
    getActiveTask(workspacePath).then(setActiveTask).catch(() => setActiveTask(null));
  }, [workspacePath]);
  useEffect(() => { reloadTask(); }, [reloadTask]);
  const session      = useAISession({
    model,
    agentId,
    workspacePath,
    allowLegacyRestore: agentId === 'agent-1',
  });
  const sessionStats = useSessionStats(session.messages);

  const systemPrompt = useSystemPrompt({
    model,
    workspace,
    workspacePath,
    documentContext,
    agentContext,
    activeFile,
    memoryContent,
    userProfileContent,
    activeTask,
    workspaceExportConfig,
    workspaceConfig,
  });

  const stream = useAIStream({
    model,
    systemPrompt,
    messages: session.messages,
    setMessages: session.setMessages,
    sessionIdRef: session.sessionIdRef,
    sessionStartedAtRef: session.sessionStartedAtRef,
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
    onTaskChanged: reloadTask,
    onNotAuthenticated,
    agentId,
    activeFileContent: documentContext,
  });

  const voice = useVoiceInput({
    onTranscript: (t) => setInput((prev) => prev ? `${prev} ${t}` : t),
    onError: (msg) => stream.setError(msg),
    workspaceLanguage: workspaceConfig?.preferredLanguage ?? workspace?.config?.preferredLanguage,
    appLocale,
  });

  const appendPendingImages = useCallback((incoming: string[]) => {
    if (incoming.length === 0) return;
    setPendingImages((prev) => {
      const remaining = Math.max(0, MAX_PENDING_IMAGES - prev.length);
      if (remaining === 0) {
        stream.setError(`You can attach up to ${MAX_PENDING_IMAGES} images per message.`);
        return prev;
      }
      const accepted = incoming.slice(0, remaining);
      if (accepted.length < incoming.length) {
        stream.setError(`Only the first ${MAX_PENDING_IMAGES} images will be sent.`);
      }
      return [...prev, ...accepted];
    });
  }, [stream]);

  const removePendingImageAt = useCallback((index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── Send ─────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async (imageOverride?: string, textOverride?: string) => {
    // Re-pin to bottom whenever user sends a new message
    isPinnedToBottom.current = true;
    await stream.handleSend(
      imageOverride,
      textOverride,
      pendingImages,
      pendingFileRef,
      pendingSelectionContext,
      input,
      () => { setInput(''); setPendingImages([]); setPendingFileRef(null); setPendingSelectionContext(null); },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.handleSend, pendingImages, pendingFileRef, pendingSelectionContext, input]);

  const screenshot = useAIScreenshot({
    canvasEditorRef,
    screenshotTargetRef,
    webPreviewRef,
    input,
    isStreaming: stream.isStreaming,
    onReady: (url) => handleSend(url),
    onStage: (url) => appendPendingImages([url]),
  });

  // ── Session actions ───────────────────────────────────────────────────────
  function handleRestoreSession() {
    const restoredModel = session.handleRestoreSession();
    if (restoredModel) {
      const resolved = resolveSessionModel(restoredModel);
      setModel(resolved);
      onModelChange?.(resolved);
    }
    setTimeout(() => {
      isPinnedToBottom.current = true;
      const el = messagesContainerRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, 100);
  }

  const closeHistoryPanel = useCallback(() => {
    setIsHistoryOpen(false);
    setHistoryError(null);
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const sessions = await loadHistoricalSessions(workspacePath);
      setHistoricalSessions(sessions.filter((entry) => entry.sessionId !== session.sessionIdRef.current));
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Falha ao carregar sessões antigas.');
      setHistoricalSessions([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [workspacePath, session.sessionIdRef]);

  const openHistoryPanel = useCallback(() => {
    setIsHistoryOpen(true);
    void loadHistory();
  }, [loadHistory]);

  const handleRestoreHistoricalSession = useCallback((historySession: HistoricalSession) => {
    const restoredModel = session.handleRestoreSpecificSession({
      messages: historySession.messages,
      model: historySession.model,
      savedAt: historySession.savedAt,
      sessionId: historySession.sessionId,
      startedAt: historySession.startedAt,
    });
    const resolved = resolveSessionModel(restoredModel);
    setModel(resolved);
    onModelChange?.(resolved);
    closeHistoryPanel();
    setTimeout(() => {
      isPinnedToBottom.current = true;
      const el = messagesContainerRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, 100);
  }, [closeHistoryPanel, onModelChange, session]);

  useEffect(() => {
    if (isPinnedToBottom.current) {
      // Use instant scroll during streaming (liveItems change every chunk —
      // queuing hundreds of smooth animations causes scroll jank and leaks
      // into the editor's scroll container via WKWebView momentum).
      const isStreaming = stream.isStreaming;
      const el = messagesContainerRef.current;
      if (el) {
        if (isStreaming) {
          el.scrollTop = el.scrollHeight;
        } else {
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        }
      }
    }
  }, [session.messages, stream.liveItems, stream.isStreaming]);

  // Flash the panel when streaming finishes
  const prevStreamingRef = useRef(false);
  const [justDone, setJustDone] = useState(false);
  useEffect(() => {
    if (prevStreamingRef.current && !stream.isStreaming) {
      setJustDone(true);
      const t = setTimeout(() => setJustDone(false), 1800);
      return () => clearTimeout(t);
    }
    prevStreamingRef.current = stream.isStreaming;
  }, [stream.isStreaming]);

  useEffect(() => {
    if (session.messages.length > 0 && isHistoryOpen) {
      setIsHistoryOpen(false);
    }
  }, [session.messages.length, isHistoryOpen]);

  // Notify parent of status changes for tab indicators
  useEffect(() => {
    if (stream.error) { onStatusChange?.('error'); }
    else if (stream.isStreaming) { onStatusChange?.('thinking'); }
    else { onStatusChange?.('idle'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.isStreaming, stream.error]);

  // ── Keyboard ─────────────────────────────────────────────────────────────
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape') {
      if (stream.isStreaming) stream.handleStop();
      else onClose();
    }
  }

  // ── Finder drop ───────────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    injectText(text: string) {
      setInput(text);
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    receiveFinderFiles(paths: string[]) {
      if (paths.length === 0) return;
      Promise.all(paths.map(async (filePath) => {
        const name = filePath.split('/').pop() ?? filePath;
        const ext = name.split('.').pop()?.toLowerCase() ?? '';
        const bytes = await readFile(filePath);
        if (IMAGE_EXTS.has(ext)) {
          const mime = getMimeType(ext, 'image/png');
          let binary = '';
          const CHUNK = 8192;
          for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
          }
          const b64 = btoa(binary);
          return { kind: 'image' as const, dataUrl: `data:${mime};base64,${b64}` };
        }
        const content = new TextDecoder().decode(bytes).slice(0, 20000);
        return { kind: 'file' as const, name, content };
      })).then((entries) => {
        appendPendingImages(entries.filter((entry) => entry.kind === 'image').map((entry) => entry.dataUrl));
        const firstFile = entries.find((entry) => entry.kind === 'file');
        if (firstFile && firstFile.kind === 'file') {
          setPendingFileRef({ name: firstFile.name, content: firstFile.content });
        }
      }).catch((err) => console.error('[AgentSession] receiveFinderFiles:', err));
    },
  }));

  // ── Drag + drop / paste ───────────────────────────────────────────────────
  function handleDragOver(e: React.DragEvent) { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }
  function handleDragLeave(e: React.DragEvent) { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    files.forEach((file) => {
      const reader = new FileReader();
      if (file.type.startsWith('image/')) {
        reader.onload = (ev) => {
          const url = ev.target?.result as string;
          if (url) appendPendingImages([url]);
        };
        reader.readAsDataURL(file);
        return;
      }
      reader.onload = (ev) => {
        const content = ev.target?.result as string;
        if (content != null) setPendingFileRef({ name: file.name, content: content.slice(0, 20000) });
      };
      reader.readAsText(file);
    });
  }

  async function handleAttachFile() {
    try {
      const selected = await openFileDialog({ multiple: true });
      if (!selected) return;
      const selectedPaths = Array.isArray(selected) ? selected : [selected];
      const encodedImages: string[] = [];
      for (const selectedPath of selectedPaths) {
        const name = selectedPath.split('/').pop() ?? selectedPath;
        const ext = name.split('.').pop()?.toLowerCase() ?? '';
        const bytes = await readFile(selectedPath);
        if (IMAGE_EXTS.has(ext)) {
          const mime = getMimeType(ext, 'image/png');
          let binary = '';
          const CHUNK = 8192;
          for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
          }
          const b64 = btoa(binary);
          encodedImages.push(`data:${mime};base64,${b64}`);
        } else {
          const content = new TextDecoder().decode(bytes).slice(0, 20000);
          setPendingFileRef({ name, content });
        }
      }
      appendPendingImages(encodedImages);
    } catch (err) { console.error('[attach-file]', err); }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((it) => it.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    imageItems.forEach((imgItem) => {
      const file = imgItem.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const url = ev.target?.result as string;
        if (url) appendPendingImages([url]);
      };
      reader.readAsDataURL(file);
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="ai-agent-session" style={{ display: isActive ? undefined : 'none' }}>
      {isHistoryOpen && (
        <div className="ai-history-overlay" onClick={closeHistoryPanel}>
          <div className="ai-history-panel" onClick={(event) => event.stopPropagation()}>
            <div className="ai-history-panel-header">
              <div>
                <div className="ai-history-panel-title">Sessões antigas</div>
                <div className="ai-history-panel-subtitle">Escolha uma sessão anterior para restaurar nesta aba.</div>
              </div>
              <button className="ai-btn-ghost ai-history-close" onClick={closeHistoryPanel} type="button">
                Fechar
              </button>
            </div>

            <div className="ai-history-panel-body">
              {historyLoading && <div className="ai-history-empty">Carregando sessões…</div>}
              {!historyLoading && historyError && <div className="ai-history-empty">{historyError}</div>}
              {!historyLoading && !historyError && historicalSessions.length === 0 && (
                <div className="ai-history-empty">Nenhuma sessão antiga encontrada neste workspace.</div>
              )}
              {!historyLoading && !historyError && historicalSessions.length > 0 && (
                <div className="ai-history-list">
                  {historicalSessions.map((historySession) => (
                    <button
                      key={`${historySession.sessionId}-${historySession.savedAt}`}
                      className="ai-history-item"
                      type="button"
                      onClick={() => handleRestoreHistoricalSession(historySession)}
                    >
                      <div className="ai-history-item-top">
                        <span className="ai-history-item-preview">{historySession.preview}</span>
                        <span className="ai-history-item-time">{fmtRelative(historySession.savedAt)}</span>
                      </div>
                      <div className="ai-history-item-meta">
                        <span>{historySession.userMessageCount} {historySession.userMessageCount === 1 ? 'mensagem' : 'mensagens'}</span>
                        <span>{historySession.model}</span>
                        {historySession.toolCalls > 0 && <span>{historySession.toolCalls} tools</span>}
                        {historySession.archiveCount > 0 && <span>{historySession.archiveCount} resumo{historySession.archiveCount !== 1 ? 's' : ''}</span>}
                      </div>
                      {historySession.archiveSummary && (
                        <div className="ai-history-item-summary">{historySession.archiveSummary}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Per-session header: model picker + label */}
      <div className="ai-panel-header">
        <span className="ai-panel-title">✶ {agentLabel}</span>
        <div className="ai-panel-header-right">
          <ModelPicker
            models={availableModels}
            value={model}
            onChange={(id) => {
              const resolved = resolveSessionModel(id);
              setModel(resolved);
              onModelChange?.(resolved);
            }}
            loading={modelsLoading}
            onSignOut={onSignOut}
            providerLabel={PROVIDER_SHORT_LABELS[activeProvider]}
          />
        </div>
      </div>

      {/* Quota bar */}
      {stream.quotaInfo.limit !== null && stream.quotaInfo.remaining !== null && !stream.quotaInfo.quotaExceeded && (() => {
        const pct = Math.max(0, Math.min(100, (stream.quotaInfo.remaining / stream.quotaInfo.limit!) * 100));
        return (
          <div
            className="ai-quota-bar-wrap"
            data-low={pct < 30 ? 'true' : undefined}
            title={`${stream.quotaInfo.remaining} / ${stream.quotaInfo.limit} requests remaining`}
          >
            <div className="ai-quota-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        );
      })()}

      {/* Active task panel */}
      {activeTask && (() => {
        const doneCount = activeTask.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
        const total = activeTask.steps.length;
        return (
          <div className="ai-task-panel">
            <div className="ai-task-panel-header">
              <span className="ai-task-panel-title">{activeTask.title}</span>
              <span className="ai-task-panel-progress">{doneCount}/{total}</span>
            </div>
            <ul className="ai-task-steps">
              {activeTask.steps.map((step, i) => (
                <li key={i} className={`ai-task-step ai-task-step--${step.status}`}>
                  <span className="ai-task-step-icon">
                    {step.status === 'done'        ? '✓' :
                     step.status === 'in-progress' ? '◎' :
                     step.status === 'skipped'     ? '–' : '○'}
                  </span>
                  <span className="ai-task-step-title">{step.title}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className={`ai-messages${justDone ? ' ai-messages--done' : ''}`}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
          isPinnedToBottom.current = atBottom;
          if (isActive && atBottom) {
            onMessagesSeen?.();
          }
        }}
      >
        {/* Session stats bar */}
        {(sessionStats.filesCount > 0 || sessionStats.canvasOps > 0) && (
          <div className="ai-session-stats">
            <span className="ai-session-stats-label">Session</span>
            {sessionStats.filesCount > 0 && (
              <span className="ai-session-stat-chip">
                <span className="ai-stat-chip-icon"><FileText weight="thin" size={12} /></span>
                {sessionStats.filesCount} {sessionStats.filesCount === 1 ? 'file' : 'files'} edited
              </span>
            )}
            {sessionStats.canvasOps > 0 && (
              <span className="ai-session-stat-chip">
                <span className="ai-stat-chip-icon"><Sparkle weight="fill" size={12} /></span>
                {sessionStats.canvasOps} canvas {sessionStats.canvasOps === 1 ? 'op' : 'ops'}
              </span>
            )}
          </div>
        )}

        {/* Empty state */}
        {session.messages.length === 0 && !stream.isStreaming && (
          <div className="ai-empty-state">
            Ask Copilot anything about your document.
            <br />
            <span className="ai-hint">Enter to send · Shift+Enter new line · Esc to close</span>
            {agentContext && <div className="ai-agent-notice"><Sparkle weight="fill" size={12} /> AGENT.md loaded as context</div>}
            {session.savedSession && session.savedSession.messages.length > 0 && (
              <button className="ai-restore-session-btn" onClick={handleRestoreSession} type="button">
                <span className="ai-restore-session-label"><ArrowCounterClockwise weight="thin" size={12} /> Restore last conversation</span>
                <span className="ai-restore-session-meta">
                  {session.savedSession.messages.filter((m) => m.role === 'user').length}{' '}
                  message{session.savedSession.messages.filter((m) => m.role === 'user').length !== 1 ? 's' : ''}{' '}
                  · {fmtRelative(session.savedSession.savedAt)}
                </span>
              </button>
            )}
            {workspacePath && (
              <button className="ai-restore-session-btn ai-restore-session-btn--secondary" onClick={openHistoryPanel} type="button">
                <span className="ai-restore-session-label"><FileText weight="thin" size={12} /> Abrir sessões antigas</span>
                <span className="ai-restore-session-meta">Ver todas as sessões salvas deste workspace</span>
              </button>
            )}
          </div>
        )}

        {/* Message list */}
        {session.messages.map((msg, i) => (
          <div key={i} className={`ai-message ai-message--${msg.role}`}>
            <div className="ai-message-label">{msg.role === 'user' ? 'You' : <><Sparkle weight="fill" size={11} /> {agentLabel}</>}</div>
            <div className="ai-message-content">
              {msg.role === 'assistant' && msg.items && msg.items.length > 0
                ? <>
                    {msg.items.map((item: MessageItem, si: number) =>
                      item.type === 'text'
                        ? parseSegments(item.content).map((seg, ssi) =>
                            seg.type === 'code'
                              ? <CodeBlock key={`${si}-${ssi}`} lang={seg.lang} code={seg.code} workspacePath={workspacePath} />
                              : <AIMarkdownText
                                  key={`${si}-${ssi}`}
                                  content={seg.content}
                                  workspace={workspace}
                                  onOpenFileReference={onOpenFileReference}
                                />
                          )
                        : <ToolItem key={item.activity.callId} activity={item.activity} />
                    )}
                    <div className="ai-done-marker">❆</div>
                  </>
                : msg.role === 'assistant'
                ? parseSegments(contentToString(msg.content)).map((seg, si) =>
                    seg.type === 'code'
                      ? <CodeBlock key={si} lang={seg.lang} code={seg.code} workspacePath={workspacePath} />
                      : <AIMarkdownText
                          key={si}
                          content={seg.content}
                          workspace={workspace}
                          onOpenFileReference={onOpenFileReference}
                        />
                  )
                : <span style={{ whiteSpace: 'pre-wrap' }}>{contentToString(msg.content)}</span>
              }
            </div>
            {msg.role === 'user' && ((msg.attachedImages && msg.attachedImages.length > 0) || msg.attachedImage) && (
              <div className="ai-message-img-grid">
                {(msg.attachedImages ?? (msg.attachedImage ? [msg.attachedImage] : [])).map((image, imageIndex) => (
                  <img key={`${i}-${imageIndex}`} src={image} className="ai-message-img" alt="attached" />
                ))}
              </div>
            )}
            {msg.role === 'user' && msg.attachedFile && (
              <div className="ai-message-file-pill">
                <span className="ai-message-file-pill-icon">📄</span>
                <span className="ai-message-file-pill-name">{msg.attachedFile}</span>
              </div>
            )}
            {msg.role === 'user' && msg.attachedSelectionLabel && (
              <div className="ai-message-file-pill ai-message-file-pill--selection">
                <span className="ai-message-file-pill-icon">✂</span>
                <span className="ai-message-file-pill-name">{msg.attachedSelectionLabel}</span>
              </div>
            )}
            {msg.role === 'user' && msg.activeFile && (
              <div className="ai-message-file-tag">📄 {msg.activeFile.split('/').pop()}</div>
            )}
          </div>
        ))}

        {/* Live streaming row */}
        {stream.isStreaming && (
          <div className="ai-message ai-message--assistant">
            <div className="ai-message-label">✶ {agentLabel}</div>
            <div className="ai-message-content">
              {stream.liveItems.length > 0
                ? <>
                    {stream.liveItems.map((item: MessageItem, idx: number) =>
                      item.type === 'text'
                        ? <AIMarkdownText
                            key={idx}
                            content={item.content}
                            workspace={workspace}
                            onOpenFileReference={onOpenFileReference}
                          />
                        : <ToolItem key={item.activity.callId} activity={item.activity} />
                    )}
                    <div className="ai-thinking-indicator ai-thinking-indicator--inline">
                      <span className="ai-thinking-dot" /><span className="ai-thinking-dot" /><span className="ai-thinking-dot" />
                    </div>
                  </>
                : <div className="ai-thinking-indicator">
                    <span className="ai-thinking-dot" /><span className="ai-thinking-dot" /><span className="ai-thinking-dot" />
                  </div>
              }
            </div>
          </div>
        )}

        {/* ask_user card */}
        {stream.askUserState && (
          <div className="ai-ask-user-card">
            <div className="ai-ask-user-question">{stream.askUserState.question}</div>
            {stream.askUserState.options && stream.askUserState.options.length > 0 && (
              <div className="ai-ask-user-options">
                {stream.askUserState.options.map((opt) => (
                  <button key={opt} className="ai-ask-user-option" onClick={() => stream.handleAskUserAnswer(opt)}>
                    {opt}
                  </button>
                ))}
              </div>
            )}
            <div className="ai-ask-user-input-row">
              <input
                className="ai-ask-user-input"
                type="text"
                placeholder="Ou escreva sua resposta…"
                value={stream.askUserInput}
                onChange={(e) => stream.setAskUserInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') stream.handleAskUserAnswer(stream.askUserInput); }}
                autoFocus
              />
              <button
                className="ai-ask-user-submit"
                disabled={!stream.askUserInput.trim()}
                onClick={() => stream.handleAskUserAnswer(stream.askUserInput)}
              >
                Responder
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {stream.error && (
          <div className="ai-error">
            <span><Warning weight="thin" size={14} /> {stream.error}</span>
            {stream.error.includes('VITE_GITHUB_TOKEN') && (
              <span> — Add your token to <code>app/.env</code></span>
            )}
            {(stream.isQuotaError(stream.error) || stream.quotaInfo.quotaExceeded) && (
              <button
                className="ai-quota-manage-btn"
                onClick={() => openUrl('https://github.com/github-copilot/usage').catch(() =>
                  window.open('https://github.com/github-copilot/usage', '_blank')
                )}
              >
                Manage paid tokens ↗
              </button>
            )}
            <button
              className="ai-retry-btn"
              onClick={() => { void stream.retryLastSend(); }}
            >
              ↻ Tentar novamente
            </button>
            <button
              className="ai-error-copy"
              onClick={() => {
                const dump = activeProvider === 'copilot' ? getLastRequestDump() : getLastProviderRequestDump();
                navigator.clipboard.writeText(`ERROR:\n${stream.error}\n\nLAST REQUEST DUMP:\n${dump}`);
              }}
              title="Copy error + full last request to clipboard"
            >Copy logs</button>
          </div>
        )}
      </div>

      {/* Continue button */}
      {stream.agentExhausted && !stream.isStreaming && (
        <div className="ai-continue-bar">
          <button className="ai-continue-btn" onClick={() => handleSend(undefined, 'continue')}>
            Continuar ↻
          </button>
        </div>
      )}

      {/* Groq key setup overlay */}
      {voice.showGroqSetup && (
        <div className="ai-groq-overlay">
          <div className="ai-groq-card">
            <div className="ai-groq-title">🎤 Entrada por voz</div>

            <ol className="ai-groq-steps">
              <li>Crie uma chave gratuita no Groq (sem cartão)</li>
              <li>Copie a chave gerada</li>
              <li>Cole aqui e pronto</li>
            </ol>

            <button
              className="ai-groq-cta"
              onClick={() => openUrl('https://console.groq.com/keys').catch(() =>
                window.open('https://console.groq.com/keys', '_blank')
              )}
            >
              Criar chave gratuita ↗
            </button>

            <div className="ai-groq-paste-row">
              <input
                className="ai-groq-input"
                type="password"
                placeholder="gsk_…"
                value={voice.groqKeyInput}
                onChange={(e) => voice.setGroqKeyInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && voice.groqKeyInput.trim()) voice.saveGroqKeyAndClose(); }}
                autoFocus
              />
              <button
                className="ai-groq-paste-btn"
                title="Colar do teclado"
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    if (text.trim()) voice.setGroqKeyInput(text.trim());
                  } catch { /* clipboard not accessible */ }
                }}
              >
                Colar
              </button>
            </div>

            <div className="ai-groq-lang-row">
              <span className="ai-groq-lang-label">Idioma da fala:</span>
              <select
                className="ai-groq-lang-select"
                value={voice.groqLangInput}
                onChange={(e) => voice.setGroqLangInput(e.target.value)}
              >
                <option value="auto">Automático ({voice.autoGroqLangLabel})</option>
                <option value="pt">Português</option>
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
                <option value="it">Italiano</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
                <option value="zh">中文</option>
                <option value="ru">Русский</option>
                <option value="ar">العربية</option>
                <option value="nl">Nederlands</option>
                <option value="pl">Polski</option>
                <option value="tr">Türkçe</option>
                <option value="sv">Svenska</option>
                <option value="hi">हिन्दी</option>
              </select>
            </div>

            <div className="ai-groq-actions">
              <button className="ai-auth-btn" disabled={!voice.groqKeyInput.trim()} onClick={voice.saveGroqKeyAndClose}>
                Salvar
              </button>
              <button
                className="ai-btn-ghost"
                onClick={() => {
                  voice.setShowGroqSetup(false);
                  voice.setGroqKeyInput('');
                  voice.setGroqLangInput(voice.groqLangPreference);
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input area */}
      <div
        className={`ai-input-row${isDragOver ? ' drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div className="ai-drop-indicator" aria-hidden="true">
            <Paperclip weight="thin" size={14} />
            <span>Drop images or files to attach</span>
          </div>
        )}
        {selectionContext && !pendingSelectionContext && (
          <button
            className="ai-selection-context-btn"
            type="button"
            onClick={() => setPendingSelectionContext(selectionContext)}
            disabled={stream.isStreaming}
            title={selectionContext.label}
          >
            <Sparkle weight="fill" size={12} />
            <span>Adicionar seleção</span>
          </button>
        )}
        {pendingImages.length > 0 && (
          <div className="ai-img-preview-strip">
            {pendingImages.map((image, index) => (
              <div key={index} className="ai-img-preview">
                <img src={image} alt={`attached ${index + 1}`} />
                <button className="ai-img-remove" onClick={() => removePendingImageAt(index)} title="Remove image">
                  <X weight="thin" size={12} />
                </button>
              </div>
            ))}
            {!modelSupportsVision(model) && (
              <span className="ai-no-vision-warning">
                <Warning weight="thin" size={12} /> Model doesn't support images
              </span>
            )}
          </div>
        )}
        {pendingFileRef && (
          <div className="ai-file-chip">
            <span className="ai-file-chip-icon">📄</span>
            <span className="ai-file-chip-name" title={pendingFileRef.name}>{pendingFileRef.name}</span>
            <span className="ai-file-chip-size">
              {pendingFileRef.content.length > 1000
                ? `${Math.round(pendingFileRef.content.length / 1000)}k chars`
                : `${pendingFileRef.content.length} chars`}
            </span>
            <button className="ai-img-remove" onClick={() => setPendingFileRef(null)} title="Remove file">
              <X weight="thin" size={12} />
            </button>
          </div>
        )}
        {pendingSelectionContext && (
          <div className="ai-file-chip ai-file-chip--selection">
            <span className="ai-file-chip-icon">✂</span>
            <span className="ai-file-chip-name" title={pendingSelectionContext.label}>{pendingSelectionContext.label}</span>
            <span className="ai-file-chip-size">
              {pendingSelectionContext.content.length > 1000
                ? `${Math.round(pendingSelectionContext.content.length / 1000)}k chars`
                : `${pendingSelectionContext.content.length} chars`}
            </span>
            <button className="ai-img-remove" onClick={() => setPendingSelectionContext(null)} title="Remover seleção">
              <X weight="thin" size={12} />
            </button>
          </div>
        )}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            stream.isStreaming ? 'Type to interrupt…' :
            isDragOver ? 'Drop image or file here…' :
            'Ask Copilot…'
          }
          className="ai-input"
        />
        <div className="ai-input-actions">
          <canvas
            ref={voice.vizCanvasRef}
            className={`ai-viz-canvas ${voice.isRecording ? 'active' : ''}`}
            width={72}
            height={28}
          />
          {screenshotTargetRef && (
            <button
              className={`ai-btn-screenshot ${screenshot.isCapturing ? 'capturing' : ''}`}
              onClick={screenshot.handleTakeScreenshot}
              disabled={screenshot.isCapturing}
              title={canvasEditorRef?.current
                ? 'Screenshot canvas → send to Copilot'
                : 'Screenshot current view → send to Copilot'}
              type="button"
            >
              <Camera weight="thin" size={14} />
            </button>
          )}
          <button
            className="ai-btn-attach"
            onClick={handleAttachFile}
            title="Attach file (image or document)"
            type="button"
            disabled={stream.isStreaming}
          >
            <Paperclip weight="thin" size={14} />
          </button>
          <button
            className={`ai-btn-mic ${voice.isRecording ? 'recording' : ''} ${voice.isTranscribing ? 'transcribing' : ''}`}
            onClick={voice.handleMicClick}
            title={
              voice.isRecording ? 'Stop recording' :
              voice.isTranscribing ? 'Transcribing…' :
              voice.groqKey ? 'Click to speak' :
              'Set up voice input'
            }
            type="button"
            disabled={voice.isTranscribing}
          >
            {voice.isTranscribing
              ? <span className="ai-mic-spinner" />
              : voice.isRecording
              ? <Stop size={11} weight="fill" />
              : <Microphone size={14} weight="thin" />
            }
          </button>
          {stream.isStreaming && !input.trim() ? (
            <button onClick={stream.handleStop} className="ai-btn-send ai-btn-send--stop" title="Stop (Esc)">
              <Stop size={10} weight="fill" />
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
                disabled={!input.trim() && pendingImages.length === 0}
              className={`ai-btn-send${stream.isStreaming ? ' ai-btn-send--interrupt' : ''}`}
              title={stream.isStreaming ? 'Interrupt and send (Enter)' : 'Send (Enter)'}
            >
              {stream.isStreaming
                ? <ArrowUp weight="bold" size={12} />
                : <ArrowUp weight="thin" size={16} />
              }
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

export default AgentSession;
