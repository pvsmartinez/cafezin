/**
 * AIPanel — outer shell with auth, shared models, and multi-agent tab bar.
 * The per-session logic lives in AgentSession.tsx.
 */
import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import {
  Snowflake,
  Microphone,
  CaretDown,
  CaretUp,
  CaretRight,
  CaretLeft,
  Circle,
  CircleNotch,
  CheckCircle,
  WarningCircle,
} from '@phosphor-icons/react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window';

import {
  fetchCopilotModels,
  startDeviceFlow,
  getStoredOAuthToken,
  clearOAuthToken,
} from '../services/copilot';
import type { DeviceFlowState } from '../services/copilot';
import { getActiveProvider } from '../services/aiProvider';
import type { AIProviderType } from '../services/aiProvider';
import { getProviderModelsForPicker } from '../services/ai/providerModels';
import { readFile, writeFile } from '../services/fs';
import { getGroqKey, getGroqLangPreference } from '../hooks/useVoiceInput';
import { FALLBACK_MODELS } from '../types';
import type { AIRecordedTextMark, AISelectionContext, CopilotModelInfo } from '../types';
import type { Workspace, WorkspaceExportConfig, WorkspaceConfig } from '../types';
import type { Editor as TldrawEditor } from 'tldraw';
import { resolveVoiceTranscriptionLanguage } from '../utils/voiceLanguage';

import { AIAuthScreen } from './ai/AIAuthScreen';
import { PremiumGate } from './ai/PremiumGate';
import AgentSession from './AgentSession';
import type { AgentSessionHandle } from './AgentSession';
import { useAccountState } from '../hooks/useAccountState';

import './AIPanel.css';

// ── Types ─────────────────────────────────────────────────────────────────────
/**
 * A voice memo recorded on mobile that doesn't yet have a transcript (.txt).
 * `audioPath` and `transcriptPath` are absolute filesystem paths.
 */
export interface PendingVoiceMemo {
  stem: string;
  audioExt: string;
  audioPath: string;
  transcriptPath: string;
  timestamp: Date;
}
interface AIPanelProps {
  isOpen: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
  initialPrompt?: string;
  initialModel?: string;
  onModelChange?: (model: string) => void;
  documentContext?: string;
  agentContext?: string;
  workspacePath?: string;
  workspace?: Workspace | null;
  canvasEditorRef?: React.RefObject<TldrawEditor | null>;
  onFileWritten?: (path: string) => void;
  onMarkRecorded?: (relPath: string, content: string, model: string, recordedMarks?: AIRecordedTextMark[]) => void;
  onCanvasMarkRecorded?: (relPath: string, shapeIds: string[], model: string) => void;
  activeFile?: string;
  rescanFramesRef?: React.MutableRefObject<(() => void) | null>;
  workspaceExportConfig?: WorkspaceExportConfig;
  onExportConfigChange?: (config: WorkspaceExportConfig) => void;
  style?: React.CSSProperties;
  onStreamingChange?: (streaming: boolean) => void;
  screenshotTargetRef?: React.RefObject<HTMLElement | null>;
  webPreviewRef?: React.RefObject<{ getScreenshot: () => Promise<string | null> } | null>;
  getActiveHtml?: () => { html: string; absPath: string } | null;
  workspaceConfig?: WorkspaceConfig;
  appLocale?: 'en' | 'pt-BR';
  onWorkspaceConfigChange?: (patch: Partial<WorkspaceConfig>) => void;
  onOpenFileReference?: (relPath: string, lineNo?: number) => void | Promise<void>;
  selectionContext?: AISelectionContext | null;
  /** Voice memos from mobile that have audio but no transcript yet */
  pendingVoiceMemos?: PendingVoiceMemo[];
  /** Called after a memo is transcribed — parent should remove it from the list */
  onVoiceMemoHandled?: (stem: string) => void;
}

export interface AIPanelHandle {
  receiveFinderFiles(paths: string[]): void;
}

type AgentStatus = 'idle' | 'thinking' | 'error';

interface AgentTab {
  id: string;
  label: string;
  status: AgentStatus;
  unread: boolean;
}

function getTabStatusMeta(tab: AgentTab): { tone: 'idle' | 'thinking' | 'error' | 'ready'; label: string; ariaLabel: string; title: string } {
  if (tab.status === 'thinking') {
    return {
      tone: 'thinking',
      label: 'Trabalhando',
      ariaLabel: 'a trabalhar',
      title: 'Respondendo agora',
    };
  }
  if (tab.status === 'error') {
    return {
      tone: 'error',
      label: 'Erro',
      ariaLabel: 'erro',
      title: 'Última resposta falhou',
    };
  }
  if (tab.unread) {
    return {
      tone: 'ready',
      label: 'Pronto',
      ariaLabel: 'pronto e não lido',
      title: 'Tem resposta nova nesta aba',
    };
  }
  return {
    tone: 'idle',
    label: 'Pronto',
    ariaLabel: 'pronto',
    title: 'Sem atividade pendente',
  };
}

function renderTabStatusIcon(tone: 'idle' | 'thinking' | 'error' | 'ready') {
  if (tone === 'thinking') {
    return <CircleNotch size={13} weight="bold" />;
  }
  if (tone === 'error') {
    return <WarningCircle size={13} weight="fill" />;
  }
  if (tone === 'ready') {
    return <CheckCircle size={13} weight="fill" />;
  }
  return <Circle size={12} weight="bold" />;
}

/** True when running inside a Tauri WebView. */
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ── Main panel ────────────────────────────────────────────────────────────────

const AIPanel = forwardRef<AIPanelHandle, AIPanelProps>(function AIPanel({
  isOpen,
  onClose,
  collapsed = false,
  onCollapse,
  onExpand,
  initialPrompt,
  initialModel,
  onModelChange,
  documentContext,
  agentContext,
  workspacePath,
  workspace,
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
  style,
  onStreamingChange,
  selectionContext,
  screenshotTargetRef,
  webPreviewRef,
  getActiveHtml,
  pendingVoiceMemos,
  onVoiceMemoHandled,
  onOpenFileReference,
}, ref) {
  const copilotOAuthClientId = workspaceConfig?.githubOAuth?.clientId?.trim() || undefined;

  // ── Account / premium entitlement ─────────────────────────────────────────
  const { account, loading: accountLoading, refresh: refreshAccount } = useAccountState();

  // ── Auth ──────────────────────────────────────────────────────────────────
  const [authStatus, setAuthStatus] = useState<'checking' | 'unauthenticated' | 'connecting' | 'authenticated'>('checking');
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlowState | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setAuthStatus(getStoredOAuthToken(copilotOAuthClientId) ? 'authenticated' : 'unauthenticated');
  }, [isOpen, copilotOAuthClientId]);

  async function handleSignIn() {
    setAuthError(null);
    setAuthStatus('connecting');
    setDeviceFlow(null);
    try {
      await startDeviceFlow(copilotOAuthClientId ?? '', (state) => setDeviceFlow(state));
      setAuthStatus('authenticated');
      setDeviceFlow(null);
    } catch (err) {
      setAuthError(String(err));
      setAuthStatus('unauthenticated');
      setDeviceFlow(null);
    }
  }

  function handleSignOut() {
    clearOAuthToken(copilotOAuthClientId);
    setAuthStatus('unauthenticated');
  }

  // ── Shared models (fetched once, available to all agent tabs) ─────────────
  const [availableModels, setAvailableModels] = useState<CopilotModelInfo[]>(FALLBACK_MODELS);
  const [modelsLoading, setModelsLoading] = useState(false);
  const modelsLoadedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    const provider = getActiveProvider();
    if (provider !== 'copilot') {
      setAvailableModels(getProviderModelsForPicker(provider as Exclude<AIProviderType, 'copilot'>));
      setModelsLoading(false);
      return;
    }
    if (authStatus === 'authenticated') modelsLoadedRef.current = false;
    if (modelsLoadedRef.current) return;
    modelsLoadedRef.current = true;
    setModelsLoading(true);
    fetchCopilotModels(copilotOAuthClientId)
      .then((models) => { setAvailableModels(models); setModelsLoading(false); })
      .catch(() => setModelsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, authStatus, copilotOAuthClientId]);

  // Refresh models when the user switches provider or updates favorites in settings.
  useEffect(() => {
    function handleProviderChanged() {
      const provider = getActiveProvider();
      if (provider !== 'copilot') {
        setAvailableModels(getProviderModelsForPicker(provider as Exclude<AIProviderType, 'copilot'>));
        setModelsLoading(false);
      } else {
        // Force Copilot model reload on next panel open.
        modelsLoadedRef.current = false;
      }
    }
    window.addEventListener('cafezin-provider-changed', handleProviderChanged);
    return () => window.removeEventListener('cafezin-provider-changed', handleProviderChanged);
  }, []);

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const [tabs, setTabs] = useState<AgentTab[]>([{ id: 'agent-1', label: 'Agente 1', status: 'idle', unread: false }]);
  const [activeTabId, setActiveTabId] = useState('agent-1');
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState('');

  // Track previous status per tab so we can detect thinking→idle transition
  const prevStatusRef = useRef<Map<string, AgentStatus>>(new Map());

  // Track whether the native window is focused (for dock bounce)
  const windowFocusedRef = useRef(true);

  // Subscribe to window focus changes for dock bounce (macOS desktop only)
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => { windowFocusedRef.current = focused; })
      .then((fn) => { unlisten = fn; })
      .catch(() => {});
    return () => { unlisten?.(); };
  }, []);

  // ── Voice memo panel ─────────────────────────────────────────────────────
  const [voicePanelOpen, setVoicePanelOpen] = useState(false);
  const [processingMemo, setProcessingMemo] = useState<string | null>(null);
  const [memoError,      setMemoError]      = useState<string | null>(null);

  async function handleTranscribeAndSend(memo: PendingVoiceMemo) {
    const groqKey = getGroqKey();
    if (!groqKey) { setMemoError('Chave Groq não configurada.'); return; }
    setProcessingMemo(memo.stem);
    setMemoError(null);
    try {
      const bytes = await readFile(memo.audioPath);
      const mimeMap: Record<string, string> = {
        webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'audio/mp4',
      };
      const mimeType = mimeMap[memo.audioExt] ?? 'audio/webm';
      const CHUNK = 8192;
      let binary = '';
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const b64 = btoa(binary);
      const transcript = await invoke<string>('transcribe_audio', {
        audioBase64: b64,
        mimeType,
        apiKey: groqKey,
        language: resolveVoiceTranscriptionLanguage({
          overrideLanguage: getGroqLangPreference(),
          workspaceLanguage: workspaceConfig?.preferredLanguage,
          appLocale,
          navigatorLanguage: navigator.language,
        }),
      });
      // Save transcript to disk so it shows up on the mobile side too
      await writeFile(memo.transcriptPath, new TextEncoder().encode(transcript));
      // Inject text into the active agent session input
      agentRefs.current.get(activeTabId)?.injectText(transcript);
      onVoiceMemoHandled?.(memo.stem);
      if (pendingVoiceMemos && pendingVoiceMemos.length <= 1) setVoicePanelOpen(false);
    } catch (err) {
      setMemoError(`Erro: ${err}`);
    } finally {
      setProcessingMemo(null);
    }
  }

  function addTab() {
    const n = tabs.length + 1;
    const id = `agent-${n}-${Date.now()}`;
    const label = `Agente ${n}`;
    setTabs((prev) => [...prev, { id, label, status: 'idle', unread: false }]);
    setActiveTabId(id);
    onExpand?.();
  }

  function clearUnread(id: string) {
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, unread: false } : t));
  }

  function startRenaming(tab: AgentTab) {
    setRenamingTabId(tab.id);
    setRenamingValue(tab.label);
  }

  function commitRename() {
    if (!renamingTabId) return;
    const trimmed = renamingValue.trim();
    setTabs((prev) => prev.map((tab) => {
      if (tab.id !== renamingTabId) return tab;
      return { ...tab, label: trimmed || tab.label };
    }));
    setRenamingTabId(null);
    setRenamingValue('');
  }

  function cancelRename() {
    setRenamingTabId(null);
    setRenamingValue('');
  }

  function closeTab(id: string) {
    if (tabs.length === 1) { onClose(); return; }
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeTabId === id) setActiveTabId(next[0].id);
      return next;
    });
    if (renamingTabId === id) cancelRename();
  }

  // ── Delegate Finder drop to active agent session ──────────────────────────
  const agentRefs = useRef<Map<string, AgentSessionHandle | null>>(new Map());

  useImperativeHandle(ref, () => ({
    receiveFinderFiles(paths: string[]) {
      agentRefs.current.get(activeTabId)?.receiveFinderFiles(paths);
    },
  }));

  // ── Early returns ─────────────────────────────────────────────────────────
  if (!isOpen) return null;

  // Premium gate: block AI access for free/unauthenticated Cafezin accounts.
  // Shown before the provider-auth check so all AI routes are gated uniformly.
  if (!accountLoading && !account.canUseAI) {
    return (
      <PremiumGate
        account={account}
        loading={accountLoading}
        style={style}
        onRefresh={refreshAccount}
      />
    );
  }

  if (authStatus === 'unauthenticated' || authStatus === 'connecting') {
    return (
      <AIAuthScreen
        authStatus={authStatus}
        deviceFlow={deviceFlow}
        error={authError}
        style={style}
        onSignIn={handleSignIn}
      />
    );
  }

  if (authStatus === 'checking') return null;

  // ── Collapsed icon strip ─────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div className="ai-panel ai-panel--collapsed" data-panel="ai">
        <button
          className="ai-panel-expand-btn"
          onClick={onExpand}
          title="Expandir painel"
        >
          <CaretLeft weight="thin" size={14} />
        </button>
        <div className="ai-panel-icon-strip">
          {tabs.map((tab, i) => {
            const statusMeta = getTabStatusMeta(tab);
            return (
              <button
                key={tab.id}
                className={`ai-panel-icon-btn${activeTabId === tab.id ? ' ai-panel-icon-btn--active' : ''}`}
                onClick={() => { onExpand?.(); setActiveTabId(tab.id); }}
                title={`${tab.label} — ${statusMeta.label}${tab.unread ? ' — não lido' : ''}`}
              >
                <span className={`ai-panel-icon-dot ai-panel-icon-dot--${statusMeta.tone}`} />
                <span className="ai-panel-icon-num">{i + 1}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="ai-panel" data-panel="ai" style={style}>
      {/* Tab bar */}
      <div className="ai-tab-bar">
        {tabs.map((tab) => {
          const statusMeta = getTabStatusMeta(tab);
          const isRenaming = renamingTabId === tab.id;
          return (
          <div
            key={tab.id}
            className={`ai-tab ai-tab--${statusMeta.tone}${activeTabId === tab.id ? ' ai-tab--active' : ''}${tab.unread ? ' ai-tab--unread' : ''}`}
          >
            {isRenaming ? (
              <input
                className="ai-tab-input"
                value={renamingValue}
                onChange={(e) => setRenamingValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelRename();
                  }
                }}
                autoFocus
                spellCheck={false}
                aria-label="Renomear agente"
              />
            ) : (
              <button
                className="ai-tab-label"
                onClick={() => setActiveTabId(tab.id)}
                onDoubleClick={() => startRenaming(tab)}
                title={`${tab.label} — ${statusMeta.title}. Duplo clique para renomear`}
                aria-label={`${tab.label}. Status: ${statusMeta.ariaLabel}`}
              >
                <span className="ai-tab-name">{tab.label}</span>
                <span
                  className={`ai-tab-indicator ai-tab-indicator--${statusMeta.tone}`}
                  aria-label={statusMeta.ariaLabel}
                  title={statusMeta.title}
                >
                  {renderTabStatusIcon(statusMeta.tone)}
                </span>
              </button>
            )}
            <button
              className="ai-tab-close"
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              title={tabs.length === 1 ? 'Fechar painel' : 'Fechar agente'}
            >
              <Snowflake weight="thin" size={10} />
            </button>
          </div>
          );
        })}
        <button className="ai-tab-add" onClick={addTab} title="Novo agente">
          +
        </button>
        <button
          className="ai-tab-collapse"
          onClick={onCollapse}
          title="Minimizar painel"
        >
          <CaretRight weight="thin" size={12} />
        </button>
      </div>

      {/* Voice memo banner — shown when mobile memos arrive without transcripts */}
      {pendingVoiceMemos && pendingVoiceMemos.length > 0 && (
        <div className="ai-voice-banner">
          <button
            className="ai-voice-banner-btn"
            onClick={() => setVoicePanelOpen((v) => !v)}
          >
            <Microphone size={12} weight="fill" />
            <span>
              {pendingVoiceMemos.length} memo{pendingVoiceMemos.length > 1 ? 's' : ''} de voz pendente{pendingVoiceMemos.length > 1 ? 's' : ''}
            </span>
            {voicePanelOpen ? <CaretUp size={10} /> : <CaretDown size={10} />}
          </button>
          {voicePanelOpen && (
            <div className="ai-voice-panel">
              {memoError && <p className="ai-voice-error">{memoError}</p>}
              {pendingVoiceMemos.map((memo) => {
                const dateStr = memo.timestamp.toLocaleDateString([], { month: 'short', day: 'numeric' });
                const timeStr = memo.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return (
                  <div key={memo.stem} className="ai-voice-row">
                    <span className="ai-voice-date">{dateStr} · {timeStr}</span>
                    <button
                      className="ai-voice-transcribe-btn"
                      onClick={() => handleTranscribeAndSend(memo)}
                      disabled={!!processingMemo}
                    >
                      {processingMemo === memo.stem ? 'Transcrevendo…' : 'Transcrever & Enviar'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* One AgentSession per tab — all mounted, only active visible */}
      {tabs.map((tab) => (
        <AgentSession
          key={tab.id}
          ref={(el) => { agentRefs.current.set(tab.id, el); }}
          agentId={tab.id}
          agentLabel={tab.label}
          isActive={tab.id === activeTabId}
          onNotAuthenticated={() => setAuthStatus('unauthenticated')}
          onSignOut={handleSignOut}
          availableModels={availableModels}
          modelsLoading={modelsLoading}
          onClose={onClose}
          initialPrompt={initialPrompt}
          initialModel={initialModel}
          onModelChange={onModelChange}
          documentContext={documentContext}
          agentContext={agentContext}
          workspacePath={workspacePath}
          workspace={workspace}
          canvasEditorRef={canvasEditorRef}
          onFileWritten={onFileWritten}
          onMarkRecorded={onMarkRecorded}
          onCanvasMarkRecorded={onCanvasMarkRecorded}
          activeFile={activeFile}
          rescanFramesRef={rescanFramesRef}
          workspaceExportConfig={workspaceExportConfig}
          onExportConfigChange={onExportConfigChange}
          onStreamingChange={onStreamingChange}
          onStatusChange={(status) => {
            const prevStatus = prevStatusRef.current.get(tab.id) ?? 'idle';
            prevStatusRef.current.set(tab.id, status);
            setTabs((tabs) => tabs.map((t) => {
              if (t.id !== tab.id) return t;
              // Mark unread when a background tab finishes a response
              const justDone = status === 'idle' && prevStatus === 'thinking';
              const isBackground = tab.id !== activeTabId;
              const unread = t.unread || (justDone && isBackground);
              // Bounce dock when window is not focused
              if (justDone && isBackground && !windowFocusedRef.current && isTauri) {
                getCurrentWindow()
                  .requestUserAttention(UserAttentionType.Informational)
                  .catch(() => {});
              }
              return { ...t, status, unread };
            }));
          }}
          onMessagesSeen={() => clearUnread(tab.id)}
          screenshotTargetRef={screenshotTargetRef}
          webPreviewRef={webPreviewRef}
          getActiveHtml={getActiveHtml}
          workspaceConfig={workspaceConfig}
          appLocale={appLocale}
          onWorkspaceConfigChange={onWorkspaceConfigChange}
          onOpenFileReference={onOpenFileReference}
          selectionContext={selectionContext}
        />
      ))}
    </div>
  );
});

export default AIPanel;
