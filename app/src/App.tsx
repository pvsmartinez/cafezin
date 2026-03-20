import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { copyFile, writeFile as writeBinaryFile, mkdir, exists, readDir } from './services/fs';
import type { EditorHandle } from './components/Editor';
import AIPanel from './components/AIPanel';
import type { AIPanelHandle, PendingVoiceMemo } from './components/AIPanel';
import WorkspacePicker from './components/WorkspacePicker';
import SplashScreen from './components/SplashScreen';
import Sidebar from './components/Sidebar';
import type { WebPreviewHandle } from './components/WebPreview';
import UpdateModal from './components/UpdateModal';
import UpdateReleaseModal from './components/UpdateReleaseModal';
import { loadPendingTasks } from './services/mobilePendingTasks';
import type { MobilePendingTask } from './services/mobilePendingTasks';

import BottomPanel, { type FileMeta } from './components/BottomPanel';
import { useDragResize } from './hooks/useDragResize';
import { syncSecretsFromCloud } from './services/apiSecrets';
import { deployDemoHub, resolveVercelToken } from './services/publishVercel';
import { resolveCopilotModelForChatCompletions } from './services/copilot';
import { useTabManager } from './hooks/useTabManager';
import { useAutosave } from './hooks/useAutosave';
import { useFileWatcher } from './hooks/useFileWatcher';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import type { TLShapeId } from 'tldraw';
import { canvasAIContext } from './utils/canvasAI';
import { registerCanvasTabControls, getCanvasEditor } from './utils/canvasRegistry';
import { exportMarkdownToPDF } from './utils/exportPDF';
import {
  loadWorkspace,
  readFile,
  writeFile,
  saveWorkspaceConfig,
  trackFileOpen,
  createFile,
  flatMdFiles,
  refreshFileTree,
  buildWorkspaceIndex,
} from './services/workspace';
import { useAuthSession } from './hooks/useAuthSession';
import { onLockedFilesChange, getLockedFiles } from './services/copilotLock';
import { fetchGhostCompletion } from './services/copilot';
import { loadWorkspaceSession, saveWorkspaceSession } from './services/workspaceSession';
import { getFileTypeInfo } from './utils/fileType';
import { normalizeWorkspaceExportConfig, type AISelectionContext, type Workspace, type AppSettings, type WorkspaceExportConfig, type WorkspaceConfig } from './types';
import { APP_SETTINGS_KEY } from './types';
import { setupI18n } from './i18n';
import { useBacklinks } from './hooks/useBacklinks';
import { useModals } from './hooks/useModals';
import { useCanvasState } from './hooks/useCanvasState';
import { useAIMarks } from './hooks/useAIMarks';
import { useDesktopPrompts } from './hooks/useDesktopPrompts';
import { loadAppSettings, useAppShellState } from './hooks/useAppShellState';
import { useForceUpdateCheck } from './hooks/useForceUpdateCheck';
import { useTsDiagnostics } from './hooks/useTsDiagnostics';
import { useProactiveNudge } from './hooks/useProactiveNudge';
import { AppOverlays } from './components/app/AppOverlays';
import { AppHeader } from './components/app/AppHeader';
import { AppEditorArea } from './components/app/AppEditorArea';
import { consumeLaunchWorkspacePath, openWorkspaceWindow } from './services/windowing';
import { formatShortcutLabel, getShortcutBindings } from './keyboardShortcuts';
import './App.css';

// Eagerly init i18n before first render so translated strings show immediately
setupI18n(loadAppSettings().locale);

/** True when running inside a Tauri WebView (not a plain browser). */
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Returns negative if a < b, 0 if equal, positive if a > b */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const FALLBACK_CONTENT = `# Untitled Document\n\nStart writing here…\n`;
const launchWorkspacePath = consumeLaunchWorkspacePath();

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [launchWorkspacePending, setLaunchWorkspacePending] = useState<boolean>(!!launchWorkspacePath);
  const [launchWorkspaceError, setLaunchWorkspaceError] = useState<string | null>(null);
  const {
    initSettings,
    splash,
    splashVisible,
    appSettings,
    setAppSettings,
    resolvedTheme,
    isDarkTheme,
    sidebarMode,
    setSidebarMode,
    sidebarOpen,
    setSidebarOpen,
    homeVisible,
    setHomeVisible,
    terminalOpen,
    setTerminalOpen,
    terminalHeight,
    setTerminalHeight,
    terminalRequestCd,
    setTerminalRequestCd,
    terminalRequestRun,
    setTerminalRequestRun,
    focusMode,
    setFocusMode,
  } = useAppShellState();
  const shortcutBindings = useMemo(
    () => getShortcutBindings(appSettings.shortcutOverrides),
    [appSettings.shortcutOverrides],
  );
  const sidebarShortcutLabel = useMemo(
    () => formatShortcutLabel(shortcutBindings.toggleSidebar),
    [shortcutBindings.toggleSidebar],
  );
  const previewShortcutLabel = useMemo(
    () => formatShortcutLabel(shortcutBindings.togglePreview),
    [shortcutBindings.togglePreview],
  );
  const terminalShortcutLabel = useMemo(
    () => formatShortcutLabel(shortcutBindings.toggleTerminal),
    [shortcutBindings.toggleTerminal],
  );
  const focusModeShortcutLabel = useMemo(
    () => formatShortcutLabel(shortcutBindings.toggleFocusMode),
    [shortcutBindings.toggleFocusMode],
  );
  const { forceUpdateOpen, forceUpdateRequired, forceUpdateChannel } = useForceUpdateCheck(
    compareVersions,
  );

  // Mark component as unmounted so async polls (e.g. export canvas mount check) can bail out
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Keep window title = workspace name (tabs already show the active file)
  useEffect(() => {
    document.title = workspace ? workspace.name : 'Cafezin';
  }, [workspace?.name]);

  useEffect(() => {
    if (!launchWorkspacePath) return;
    const targetPath = launchWorkspacePath;

    let cancelled = false;

    async function openLaunchedWorkspace() {
      try {
        const ws = await loadWorkspace(targetPath);
        if (cancelled) return;
        await handleWorkspaceLoaded(ws);
        setLaunchWorkspaceError(null);
      } catch (err) {
        if (cancelled) return;
        setLaunchWorkspaceError(
          `Nao foi possivel abrir o workspace solicitado: ${(err as Error)?.message ?? String(err)}`,
        );
      } finally {
        if (!cancelled) setLaunchWorkspacePending(false);
      }
    }

    void openLaunchedWorkspace();

    return () => {
      cancelled = true;
    };
  // launchWorkspacePath is consumed once per window creation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [isAIStreaming, setIsAIStreaming] = useState(false);
  // Always-fresh ref so Tauri menu listeners (registered with stale closure) can
  // read the latest streaming state without re-registering on every change.
  const isAIStreamingRef = useRef(false);
  isAIStreamingRef.current = isAIStreaming;

  // ── Tab management (open files, switching, close, reorder) ───────────────
  const {
    tabs, setTabs, activeTabId, setActiveTabId, activeFile,
    previewTabId, setPreviewTabId,
    content, setContent, viewMode, setViewMode,
    tabContentsRef, tabViewModeRef, savedContentRef,
    activeTabIdRef, tabsRef,
    switchToTab, addTab, closeTab, closeAllTabs, closeOthers, closeToRight, reorderTabs,
    promoteTab, clearAll,
  } = useTabManager({ fallbackContent: FALLBACK_CONTENT });
  // Debounce word/line count so the status bar doesn't update on every keystroke.
  const [wordCount, setWordCount] = useState(() => content.trim().split(/\s+/).filter(Boolean).length);
  const [lineCount, setLineCount] = useState(() => content.split('\n').length);
  useEffect(() => {
    const t = setTimeout(() => {
      setWordCount(content.trim().split(/\s+/).filter(Boolean).length);
      setLineCount(content.split('\n').length);
    }, 300);
    return () => clearTimeout(t);
  }, [content]);
  const [fileStat, setFileStat] = useState<string | null>(null);

  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(new Set());
  // Find + Replace bar (Ctrl/Cmd+F)
  // Pending jump: set by project search results; cleared after content loads
  const [pendingJumpText, setPendingJumpText] = useState<string | null>(null);
  const [pendingJumpLine, setPendingJumpLine] = useState<number | null>(null);
  const [lockedFiles, setLockedFiles] = useState<Set<string>>(() => getLockedFiles());
  const prevLockedRef = useRef<Set<string>>(getLockedFiles());

  // Subscribe to Copilot file-lock changes; auto-reload files the agent just finished writing
  useEffect(() => {
    const unsub = onLockedFilesChange(async (locked) => {
      const prev = prevLockedRef.current;
      const justUnlocked = [...prev].filter((p) => !locked.has(p));
      prevLockedRef.current = new Set(locked);
      setLockedFiles(locked);
      for (const filePath of justUnlocked) {
        const ws = workspaceRef.current;
        if (!ws) continue;
        if (!tabsRef.current.includes(filePath)) continue;
        const kind = getFileTypeInfo(filePath).kind;
        if (['pdf', 'video', 'audio', 'image', 'canvas'].includes(kind)) continue;
        try {
          const freshText = await readFile(ws, filePath);
          savedContentRef.current.set(filePath, freshText);
          tabContentsRef.current.set(filePath, freshText);
          if (filePath === activeTabIdRef.current) setContent(freshText);
        } catch { /* file may have been deleted — ignore */ }
      }
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Stable refs declared early (before hooks that reference them)
  const editorRef = useRef<EditorHandle>(null);
  const editorAreaRef = useRef<HTMLDivElement>(null);
  const aiPanelRef = useRef<AIPanelHandle | null>(null);
  const webPreviewRef = useRef<WebPreviewHandle | null>(null);
  const mountedRef = useRef(true);
  // ── Modals / overlays (──────────────────────────────────────────────────
  const {
    showUpdateModal, setShowUpdateModal,
    showSettings, setShowSettings,
    settingsInitialTab, openSettings,
    imgSearchOpen, setImgSearchOpen,
    exportModalOpen, setExportModalOpen,
    findReplaceOpen, setFindReplaceOpen,
    aiOpen, setAiOpen,
    aiInitialPrompt, setAiInitialPrompt,
  } = useModals();
  const {
    showUpdateReleaseModal,
    setShowUpdateReleaseModal,
    updateToastVersion,
    setUpdateToastVersion,
    showMobilePending,
    setShowMobilePending,
    desktopOnboardingSeen,
    showDesktopOnboarding,
    handleCloseDesktopOnboarding,
    handleOpenDesktopHelp,
    handleContactUs,
  } = useDesktopPrompts({
    splash,
    forceUpdateOpen,
    appLocale: appSettings.locale,
    openSettings,
    compareVersions,
  });

  // Voice memos recorded on mobile without transcripts
  const [pendingVoiceMemos, setPendingVoiceMemos] = useState<PendingVoiceMemo[]>([]);
  const [mobilePendingTasks, setMobilePendingTasks] = useState<MobilePendingTask[]>([]);
  // ── Canvas refs + transient state ───────────────────────────────────────
  const {
    canvasEditorRef,
    forceSaveRef,
    rescanFramesRef,
    canvasResetKey, setCanvasResetKey,
    canvasSlideCount, setCanvasSlideCount,
  } = useCanvasState();
  const [aiSelectionContext, setAiSelectionContext] = useState<AISelectionContext | null>(null);
  // ── Copilot tab-switch overlay ───────────────────────────────────────────
  const [copilotOverlayActive, setCopilotOverlayActive] = useState(false);
  const copilotTabSwitchRef = useRef<(relPath: string) => Promise<void>>(async () => {});
  copilotTabSwitchRef.current = async (relPath: string) => {
    if (getCanvasEditor(relPath)) return; // already mounted — nothing to do
    await handleOpenFile(relPath);
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (!mountedRef.current) { reject(new Error('Component unmounted')); return; }
        if (getCanvasEditor(relPath)) { resolve(); return; }
        if (Date.now() - start > 10_000) { reject(new Error('Canvas editor did not mount in time')); return; }
        setTimeout(check, 80);
      };
      check();
    });
  };
  useEffect(() => {
    registerCanvasTabControls(
      (r) => copilotTabSwitchRef.current(r),
      setCopilotOverlayActive,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ── Panel resize (sidebar ↔ editor ↔ AI panel) ───────────────────────────
  const {
    sidebarWidth,
    setSidebarWidth,
    aiPanelWidth,
    aiPanelCollapsed,
    startSidebarDrag,
    startAiDrag,
    collapseAiPanel,
    expandAiPanel,
  } = useDragResize();
  // Keep a stable ref so keyboard-shortcut closures can read the latest width
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const { autosaveDelayRef, scheduleAutosave, cancelAutosave } = useAutosave({
    savedContentRef,
    setDirtyFiles,
    setSaveError: (err) => setSaveError(err as string | null),
    setWorkspace,
    initialDelay: initSettings.autosaveDelay,
  });
  // ── AI edit marks ────────────────────────────────────────────────────────
  const {
    aiMarks, setAiMarks,
    aiHighlight, setAiHighlight,
    aiNavIndex, setAiNavIndex,
    activeFileMarks,
    loadMarksForWorkspace,
    handleMarkRecorded,
    handleCanvasMarkRecorded,
    handleMarkReviewed,
    handleMarkRejected,
    handleReviewAllMarks,
    handleMarkUserEdited,
    handleAINavNext,
    handleAINavPrev,
    cleanupMarksForContent,
  } = useAIMarks({
    workspace,
    activeFile,
    initHighlightDefault: initSettings.aiHighlightDefault,
    activeTabIdRef,
    tabsRef,
    tabContentsRef,
    savedContentRef,
    canvasEditorRef,
    editorRef,
    setContent,
    setDirtyFiles,
  });
  // Visual "Saved ✓" toast
  const [savedToast, setSavedToast] = useState(false);
  const savedToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Demo Hub publish status toast
  const [demoHubToast, setDemoHubToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const demoHubToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Proactive AI nudge
  const isCanvasActive = !!activeFile?.endsWith('.tldr.json');
  const { activeNudge, recordEdit, dismissNudge } = useProactiveNudge(isCanvasActive);
  // Clean up toast timers on unmount to avoid setState on unmounted component
  useEffect(() => () => {
    if (savedToastTimerRef.current)   clearTimeout(savedToastTimerRef.current);
    if (demoHubToastTimerRef.current) clearTimeout(demoHubToastTimerRef.current);
  }, []);
  // Save error — set on any failed write, cleared on next successful write
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setAiSelectionContext(null);
  }, [activeFile]);

  // ── Demo Hub publish ───────────────────────────────────────────────────────
  const handlePublishDemoHub = useCallback(async () => {
    if (!workspace) return;
    const demoHub = workspace.config.vercelConfig?.demoHub;
    if (!demoHub?.projectName) return;
    const token = resolveVercelToken(workspace.config.vercelConfig?.token);
    if (!token) {
      setDemoHubToast({ msg: 'Sem token Vercel. Configure em Settings → API Keys.', ok: false });
      if (demoHubToastTimerRef.current) clearTimeout(demoHubToastTimerRef.current);
      demoHubToastTimerRef.current = setTimeout(() => setDemoHubToast(null), 5000);
      return;
    }
    setDemoHubToast({ msg: 'Publicando demos…', ok: true });
    try {
      const result = await deployDemoHub({
        token,
        projectName: demoHub.projectName,
        teamId: workspace.config.vercelConfig?.teamId,
        workspacePath: workspace.path,
        sourceDir: demoHub.sourceDir,
      });
      const url = result.url.replace(/^\/\//, 'https://');
      setDemoHubToast({ msg: `Publicado ✔ ${url}`, ok: true });
      if (demoHubToastTimerRef.current) clearTimeout(demoHubToastTimerRef.current);
      demoHubToastTimerRef.current = setTimeout(() => setDemoHubToast(null), 8000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDemoHubToast({ msg: `Erro: ${msg}`, ok: false });
      if (demoHubToastTimerRef.current) clearTimeout(demoHubToastTimerRef.current);
      demoHubToastTimerRef.current = setTimeout(() => setDemoHubToast(null), 8000);
    }
  }, [workspace]);
  // Pandoc PDF export
  const [pandocBusy, setPandocBusy] = useState(false);
  const [pandocError, setPandocError] = useState<string | null>(null);
  const [pandocStatus, setPandocStatus] = useState<{ detail?: string; cancelRequested?: boolean } | null>(null);
  const pandocCancelRef = useRef(false);
  // Export lock — shown while auto-opening a canvas for export (blur + coffee animation)
  const [exportLock, setExportLock] = useState(false);
  const [exportLockState, setExportLockState] = useState<{
    title: string;
    detail?: string;
    cancelRequested?: boolean;
  } | null>(null);
  const exportRestoreTabRef = useRef<string | null>(null);
  // Always-fresh ref for dirty state so watcher can check without stale closure
  const dirtyFilesRef = useRef<Set<string>>(dirtyFiles);
  dirtyFilesRef.current = dirtyFiles;
  // Ref passed to Sidebar so ⌘T/⌘N can trigger new-file creation
  const newFileRef = useRef<(() => void) | null>(null);
  // Drag-drop from Finder
  const [dragOver, setDragOver] = useState(false);
  const [dragFiles, setDragFiles] = useState<string[]>([]);

  // Derived from active file
  const fileTypeInfo = activeFile ? getFileTypeInfo(activeFile) : null;
  // Backlinks — scan only markdown files; disable during focus mode for perf
  const { backlinks, outlinks, loading: backlinksLoading } = useBacklinks(
    activeFile,
    workspace,
    fileTypeInfo?.kind === 'markdown',
  );
  // TypeScript/JS diagnostics — run tsc on the active file when it's a code file
  const tsEnabled = fileTypeInfo?.language === 'typescript' || fileTypeInfo?.language === 'javascript';
  const tsDiags = useTsDiagnostics(
    content,
    activeFile ?? null,
    workspace?.path ?? null,
    tsEnabled,
  );
  const fileMeta = useMemo<FileMeta>(() => ({
    kind: fileTypeInfo?.kind ?? null,
    wordCount,
    lines: lineCount,
    slides: canvasSlideCount,
    fileStat,
    tsErrors: tsDiags.errorCount > 0 || tsDiags.warningCount > 0 || tsEnabled ? tsDiags.errorCount : undefined,
    tsWarnings: tsEnabled ? tsDiags.warningCount : undefined,
  }), [fileTypeInfo?.kind, wordCount, lineCount, canvasSlideCount, fileStat, tsDiags, tsEnabled]);

  // ── In-app update ───────────────────────────────────────────
  // dev      → open UpdateModal (runs local build script)
  // release  → open UpdateReleaseModal (GitHub Releases / Tauri updater)
  // mas      → open Mac App Store page
  // ios      → open iOS App Store page
  const APP_STORE_URL = 'https://apps.apple.com/app/id6759814955';
  async function handleUpdate() {
    let channel = 'dev';
    try { channel = await invoke<string>('build_channel'); } catch { /* older build */ }
    if (channel === 'mas') {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      openUrl(`macappstore://apps.apple.com/app/id6759814955`).catch(() =>
        openUrl(APP_STORE_URL)
      );
    } else if (channel === 'ios') {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      openUrl(APP_STORE_URL).catch(() => {});
    } else if (channel === 'release') {
      setShowUpdateReleaseModal(true);
    } else {
      // dev desktop builds — update via local build script
      setShowUpdateModal(true);
    }
  }

  // Listen for the native menu "Update Cafezin…" event
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen('menu-update-app', () => handleUpdate());
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for the native menu "Settings…" event (⌘,)
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen('menu-settings', () => openSettings());
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
  // openSettings is stable (useCallback in useModals) — safe to omit from deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for cafezin:open-settings events dispatched by PremiumGate and other components
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent<string>).detail;
      openSettings(tab as Parameters<typeof openSettings>[0]);
    };
    window.addEventListener('cafezin:open-settings', handler);
    return () => window.removeEventListener('cafezin:open-settings', handler);
  // openSettings is stable (useCallback in useModals) — safe to omit from deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for native File / View menu events
  useEffect(() => {
    if (!isTauri) return;
    const uns = [
      listen('menu-new-window',     () => { void handleOpenNewWindow(); }),
      listen('menu-new-file',       () => { setSidebarOpen(true); setTimeout(() => newFileRef.current?.(), 80); }),
      listen('menu-export-pdf',     () => { if (fileTypeInfo?.kind === 'markdown') handleExportPDF(); }),
      listen('menu-export-modal',   () => setExportModalOpen(true)),
      listen('menu-switch-workspace', () => handleSwitchWorkspace()),
      listen('menu-toggle-sidebar', () => setSidebarOpen((v) => !v)),
      listen('menu-image-search',   () => setImgSearchOpen(true)),
      listen('menu-toggle-copilot', () => setAiOpen((v) => !v)),
      listen('menu-view-edit',      () => { setViewMode('edit');    if (activeTabId) tabViewModeRef.current.set(activeTabId, 'edit'); }),
      listen('menu-view-preview',   () => { setViewMode('preview'); if (activeTabId) tabViewModeRef.current.set(activeTabId, 'preview'); }),
      listen('menu-format-file',    () => { if (fileTypeInfo?.kind === 'code' && viewMode === 'edit') handleFormat(); }),
    ];
    return () => { uns.forEach((p) => p.then((fn) => fn()).catch(() => {})); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileTypeInfo?.kind, viewMode, activeTabId]);

  // ── OAuth deep-link callback (cafezin://auth/callback#access_token=...) ───
  // Delegated to useAuthSession. onAuthSuccess runs syncSecretsFromCloud and
  // dispatches cafezin:auth-updated so WorkspacePicker can refresh its state.
  useAuthSession({
    onAuthSuccess: async () => {
      await syncSecretsFromCloud();
      window.dispatchEvent(new CustomEvent('cafezin:auth-updated'));
    },
  });

  // On startup, silently pull any secrets already saved to Supabase.
  // No-ops when not logged in or offline.
  useEffect(() => { syncSecretsFromCloud(); }, []);

  // Apply/remove light theme class on body
  useEffect(() => {
    const isLight = resolvedTheme === 'light';
    document.documentElement.classList.toggle('theme-light', isLight);
    document.body.classList.toggle('theme-light', isLight);
  }, [resolvedTheme]);

  // Keep autosave delay ref in sync
  useEffect(() => {
    autosaveDelayRef.current = appSettings.autosaveDelay;
  }, [appSettings.autosaveDelay]);

  // Clear media/file stat when switching files
  useEffect(() => { setFileStat(null); }, [activeFile]);

  // ── Drag-and-drop from Finder ─────────────────────────────────
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    getCurrentWindow().onDragDropEvent((event) => {
      const type = event.payload.type;
      if (type === 'enter' || type === 'over') {
        const paths: string[] = (event.payload as { paths?: string[] }).paths ?? [];
        // Ignore internal DOM drags (e.g. slide strip reorder) — they have no paths
        if (paths.length === 0) return;
        setDragFiles(paths);
        // Don't show full-screen overlay when hovering over the AI panel
        const pos = (event.payload as { position?: { x: number; y: number } }).position;
        const hitEl = pos ? document.elementFromPoint(pos.x, pos.y) : null;
        setDragOver(!hitEl?.closest('[data-panel="ai"]'));
      } else if (type === 'drop') {
        setDragOver(false);
        const paths: string[] = (event.payload as { paths?: string[] }).paths ?? [];
        // Use workspaceRef so this callback doesn't re-register on every file open
        if (paths.length > 0 && workspaceRef.current) {
          // Route to AI panel if the drop landed over it, otherwise open as file
          const pos = (event.payload as { position?: { x: number; y: number } }).position;
          const hitEl = pos ? document.elementFromPoint(pos.x, pos.y) : null;
          if (aiPanelRef.current && hitEl?.closest('[data-panel="ai"]')) {
            setAiOpen(true);
            aiPanelRef.current.receiveFinderFiles(paths);
          } else {
            handleDroppedFiles(paths);
          }
        }
      } else {
        setDragOver(false);
        setDragFiles([]);
      }
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  // Use workspace?.path (not the full object) so this only re-registers when the
  // workspace actually changes, not on every file open (which creates a new object).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.path]);

  // ── Keep a stable ref to workspace so watcher callback always sees latest ───
  const workspaceRef = useRef<typeof workspace>(workspace);
  useEffect(() => { workspaceRef.current = workspace; }, [workspace]);

  // Persist tab + preview state per workspace (debounced, 800 ms)
  useEffect(() => {
    if (!workspace) return;
    const id = setTimeout(() => {
      saveWorkspaceSession(workspace.path, { tabs, activeTabId, previewTabId });
    }, 800);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.path, tabs, activeTabId, previewTabId]);

  // ── Reload active file from disk ───────────────────────────────────────────
  async function reloadActiveFile() {
    if (!workspace || !activeTabId) return;
    const info = getFileTypeInfo(activeTabId);
    if (info.kind === 'pdf' || info.kind === 'video' || info.kind === 'audio' || info.kind === 'image' || info.kind === 'spreadsheet') return;
    try {
      const text = await readFile(workspace, activeTabId);
      savedContentRef.current.set(activeTabId, text);
      tabContentsRef.current.set(activeTabId, text);
      setContent(text);
      setDirtyFiles((prev) => { const next = new Set(prev); next.delete(activeTabId); return next; });
    } catch (err) {
      console.error('[reload] Failed to reload file:', err);
    }
  }

  // ── Keyboard shortcuts ───────────────────────────────────────
  useKeyboardShortcuts({
    aiOpen,
    activeTabId,
    tabs,
    fileTypeInfo,
    shortcutOverrides: appSettings.shortcutOverrides,
    onOpenAI:        () => { setAiInitialPrompt(''); setAiOpen(true); },
    onCloseAI:       () => setAiOpen(false),
    onCloseTab:      handleCloseTab,
    onOpenSettings:  () => openSettings(),
    onToggleSidebar: () => setSidebarOpen((v) => {
      // When opening from icon-mode (width < 80 px), snap sidebar back to normal
      if (!v && sidebarWidthRef.current < 80) setSidebarWidth(220);
      return !v;
    }),
    onSave: async () => {
      const kind = fileTypeInfo?.kind;
      if (activeTabId && workspace && kind !== 'pdf' && kind !== 'video' && kind !== 'image' && kind !== 'spreadsheet') {
        if (kind === 'canvas') forceSaveRef.current?.();
        const current = tabContentsRef.current.get(activeTabId) ?? content;
        cancelAutosave();
        let textToSave = current;
        if (appSettings.formatOnSave !== false && fileTypeInfo?.language && kind !== 'canvas') {
          const formatted = await formatContent(current, fileTypeInfo.language);
          if (formatted !== current) {
            textToSave = formatted;
            tabContentsRef.current.set(activeTabId, formatted);
            setContent(formatted);
          }
        }
        writeFile(workspace, activeTabId, textToSave).then(() => {
          savedContentRef.current.set(activeTabId, textToSave);
          setDirtyFiles((prev) => { const s = new Set(prev); s.delete(activeTabId); return s; });
          setSaveError(null);
          setSavedToast(true);
          if (savedToastTimerRef.current) clearTimeout(savedToastTimerRef.current);
          savedToastTimerRef.current = setTimeout(() => setSavedToast(false), 1800);
        }).catch((err) => {
          console.error('Manual save failed:', err);
          setSaveError(String((err as Error)?.message ?? err));
        });
      }
    },
    onReload:        reloadActiveFile,
    onNewFile:       () => { setSidebarOpen(true); setTimeout(() => newFileRef.current?.(), 80); },
    onSwitchTab:     switchToTab,
    onToggleFind:    () => setFindReplaceOpen(true),
    onGlobalSearch:  () => { setSidebarOpen(true); setSidebarMode('search'); },
    onTogglePreview: () => {
      if (fileTypeInfo?.supportsPreview) {
        setViewMode((v) => {
          const next = v === 'edit' ? 'preview' : 'edit';
          if (activeTabId) tabViewModeRef.current.set(activeTabId, next);
          return next;
        });
      }
    },
    onToggleTerminal: () => setTerminalOpen((v) => !v),
    focusMode,
    onToggleFocusMode: () => {
      setFocusMode((v) => {
        if (!v) { setSidebarOpen(false); setAiOpen(false); }
        return !v;
      });
    },
  });

  // ── Jump to text/line after project-search navigation ───────────────────────
  useEffect(() => {
    if ((pendingJumpText == null && pendingJumpLine == null) || !activeFile) return;
    // Use a short delay so the editor has mounted with the new content
    const t = setTimeout(() => {
      if (pendingJumpLine != null) { editorRef.current?.jumpToLine(pendingJumpLine); setPendingJumpLine(null); }
      else if (pendingJumpText)    { editorRef.current?.jumpToText(pendingJumpText);  setPendingJumpText(null); }
    }, 250);
    return () => clearTimeout(t);
  }, [content, pendingJumpText, pendingJumpLine, activeFile]);

  // ── Project search result open handler ──────────────────────────────────────
  const handleSearchFileOpen = useCallback(async (relPath: string, lineNo?: number, matchText?: string) => {
    await handleOpenFile(relPath);
    if (lineNo != null) setPendingJumpLine(lineNo);
    else if (matchText) setPendingJumpText(matchText);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Format via Prettier standalone ─────────────────────────────────────────
  async function handleFormat() {
    if (!activeFile || !workspace || fileTypeInfo?.kind !== 'code') return;
    const current = tabContentsRef.current.get(activeFile) ?? content;
    const formatted = await formatContent(current, fileTypeInfo.language ?? '');
    if (formatted !== current) {
      tabContentsRef.current.set(activeFile, formatted);
      setContent(formatted);
      scheduleAutosave(workspace, activeFile, formatted);
    }
  }

  async function formatContent(code: string, language: string): Promise<string> {
    try {
      const prettier = await import('prettier/standalone');
      if (language === 'javascript' || language === 'jsx') {
        const [babel, estree] = await Promise.all([
          import('prettier/plugins/babel'),
          import('prettier/plugins/estree'),
        ]);
        return await prettier.format(code, { parser: 'babel', plugins: [babel, estree] });
      }
      if (language === 'typescript' || language === 'tsx') {
        const [ts, estree] = await Promise.all([
          import('prettier/plugins/typescript'),
          import('prettier/plugins/estree'),
        ]);
        return await prettier.format(code, { parser: 'typescript', plugins: [ts, estree] });
      }
      if (language === 'json') {
        const [babel, estree] = await Promise.all([
          import('prettier/plugins/babel'),
          import('prettier/plugins/estree'),
        ]);
        return await prettier.format(code, { parser: 'json', plugins: [babel, estree] });
      }
      if (language === 'css' || language === 'scss' || language === 'less') {
        const css = await import('prettier/plugins/postcss');
        return await prettier.format(code, { parser: 'css', plugins: [css] });
      }
      if (language === 'html') {
        const html = await import('prettier/plugins/html');
        return await prettier.format(code, { parser: 'html', plugins: [html] });
      }
    } catch { /* formatting failed — return original */ }
    return code;
  }

  // ── Workspace file tree refresh ────────────────────────────────────────────
  // Rebuilds files + fileTree and merges into workspace state.
  // Used after any operation that creates, deletes, or moves a file.
  const refreshWorkspace = useCallback(async (
    ws: Workspace,
    nextState?: { files: string[]; fileTree: Workspace['fileTree'] },
  ) => {
    const fileTree = nextState?.fileTree ?? await refreshFileTree(ws);
    const files = nextState?.files ?? flatMdFiles(fileTree);
    setWorkspace((prev) => prev ? { ...prev, files, fileTree } : prev);
  }, []);

  // ── File system watcher ────────────────────────────────────────────────────
  // Placed after refreshWorkspace to avoid temporal-dead-zone issues.
  useFileWatcher({
    watchPath: workspace?.path,
    workspaceRef,
    tabsRef,
    dirtyFilesRef,
    activeTabIdRef,
    tabContentsRef,
    savedContentRef,
    onRefresh: refreshWorkspace,
    setContent,
  });

  // ── Handle files dropped from Finder ─────────────────────────────────────────
  async function handleDroppedFiles(paths: string[]) {
    if (!workspace) return;
    const wsRoot = workspace.path;
    const opened: string[] = [];

    // When a canvas is active, the canvas's own capture-phase DOM drop handler
    // already saves image/media files to workspace/images/ and places them on
    // the canvas. The Tauri onDragDropEvent fires independently (OS-level) and
    // would *also* copy those same files to workspace root and open MediaViewer
    // tabs, navigating away from the canvas. Detect this case and skip entirely
    // for image/media files.
    const activeKind = activeTabIdRef.current
      ? getFileTypeInfo(activeTabIdRef.current).kind
      : null;
    const canvasIsActive = activeKind === 'canvas';

    for (const absPath of paths) {
      // Skip directories (no trailing slash check needed — Tauri only sends files)
      const name = absPath.split('/').pop();
      if (!name) continue;

      // Skip image/media files when canvas is active — canvas handled them already
      const dropKind = getFileTypeInfo(name).kind;
      if (canvasIsActive && (dropKind === 'image' || dropKind === 'video' || dropKind === 'audio')) {
        continue;
      }

      let relPath: string;

      if (absPath.startsWith(wsRoot + '/')) {
        // File is already inside the workspace — derive relative path
        relPath = absPath.slice(wsRoot.length + 1);
      } else {
        // File is outside — copy it into workspace root
        relPath = name;
        const dest = `${wsRoot}/${name}`;
        try {
          await copyFile(absPath, dest);
        } catch (err) {
          console.error('Failed to copy dropped file:', err);
          continue;
        }
        // Refresh workspace file tree after copy
        await refreshWorkspace(workspace);
      }

      opened.push(relPath);
    }

    // Open each file (handleOpenFile handles tabs + switching)
    for (const relPath of opened) {
      await handleOpenFile(relPath);
    }
  }

  // ── Tab management — thin wrappers around useTabManager ──────────────────
  // Auto-promote preview → permanent once the file is edited
  useEffect(() => {
    if (previewTabId && dirtyFiles.has(previewTabId)) promoteTab(previewTabId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyFiles, previewTabId]);

  function handleCloseTab(filePath: string) {
    closeTab(filePath, (p) => {
      setDirtyFiles((prev) => { const next = new Set(prev); next.delete(p); return next; });
    });
  }

  function handleCloseAllTabs() {
    cancelAutosave();
    closeAllTabs((paths) => {
      setDirtyFiles((prev) => { const s = new Set(prev); paths.forEach((p) => s.delete(p)); return s; });
    });
  }

  function handleCloseOthers(filePath: string) {
    closeOthers(filePath, (paths) => {
      setDirtyFiles((prev) => { const s = new Set(prev); paths.forEach((p) => s.delete(p)); return s; });
    });
  }

  function handleCloseToRight(filePath: string) {
    closeToRight(filePath, (paths) => {
      setDirtyFiles((prev) => { const s = new Set(prev); paths.forEach((p) => s.delete(p)); return s; });
    });
  }

  // ── Export helpers ──────────────────────────────────────────────────────────

  async function handleOpenFileForExport(relPath: string): Promise<void> {
    // If the canvas is already the active tab with a live editor, nothing to open
    if (relPath === activeFile && canvasEditorRef.current) return;

    exportRestoreTabRef.current = activeTabId;
    setExportLock(true);
    setExportLockState((current) => current ?? {
      title: 'Exporting canvas…',
      detail: `Opening ${relPath}…`,
      cancelRequested: false,
    });
    // Null the ref so we can detect the fresh mount below
    canvasEditorRef.current = null;

    try {
      await handleOpenFile(relPath);
      // Poll until tldraw Editor is mounted (key={activeFile} on CanvasEditor remounts on switch).
      // The `mountedRef` guard ensures the poll stops immediately if the component unmounts
      // (e.g. user switches workspace mid-export), preventing ghost state updates.
      await new Promise<void>((resolve, reject) => {
        const start = Date.now();
        let timerId: ReturnType<typeof setTimeout> | null = null;
        const check = () => {
          if (!mountedRef.current) { reject(new Error('Component unmounted during export')); return; }
          if (canvasEditorRef.current) { resolve(); return; }
          if (Date.now() - start > 10_000) { reject(new Error('Canvas editor did not mount in time')); return; }
          timerId = setTimeout(check, 80);
        };
        // Store cleanup so the poll can be cancelled if the promise is abandoned
        check();
        // If the promise is gc'd (workspace switch) timerId will just fire once more
        // then bail via !mountedRef.current — no additional cleanup needed.
        void timerId;
      });
    } catch (e) {
      // Ensure lock is always cleared even when open/mount fails
      handleRestoreAfterExport();
      throw e;
    }
  }

  function handleRestoreAfterExport(): void {
    const prev = exportRestoreTabRef.current;
    if (prev) switchToTab(prev);
    exportRestoreTabRef.current = null;
    setExportLock(false);
    setExportLockState(null);
  }

  async function handleExportConfigChange(config: WorkspaceExportConfig): Promise<void> {
    if (!workspace) return;
    const updated: Workspace = {
      ...workspace,
      config: {
        ...workspace.config,
        exportConfig: normalizeWorkspaceExportConfig(config),
      },
    };
    setWorkspace(updated);
    try { await saveWorkspaceConfig(updated); } catch (e) { console.error('Failed to save export config:', e); }
  }

  async function handleWorkspaceConfigChange(patch: Partial<WorkspaceConfig>): Promise<void> {
    if (!workspace) return;
    const updated: Workspace = { ...workspace, config: { ...workspace.config, ...patch } };
    setWorkspace(updated);
    try { await saveWorkspaceConfig(updated); } catch (e) { console.error('Failed to save workspace config:', e); }
  }

  // ── File open ────────────────────────────────────────────────────────────────
  async function handleOpenFile(filename: string) {
    if (!workspace) return;

    // If already open in a tab, just focus it
    if (tabsRef.current.includes(filename)) {
      switchToTab(filename);
      return;
    }

    const info = getFileTypeInfo(filename);

    // Binary/non-text files: no content to read — register tab and switch
    if (info.kind === 'pdf' || info.kind === 'video' || info.kind === 'audio' || info.kind === 'image' || info.kind === 'spreadsheet') {
      tabContentsRef.current.set(filename, '');
      tabViewModeRef.current.set(filename, info.defaultMode as 'edit' | 'preview');
      addTab(filename);
      switchToTab(filename);
      trackFileOpen(workspace, filename).then(setWorkspace).catch(() => {});
      return;
    }

    try {
      const text = await readFile(workspace, filename);
      savedContentRef.current.set(filename, text);
      tabContentsRef.current.set(filename, text);
      tabViewModeRef.current.set(filename, info.defaultMode as 'edit' | 'preview');
      addTab(filename);
      switchToTab(filename);
      trackFileOpen(workspace, filename).then(setWorkspace).catch(() => {});
    } catch (err) {
      console.error('Failed to open file:', err);
      setSaveError(`Could not open "${filename}": ${(err as Error)?.message ?? String(err)}`);
    }
  }

  // ── File create (delegated to Sidebar) ────────────────────────────────────
  // Note: Sidebar handles workspace mutations (files + fileTree) itself via onWorkspaceChange.

  function handleWorkspaceChange(ws: Workspace) {
    const isSameWorkspace = workspace?.path === ws.path;
    setWorkspace(ws);
    // On workspace switch, close all tabs and go to home
    if (!isSameWorkspace) clearAll();
  }

  async function handleCreateFirstWorkspaceFile() {
    if (!workspace) return;

    let filename = 'untitled.md';
    let suffix = 2;
    while (await exists(`${workspace.path}/${filename}`)) {
      filename = `untitled-${suffix}.md`;
      suffix += 1;
    }

    try {
      await createFile(workspace, filename);
      await refreshWorkspace(workspace);
      await handleOpenFile(filename);
    } catch (err) {
      setSaveError(`Could not create "${filename}": ${(err as Error)?.message ?? String(err)}`);
    }
  }

  // scheduleAutosave is provided by useAutosave (declared near useDragResize)

  // ── Auto-save (debounced 1s) ─────────────────────────────────
  const handleContentChange = useCallback(
    (newContent: string) => {
      // Canvas files are self-managed by tldraw — never feed changed JSON back
      // into React state or tldraw will see the `snapshot` prop change and reset.
      if (!activeFile?.endsWith('.tldr.json')) setContent(newContent);
      // Keep per-tab content ref in sync so switching away/back is lossless
      if (activeFile) tabContentsRef.current.set(activeFile, newContent);
      if (!workspace || !activeFile) return;

      // Auto-remove AI marks whose text no longer exists in the document
      // (delegated to useAIMarks).
      cleanupMarksForContent(activeFile, newContent);

      // Canvas files: the tldraw store listener already debounces to 500ms before
      // calling onChange — a second autosave debounce (1s) is redundant and pushes
      // disk writes to ~1500ms. Write immediately here so the total latency is just
      // the 500ms from the tldraw store listener.
      if (activeFile.endsWith('.tldr.json')) {
        writeFile(workspace, activeFile, newContent)
          .then(() => {
            savedContentRef.current.set(activeFile, newContent);
            setDirtyFiles((prev) => { const s = new Set(prev); s.delete(activeFile); return s; });
            setSaveError(null);
          })
          .catch((err) => setSaveError(String((err as Error)?.message ?? err)));
        return;
      }

      scheduleAutosave(workspace, activeFile, newContent);
      recordEdit();
    },
    [workspace, activeFile, scheduleAutosave, recordEdit]
  );

  // ── App settings persistence ─────────────────────────────────
  function handleAppSettingsChange(settings: AppSettings) {
    setAppSettings(settings);
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
  }

  // ── Scan workspace for voice memos without transcripts (desktop only) ──────
  async function scanVoiceMemos(wsPath: string) {
    function parseStemDate(stem: string): Date {
      const body = stem.replace(/^memo_/, '');
      const iso  = body.replace(/_([0-9]{2})-([0-9]{2})-([0-9]{2})$/, 'T$1:$2:$3');
      const d = new Date(iso);
      return isNaN(d.getTime()) ? new Date(0) : d;
    }
    const dir = `${wsPath}/.cafezin/voice-memos`;
    const entries = await readDir(dir).catch(() => []);
    const stems = new Map<string, { audioExt?: string; hasTxt: boolean }>();
    for (const e of entries) {
      if (!e.name) continue;
      const dot  = e.name.lastIndexOf('.');
      if (dot < 0) continue;
      const stem = e.name.slice(0, dot);
      const ext  = e.name.slice(dot + 1).toLowerCase();
      if (!stems.has(stem)) stems.set(stem, { hasTxt: false });
      const rec = stems.get(stem)!;
      if (['webm','ogg','m4a','mp4'].includes(ext)) rec.audioExt = ext;
      if (ext === 'txt') rec.hasTxt = true;
    }
    const result: PendingVoiceMemo[] = [];
    for (const [stem, info] of stems) {
      if (!info.audioExt || info.hasTxt) continue;
      result.push({
        stem,
        audioExt:       info.audioExt,
        audioPath:      `${dir}/${stem}.${info.audioExt}`,
        transcriptPath: `${dir}/${stem}.txt`,
        timestamp:      parseStemDate(stem),
      });
    }
    result.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    setPendingVoiceMemos(result);
  }

  // Scan when workspace first loads
  useEffect(() => {
    if (workspace?.path) void scanVoiceMemos(workspace.path);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.path]);

  // ── Clear dirty state after a successful sync ─────────────────
  const handleSyncComplete = useCallback(() => {
    setDirtyFiles(new Set());
    if (workspace) void scanVoiceMemos(workspace.path);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  // ── Retry a failed save — invoked by the ⚠ banner in the header ─────────────
  function handleRetrySave() {
    if (!activeTabId || !workspace) return;
    if (fileTypeInfo?.kind === 'canvas') forceSaveRef.current?.();
    const current = tabContentsRef.current.get(activeTabId) ?? content;
    cancelAutosave();
    writeFile(workspace, activeTabId, current)
      .then(() => {
        savedContentRef.current.set(activeTabId, current);
        setDirtyFiles((prev) => { const s = new Set(prev); s.delete(activeTabId); return s; });
        setSaveError(null);
        setSavedToast(true);
        if (savedToastTimerRef.current) clearTimeout(savedToastTimerRef.current);
        savedToastTimerRef.current = setTimeout(() => setSavedToast(false), 1800);
      })
      .catch((err) => setSaveError(String((err as Error)?.message ?? err)));
  }

  // ── Export current markdown to PDF (pure-JS, no system deps) ────────────────
  async function handleExportPDF() {
    if (!workspace || !activeFile) return;
    const outRelPath = activeFile.replace(/\.[^/.]+$/, '') + '.pdf';
    const outAbsPath = `${workspace.path}/${outRelPath}`;
    pandocCancelRef.current = false;
    setPandocBusy(true);
    setPandocError(null);
    setPandocStatus({ detail: `Starting PDF export for ${activeFile}…`, cancelRequested: false });
    try {
      await exportMarkdownToPDF(content, outAbsPath, workspace.path, {
        features: workspace.config.features,
        hooks: {
          shouldCancel: () => pandocCancelRef.current,
          onProgress: (_phase, detail) => {
            setPandocStatus({ detail, cancelRequested: pandocCancelRef.current });
          },
        },
      });
      // Refresh sidebar so the PDF appears in the file tree
      await refreshWorkspace(workspace);
      await handleOpenFile(outRelPath);
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      if (message.includes('Export canceled by user.')) {
        setPandocError(null);
      } else {
        setPandocError(message);
      }
    } finally {
      setPandocBusy(false);
      setPandocStatus(null);
      pandocCancelRef.current = false;
    }
  }

  function handleCancelExportPDF() {
    if (!pandocBusy) return;
    pandocCancelRef.current = true;
    setPandocStatus((current) => ({
      detail: current?.detail ?? 'Stopping PDF export…',
      cancelRequested: true,
    }));
  }

  // ── Clipboard image paste (from Editor) ─────────────────────────────
  const handleEditorImagePaste = useCallback(async (file: File): Promise<string | null> => {
    if (!workspace) return null;
    try {
      const imagesDir = `${workspace.path}/images`;
      if (!(await exists(imagesDir))) {
        await mkdir(imagesDir, { recursive: true });
      }
      // Derive extension (png / jpeg → jpg / gif / webp etc.)
      const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
      const filename = `paste-${Date.now()}.${ext}`;
      const absPath = `${imagesDir}/${filename}`;
      const buf = await file.arrayBuffer();
      await writeBinaryFile(absPath, new Uint8Array(buf));
      // Refresh sidebar so the new file appears in the tree
      await refreshWorkspace(workspace);
      return `images/${filename}`;
    } catch (err) {
      console.error('Image paste save failed:', err);
      return null;
    }
  }, [workspace, refreshWorkspace]);
  // ── AI request from editor (⌘K selection) ───────────────────
  const handleAIRequest = useCallback((selectedText: string) => {
    setAiInitialPrompt(
      selectedText ? `Help me improve this:\n\n${selectedText}` : ''
    );
    setAiOpen(true);
  }, []);

  // ── Preferred model persistence ──────────────────────────────
  const handleModelChange = useCallback(async (newModel: string) => {
    if (!workspace) return;
    const resolvedModel = resolveCopilotModelForChatCompletions(newModel);
    const updated = { ...workspace, config: { ...workspace.config, preferredModel: resolvedModel } };
    setWorkspace(updated);
    try { await saveWorkspaceConfig(updated); } catch (err) { console.error('Failed to save model pref:', err); }
  }, [workspace]);

  const handleFileWritten = useCallback(async (_path: string) => {
    if (!workspace) return;
    try {
      await refreshWorkspace(workspace);
    } catch (err) {
      console.error('Failed to refresh workspace after file write:', err);
    }
  }, [workspace, refreshWorkspace]);

  // AI document context: for canvas, send live shape summary + command protocol
  // canvasEditorRef is a ref — intentionally not in deps (changes don't trigger re-render).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const aiDocumentContext = useMemo(() => {
    if (fileTypeInfo?.kind === 'canvas') {
      return canvasEditorRef.current
        ? canvasAIContext(canvasEditorRef.current, activeFile ?? '')
        : `Canvas file: ${activeFile ?? ''} (loading…)`;
    }
    return content;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileTypeInfo?.kind, activeFile, content]);
  // ── File deleted ────────────────────────────────────────
  function handleFileDeleted(relPath: string) {
    if (tabs.includes(relPath)) {
      handleCloseTab(relPath);
    }
  }
  // ── Switch workspace ────────────────────────────────────
  function handleSwitchWorkspace() {
    // Use refs to read latest state — this function is called from a Tauri menu
    // listener that may hold a stale closure (registered when deps were different).
    const dirty = dirtyFilesRef.current;
    const hasDirty = dirty.size > 0;
    if (isAIStreamingRef.current) {
      const ok = window.confirm(
        'Copilot is currently running. Close the workspace anyway?'
      );
      if (!ok) return;
    } else if (hasDirty) {
      const unsavedList = Array.from(dirty).join(', ');
      const ok = window.confirm(
        `You have unsaved changes in: ${unsavedList}\n\nClose the workspace anyway?`
      );
      if (!ok) return;
    }
    // Cancel any pending auto-save and clear all tabs
    cancelAutosave();
    clearAll();
    setWorkspace(null);
    setDirtyFiles(new Set());
    setAiMarks([]);
    setIsAIStreaming(false);
    setHomeVisible(true);
  }

  async function handleOpenNewWindow() {
    try {
      await openWorkspaceWindow();
    } catch (err) {
      setSaveError(`Could not open a new window: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  // ── Workspace loaded ─────────────────────────────────────────
  async function handleWorkspaceLoaded(ws: Workspace) {
    // Clear any previous workspace state
    clearAll();
    setWorkspace(ws);
    setHomeVisible(true);
    // Load AI edit marks for this workspace
    loadMarksForWorkspace(ws);

    // Trigger async index rebuild in the background so the prompt context and
    // search_workspace_index tool always have fresh metadata.
    // We don't await this — workspace is usable immediately with the cached index.
    buildWorkspaceIndex(ws.path, ws.fileTree, ws.workspaceIndex ?? null)
      .then((index) => {
        setWorkspace((prev) =>
          prev?.path === ws.path ? { ...prev, workspaceIndex: index } : prev,
        );
      })
      .catch(() => { /* non-fatal — agent falls back to live outline_workspace */ });

    // Check for pending tasks queued from mobile
    const pending = await loadPendingTasks(ws.path);
    if (pending.length > 0) {
      setMobilePendingTasks(pending);
      setShowMobilePending(true);
    }

    // Restore last session (open tabs + active file) — read all files in parallel
    const session = loadWorkspaceSession(ws.path);
    if (session.tabs.length > 0) {
      const results = await Promise.all(
        session.tabs.map(async (filePath) => {
          const info = getFileTypeInfo(filePath);
          if (info.kind === 'pdf' || info.kind === 'video' || info.kind === 'audio' || info.kind === 'image') {
            tabContentsRef.current.set(filePath, '');
            tabViewModeRef.current.set(filePath, info.defaultMode as 'edit' | 'preview');
            return filePath;
          }
          try {
            const text = await readFile(ws, filePath);
            savedContentRef.current.set(filePath, text);
            tabContentsRef.current.set(filePath, text);
            tabViewModeRef.current.set(filePath, info.defaultMode as 'edit' | 'preview');
            return filePath;
          } catch { return null; /* file deleted since last session — skip */ }
        }),
      );
      const restored = results.filter((p): p is string => p !== null);
      if (restored.length > 0) {
        setTabs(restored);
        const preview = session.previewTabId && restored.includes(session.previewTabId)
          ? session.previewTabId : null;
        setPreviewTabId(preview);
        const activeId = session.activeTabId && restored.includes(session.activeTabId)
          ? session.activeTabId : restored[restored.length - 1];
        setActiveTabId(activeId);
        setContent(tabContentsRef.current.get(activeId) ?? '');
        setViewMode(tabViewModeRef.current.get(activeId) ?? (getFileTypeInfo(activeId).defaultMode as 'edit' | 'preview'));
      }
    }
  }

  const title = useMemo(
    () => activeFile
      ? (content.match(/^#\s+(.+)$/m)?.[1] ?? activeFile)
      : workspace?.name ?? 'Untitled',
    [activeFile, content, workspace?.name],
  );

  function handleExecutePendingTask(task: MobilePendingTask) {
    setAiInitialPrompt(task.description);
    setAiOpen(true);
  }

  const handleViewModeChange = useCallback((mode: 'edit' | 'preview') => {
    setViewMode(mode);
    if (activeTabId) tabViewModeRef.current.set(activeTabId, mode);
  }, [activeTabId, setViewMode, tabViewModeRef]);

  const handleCanvasPresentModeChange = useCallback((presenting: boolean) => {
    handleViewModeChange(presenting ? 'preview' : 'edit');
  }, [handleViewModeChange]);

  const handleRecoverCanvas = useCallback(async () => {
    if (!workspace || !activeFile) return;
    try {
      const fresh = await readFile(workspace, activeFile);
      savedContentRef.current.set(activeFile, fresh);
      tabContentsRef.current.set(activeFile, fresh);
      setContent(fresh);
    } catch {
      // Keep whatever is on disk if reload fails.
    }
    setCanvasResetKey((value) => value + 1);
  }, [activeFile, savedContentRef, setContent, tabContentsRef, workspace]);

  // ── No workspace yet — show picker ──────────────────────────
  if (!workspace) {
    return (
      <>
        {splash && <SplashScreen visible={splashVisible} />}
        {!launchWorkspacePending && (
          <WorkspacePicker onOpen={handleWorkspaceLoaded} externalError={launchWorkspaceError} />
        )}
        <UpdateModal
          open={showUpdateModal}
          projectRoot={__PROJECT_ROOT__}
          onClose={() => setShowUpdateModal(false)}
        />
        <UpdateReleaseModal
          open={showUpdateReleaseModal}
          onClose={() => setShowUpdateReleaseModal(false)}
        />
      </>
    );
  }

  return (
    <div className={`app${focusMode ? ' focus-mode' : ''}${exportLock ? ' app--exporting' : ''}`}>
      {splash && <SplashScreen visible={splashVisible} />}
      {/* Export lock overlay — full-window fixed overlay while canvas export runs */}
      {exportLock && (
        <div className="export-lock-overlay" aria-live="polite">
          <div className="export-lock-card">
            <span className="export-lock-title">{exportLockState?.title ?? 'Exporting…'}</span>
            {exportLockState?.detail && (
              <span className="export-lock-detail">{exportLockState.detail}</span>
            )}
            <span className="export-lock-hint">
              {exportLockState?.cancelRequested
                ? 'Stopping after the current safe step…'
                : 'The UI is temporarily locked so Cafezin can switch canvases safely.'}
            </span>
          </div>
        </div>
      )}
      {focusMode && (
        <button
          className="app-focus-exit"
          onClick={() => setFocusMode(false)}
          title={`Exit Zen Mode (Esc or ${focusModeShortcutLabel})`}
        >✕ zen</button>
      )}
      <AppHeader
        sidebarOpen={sidebarOpen}
        sidebarShortcutLabel={sidebarShortcutLabel}
        onToggleSidebar={() => setSidebarOpen((value) => !value)}
        activeFile={activeFile}
        title={title}
        workspace={workspace}
        onGoHome={() => switchToTab(null)}
        fileTypeInfo={fileTypeInfo}
        viewMode={viewMode}
        onSetViewMode={handleViewModeChange}
        pandocBusy={pandocBusy}
        pandocStatus={pandocStatus}
        onCancelPandocExport={handleCancelExportPDF}
        activeTabId={activeTabId}
        saveError={saveError}
        onRetrySave={handleRetrySave}
        dirtyFiles={dirtyFiles}
        savedToast={savedToast}
        demoHubToast={demoHubToast}
        onClearDemoHubToast={() => setDemoHubToast(null)}
        pandocError={pandocError}
        onClearPandocError={() => setPandocError(null)}
        isDev={import.meta.env.DEV}
        aiOpen={aiOpen}
        onToggleAi={() => setAiOpen((value) => !value)}
        previewShortcutLabel={previewShortcutLabel}
      />

      {/* Workspace: editor body + bottom terminal panel */}
      <div className="app-workspace">
      {/* Main 3-column body */}
      <div className="app-body">
        {sidebarOpen && (
          <>
            <Sidebar
              workspace={workspace}
              activeFile={activeFile}
              dirtyFiles={dirtyFiles}
              aiMarks={aiMarks}
              aiNavCount={activeFileMarks.length}
              aiNavIndex={aiNavIndex}
              style={{ width: sidebarWidth }}
              onFileSelect={handleOpenFile}
              onWorkspaceChange={handleWorkspaceChange}
              onUpdate={handleUpdate}
              onSyncComplete={handleSyncComplete}
              sidebarMode={sidebarMode}
              onSidebarModeChange={setSidebarMode}
              onReviewAllMarks={handleReviewAllMarks}
              onOpenAIReview={() => {
                setAiHighlight(true);
                setAiNavIndex(0);
                if (activeFileMarks.length > 0) {
                  const m = activeFileMarks[0];
                  if (m.canvasShapeIds?.length && canvasEditorRef.current) {
                    const bounds = canvasEditorRef.current.getShapePageBounds(m.canvasShapeIds[0] as TLShapeId);
                    if (bounds) canvasEditorRef.current.zoomToBounds(bounds, { animation: { duration: 300 }, inset: 60 });
                  } else {
                    setTimeout(() => editorRef.current?.jumpToText(m.text), 120);
                  }
                }
              }}
              onAIPrev={handleAINavPrev}
              onAINext={handleAINavNext}
              onFileDeleted={handleFileDeleted}
              onSearchFileOpen={handleSearchFileOpen}
              lockedFiles={lockedFiles}
              newFileRef={newFileRef}
              onOpenTerminalAt={(relDir) => {
                const absDir = relDir ? `${workspace.path}/${relDir}` : workspace.path;
                setTerminalOpen(true);
                setTerminalRequestCd(absDir + '|' + Date.now());
              }}
              onRunButtonCommand={(command) => {
                setTerminalOpen(true);
                setTerminalRequestRun(command + '|' + Date.now());
              }}
              onPublishDemoHub={handlePublishDemoHub}
              onExportOpen={() => setExportModalOpen(true)}
              onExpandSidebar={() => { if (sidebarWidthRef.current < 80) setSidebarWidth(220); }}
            />
            {/* Sidebar resize handle */}
            <div className="resize-divider" onMouseDown={startSidebarDrag} />
          </>
        )}

        <AppEditorArea
          workspace={workspace}
          aiMarks={aiMarks}
          tabs={tabs}
          activeTabId={activeTabId}
          previewTabId={previewTabId}
          dirtyFiles={dirtyFiles}
          lockedFiles={lockedFiles}
          activeFile={activeFile}
          fileTypeInfo={fileTypeInfo}
          content={content}
          viewMode={viewMode}
          appSettings={appSettings}
          isDarkTheme={isDarkTheme}
          homeVisible={homeVisible}
          findReplaceOpen={findReplaceOpen}
          aiHighlight={aiHighlight}
          aiNavIndex={aiNavIndex}
          activeFileMarks={activeFileMarks}
          onAIPrev={handleAINavPrev}
          onAINext={handleAINavNext}
          backlinks={backlinks}
          outlinks={outlinks}
          backlinksLoading={backlinksLoading}
          canvasResetKey={canvasResetKey}
          onSlideCountChange={setCanvasSlideCount}
          tsDiagnostics={tsDiags.diagnostics}
          editorRef={editorRef}
          editorAreaRef={editorAreaRef}
          webPreviewRef={webPreviewRef}
          canvasEditorRef={canvasEditorRef}
          rescanFramesRef={rescanFramesRef}
          forceSaveRef={forceSaveRef}
          onSelectTab={switchToTab}
          onCloseTab={handleCloseTab}
          onCloseOthers={handleCloseOthers}
          onCloseToRight={handleCloseToRight}
          onCloseAllTabs={handleCloseAllTabs}
          onPromoteTab={promoteTab}
          onReorderTabs={reorderTabs}
          onSetFindReplaceOpen={setFindReplaceOpen}
          onContentChange={handleContentChange}
          onAIRequest={handleAIRequest}
          onSelectionContextChange={setAiSelectionContext}
          onMarkReviewed={handleMarkReviewed}
          onMarkRejected={handleMarkRejected}
          onMarkUserEdited={handleMarkUserEdited}
          onOpenFile={handleOpenFile}
          onCreateFirstWorkspaceFile={handleCreateFirstWorkspaceFile}
          onOpenAIReview={() => {
            setAiHighlight(true);
            setAiNavIndex(0);
          }}
          onSwitchWorkspace={handleSwitchWorkspace}
          onActivateSync={() => openSettings('sync')}
          onSetHomeVisible={setHomeVisible}
          onSetFileStat={setFileStat}
          onRecoverCanvas={handleRecoverCanvas}
          onCanvasEditorReady={(editor) => { canvasEditorRef.current = editor; }}
          onCanvasPresentModeChange={handleCanvasPresentModeChange}
          onFileSaved={() => handleFileWritten(activeFile ?? '')}
          onFormat={handleFormat}
          onImagePaste={handleEditorImagePaste}
          onGhostComplete={fetchGhostCompletion}
        />



        {/* AI panel resize handle — only visible when open */}
        {aiOpen && <div className="resize-divider" onMouseDown={startAiDrag} />}
        <AIPanel
          ref={aiPanelRef}
          isOpen={aiOpen}
          onClose={() => setAiOpen(false)}
          collapsed={aiPanelCollapsed}
          onCollapse={collapseAiPanel}
          onExpand={expandAiPanel}
          initialPrompt={aiInitialPrompt}
          initialModel={workspace.config.preferredModel}
          onModelChange={handleModelChange}
          documentContext={aiDocumentContext}
          agentContext={workspace.agentContext}
          workspacePath={workspace.path}
          workspace={workspace}
          canvasEditorRef={canvasEditorRef}
          onFileWritten={handleFileWritten}
          onMarkRecorded={handleMarkRecorded}
          onCanvasMarkRecorded={handleCanvasMarkRecorded}
          activeFile={activeFile ?? undefined}
          rescanFramesRef={rescanFramesRef}
          onStreamingChange={setIsAIStreaming}
          style={aiOpen ? { width: aiPanelWidth } : undefined}
          screenshotTargetRef={editorAreaRef}
          webPreviewRef={webPreviewRef}
          getActiveHtml={
            fileTypeInfo?.kind === 'code' && fileTypeInfo.supportsPreview && activeFile
              ? () => ({ html: content, absPath: `${workspace.path}/${activeFile}` })
              : undefined
          }
          workspaceExportConfig={workspace.config.exportConfig}
          onExportConfigChange={handleExportConfigChange}
          workspaceConfig={workspace.config}
          appLocale={appSettings.locale}
          onWorkspaceConfigChange={handleWorkspaceConfigChange}
          onOpenFileReference={handleSearchFileOpen}
          selectionContext={aiSelectionContext}
          pendingVoiceMemos={pendingVoiceMemos}
          onVoiceMemoHandled={(stem) =>
            setPendingVoiceMemos((prev) => prev.filter((m) => m.stem !== stem))
          }
        />

        {/* Drag-and-drop overlay — shown while dragging files from Finder */}
        {dragOver && (
          <div className="drop-overlay">
            <div className="drop-overlay-inner">
              <span className="drop-overlay-icon">⇣</span>
              <span className="drop-overlay-label">
                {dragFiles.length > 0
                  ? dragFiles.map((p) => p.split('/').pop()).join(', ')
                  : 'Drop to open'}
              </span>
            </div>
          </div>
        )}
      </div> {/* end app-body */}

      <BottomPanel
        workspacePath={workspace.path}
        open={terminalOpen}
        height={terminalHeight}
        onToggle={() => setTerminalOpen((v) => !v)}
        onHeightChange={setTerminalHeight}
        requestCd={terminalRequestCd}
        requestRun={terminalRequestRun}
        fileMeta={fileMeta}
        showTerminal={appSettings.showTerminal}
        locale={appSettings.locale ?? 'en'}
        toggleShortcutLabel={terminalShortcutLabel}
      />
      </div> {/* end app-workspace */}

      <AppOverlays
        projectRoot={__PROJECT_ROOT__}
        workspace={workspace}
        showUpdateModal={showUpdateModal}
        onCloseUpdateModal={() => setShowUpdateModal(false)}
        showUpdateReleaseModal={showUpdateReleaseModal}
        onCloseUpdateReleaseModal={() => setShowUpdateReleaseModal(false)}
        forceUpdateOpen={forceUpdateOpen}
        forceUpdateRequired={forceUpdateRequired}
        forceUpdateChannel={forceUpdateChannel}
        onUpdate={handleUpdate}
        showMobilePending={showMobilePending}
        mobilePendingTasks={mobilePendingTasks}
        onExecutePendingTask={handleExecutePendingTask}
        onCloseMobilePending={() => setShowMobilePending(false)}
        onDeleteMobilePendingTask={(id) => setMobilePendingTasks((prev) => prev.filter((task) => task.id !== id))}
        showSettings={showSettings}
        appSettings={appSettings}
        onAppSettingsChange={handleAppSettingsChange}
        onWorkspaceChange={setWorkspace}
        onOpenHelp={handleOpenDesktopHelp}
        onContactUs={handleContactUs}
        onCloseSettings={() => setShowSettings(false)}
        settingsInitialTab={settingsInitialTab}
        showDesktopOnboarding={showDesktopOnboarding}
        desktopOnboardingSeen={desktopOnboardingSeen}
        onCloseDesktopOnboarding={handleCloseDesktopOnboarding}
        exportModalOpen={exportModalOpen}
        canvasEditorRef={canvasEditorRef}
        activeFile={activeFile}
        onOpenFileForExport={handleOpenFileForExport}
        onRestoreAfterExport={handleRestoreAfterExport}
        onCloseExportModal={() => setExportModalOpen(false)}
        onOpenAIFromExport={(prompt) => {
          setExportModalOpen(false);
          setAiInitialPrompt(prompt);
          setAiOpen(true);
        }}
        onExportLockStateChange={setExportLockState}
        imgSearchOpen={imgSearchOpen}
        onCloseImageSearch={() => setImgSearchOpen(false)}
        copilotOverlayActive={copilotOverlayActive}
        activeNudge={activeNudge}
        onAskNudge={(prompt) => {
          dismissNudge();
          setAiInitialPrompt(prompt);
          setAiOpen(true);
        }}
        onDismissNudge={dismissNudge}
        updateToastVersion={updateToastVersion}
        setUpdateToastVersion={setUpdateToastVersion}
        onOpenUpdateReleaseModal={() => setShowUpdateReleaseModal(true)}
      />

    </div>
  );
}

