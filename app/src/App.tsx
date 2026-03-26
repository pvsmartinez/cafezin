import { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from 'react';

import { invoke } from '@tauri-apps/api/core';
import { writeFile as writeBinaryFile, mkdir, exists } from './services/fs';
import type { EditorHandle } from './components/Editor';
import type { AIPanelHandle } from './components/AIPanel';
import WorkspacePicker from './components/WorkspacePicker';
import SplashScreen from './components/SplashScreen';
import Sidebar from './components/Sidebar';
import type { WebPreviewHandle } from './components/WebPreview';
import UpdateModal from './components/UpdateModal';
import UpdateReleaseModal from './components/UpdateReleaseModal';
import type { MobilePendingTask } from './services/mobilePendingTasks';
import { markWorkspaceMemoryEntriesStale } from './services/memoryMetadata';


import BottomPanel, { type FileMeta } from './components/BottomPanel';
import { useDragResize } from './hooks/useDragResize';
import { syncSecretsFromCloud } from './services/apiSecrets';

import { resolveCopilotModelForChatCompletions } from './services/copilot';
import { useTabManager } from './hooks/useTabManager';
import { useAutosave } from './hooks/useAutosave';
import { useFileWatcher } from './hooks/useFileWatcher';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import type { TLShapeId, Editor as TldrawEditor } from 'tldraw';
// canvasAIContext is loaded lazily (see useEffect below) to keep tldraw
// out of the main bundle — it's only needed when a canvas file is open.
import { registerCanvasTabControls, getCanvasEditor } from './utils/canvasRegistry';

import {
  loadWorkspace,
  readFile,
  writeFile,
  saveWorkspaceConfig,
  trackFileOpen,
  createFile,
  flatMdFiles,
  refreshFileTree,
} from './services/workspace';
import { useAuthSession } from './hooks/useAuthSession';
import { onLockedFilesChange, getLockedFiles } from './services/copilotLock';
import { saveWorkspaceSession } from './services/workspaceSession';
import { getFileTypeInfo } from './utils/fileType';
import { type AISelectionContext, type AgentContextSnapshot, type Workspace, type WorkspaceChangeNotice, type AppSettings, type WorkspaceConfig } from './types';
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
import { consumeLaunchWorkspacePath } from './services/windowing';
import { formatShortcutLabel, getShortcutBindings } from './keyboardShortcuts';
import { useExport } from './hooks/useExport';
import { useVoiceMemos } from './hooks/useVoiceMemos';
import { useTauriMenuListeners } from './hooks/useTauriMenuListeners';
import { useDemoHub } from './hooks/useDemoHub';
import { useDroppedFiles } from './hooks/useDroppedFiles';
import { useEditorZoom } from './hooks/useEditorZoom';
import { useAIDocumentContext } from './hooks/useAIDocumentContext';
import { useWorkspaceSession } from './hooks/useWorkspaceSession';
import { formatContent } from './utils/formatUtils';
import { useAppSession } from './hooks/useAppSession';
import {
  compareVersions,
  FALLBACK_CONTENT,
  collectWorkspaceFilePaths,
  sameStringArray,
  sameFileTree,
  remapPathSet,
  diffWorkspacePaths,
} from './utils/appUtils';
import './App.css';

// Eagerly init i18n before first render so translated strings show immediately
setupI18n(loadAppSettings().locale);


const launchWorkspacePath = consumeLaunchWorkspacePath();
const AIPanel = lazy(() => import('./components/AIPanel'));

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
    promoteTab, remapPaths, pruneTabs, clearAll,
  } = useTabManager({ fallbackContent: FALLBACK_CONTENT });
  // Debounce word/line count so the status bar doesn't update on every keystroke.
  // For large documents (>100KB), skip the expensive split/filter and estimate from
  // newline count — a 300-page book is ~500KB and split(/\s+/) creates ~80K strings.
  const [wordCount, setWordCount] = useState(() => content.trim().split(/\s+/).filter(Boolean).length);
  const [lineCount, setLineCount] = useState(() => content.split('\n').length);
  useEffect(() => {
    const t = setTimeout(() => {
      const lines = content.split('\n');
      setLineCount(lines.length);
      if (content.length > 100_000) {
        // For large docs: count non-empty lines × ~8 words/line as a fast approximation.
        // Accurate enough for the status bar; avoids creating 80K+ string arrays per tick.
        setWordCount(lines.filter((l) => l.trim().length > 0).length * 8);
      } else {
        setWordCount(content.trim().split(/\s+/).filter(Boolean).length);
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [content]);
  const [fileStat, setFileStat] = useState<string | null>(null);
  const [memoryRefreshKey, setMemoryRefreshKey] = useState(0);
  const activeFileRef = useRef<string | null>(null);
  activeFileRef.current = activeFile;
  const fileRevisionRef = useRef<Map<string, number>>(new Map());
  const workspaceStructureRevisionRef = useRef(0);
  const workspaceChangeSeqRef = useRef(0);
  const workspaceChangeLogRef = useRef<WorkspaceChangeNotice[]>([]);

  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(new Set());
  // Find + Replace bar (Ctrl/Cmd+F)
  // Pending jump: set by project search results; cleared after content loads
  const [pendingJumpText, setPendingJumpText] = useState<string | null>(null);
  const [pendingJumpLine, setPendingJumpLine] = useState<number | null>(null);
  const [lockedFiles, setLockedFiles] = useState<Set<string>>(() => getLockedFiles());
  const prevLockedRef = useRef<Set<string>>(getLockedFiles());
  const bumpFileRevision = useCallback((path: string | null | undefined) => {
    if (!path) return;
    const next = (fileRevisionRef.current.get(path) ?? 0) + 1;
    fileRevisionRef.current.set(path, next);
  }, []);

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
          bumpFileRevision(filePath);
          if (filePath === activeTabIdRef.current) setContent(freshText);
        } catch { /* file may have been deleted — ignore */ }
      }
    });
    return unsub;
  }, [bumpFileRevision]);
  // Stable refs declared early (before hooks that reference them)
  const editorRef = useRef<EditorHandle>(null);
  const editorAreaRef = useRef<HTMLDivElement>(null);
  const aiPanelRef = useRef<AIPanelHandle | null>(null);
  const webPreviewRef = useRef<WebPreviewHandle | null>(null);
  const mountedRef = useRef(true);
  const { zoomEditor, resetEditorZoom } = useEditorZoom({ editorAreaRef, setAppSettings });
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
  const [aiPanelMounted, setAiPanelMounted] = useState(aiOpen);
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

  useEffect(() => {
    if (aiOpen) setAiPanelMounted(true);
  }, [aiOpen]);

  // Voice memos recorded on mobile without transcripts
  const { pendingVoiceMemos, scanVoiceMemos, handleVoiceMemoHandled } = useVoiceMemos(workspace?.path);
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
  const aiOpenRef = useRef(aiOpen);
  aiOpenRef.current = aiOpen;
  const shouldRenderAiPanel = aiPanelMounted || aiOpen;
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
  const { autosaveDelayRef, pendingSaveFileRef, scheduleAutosave, cancelAutosave } = useAutosave({
    savedContentRef,
    setDirtyFiles,
    setSaveError: (err) => setSaveError(err as string | null),
    setWorkspace,
    initialDelay: initSettings.autosaveDelay,
  });

  const pushWorkspaceChangeNotices = useCallback((summaries: string[]) => {
    if (summaries.length === 0) return;
    const now = new Date().toISOString();
    const notices = summaries.map((summary) => ({
      seq: ++workspaceChangeSeqRef.current,
      summary,
      at: now,
    }));
    workspaceChangeLogRef.current = [...workspaceChangeLogRef.current, ...notices].slice(-12);
    workspaceStructureRevisionRef.current += 1;
  }, []);

  const recordWorkspaceStructureDiff = useCallback((
    previousTree: Workspace['fileTree'] | undefined,
    nextTree: Workspace['fileTree'] | undefined,
  ) => {
    const { added, removed } = diffWorkspacePaths(previousTree, nextTree);
    if (added.length === 0 && removed.length === 0) return;
    const summaries = [
      ...added.slice(0, 6).map((path) => `New file: ${path}`),
      ...removed.slice(0, 6).map((path) => `Removed file: ${path}`),
    ];
    if (added.length > 6) summaries.push(`More new files: +${added.length - 6}`);
    if (removed.length > 6) summaries.push(`More removed files: +${removed.length - 6}`);
    pushWorkspaceChangeNotices(summaries);
  }, [pushWorkspaceChangeNotices]);

  const getLiveFileContent = useCallback((relPath: string): string | null => {
    return tabContentsRef.current.get(relPath) ?? null;
  }, [tabContentsRef]);
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
  // Proactive AI nudge
  const isCanvasActive = !!activeFile?.endsWith('.tldr.json');
  const { activeNudge, recordEdit, dismissNudge } = useProactiveNudge(isCanvasActive);
  // Clean up saved-toast timer on unmount
  useEffect(() => () => {
    if (savedToastTimerRef.current) clearTimeout(savedToastTimerRef.current);
  }, []);
  // Save error — set on any failed write, cleared on next successful write
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setAiSelectionContext(null);
  }, [activeFile]);

  // ── Demo Hub publish ───────────────────────────────────────────────────────
  const { demoHubToast, handlePublishDemoHub, clearDemoHubToast } = useDemoHub(workspace);
  const dirtyFilesRef = useRef<Set<string>>(dirtyFiles);
  dirtyFilesRef.current = dirtyFiles;
  const isFileDirty = useCallback((relPath: string): boolean => {
    return dirtyFilesRef.current.has(relPath);
  }, []);
  const getAgentContextSnapshot = useCallback((): AgentContextSnapshot => {
    const currentActiveFile = activeFileRef.current ?? undefined;
    const currentRevision = currentActiveFile
      ? (fileRevisionRef.current.get(currentActiveFile) ?? 0)
      : 0;
    return {
      activeFile: currentActiveFile,
      activeFileRevision: currentRevision,
      activeFileDirty: !!(currentActiveFile && dirtyFilesRef.current.has(currentActiveFile)),
      autosavePending: !!(currentActiveFile && pendingSaveFileRef.current === currentActiveFile),
      workspaceStructureRevision: workspaceStructureRevisionRef.current,
      workspaceChangeSeq: workspaceChangeSeqRef.current,
      recentWorkspaceChanges: workspaceChangeLogRef.current,
      activeFileContent: currentActiveFile ? (tabContentsRef.current.get(currentActiveFile) ?? undefined) : undefined,
    };
  }, [pendingSaveFileRef, tabContentsRef]);
  // Ref passed to Sidebar so ⌘T/⌘N can trigger new-file creation
  const newFileRef = useRef<(() => void) | null>(null);
  // Drag-drop from Finder

  // Derived from active file
  // Memoised so neither fileTypeInfo's object identity nor its dependent
  // effects (useEffect deps on fileTypeInfo?.kind) change between renders
  // when activeFile hasn't changed, preventing unnecessary re-renders of
  // AppEditorArea and Editor which cascade down to CodeMirror.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fileTypeInfo = useMemo(() => activeFile ? getFileTypeInfo(activeFile) : null, [activeFile]);
  // Backlinks — scan only markdown files; disable during focus mode for perf
  const { backlinks, outlinks, loading: backlinksLoading } = useBacklinks(
    activeFile,
    workspace,
    fileTypeInfo?.kind === 'markdown',
  );
  // TypeScript/JS diagnostics — run tsc on the active file when it's a code file
  const tsEnabled = fileTypeInfo?.language === 'typescript' || fileTypeInfo?.language === 'javascript';
  const tsDiagnosticsDirty = activeFile ? dirtyFiles.has(activeFile) : false;
  const tsDiags = useTsDiagnostics(
    content,
    activeFile ?? null,
    workspace?.path ?? null,
    tsEnabled,
    tsDiagnosticsDirty,
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


  // ── OAuth deep-link callback (cafezin://auth/callback#access_token=...) ───
  // Delegated to useAuthSession. onAuthSuccess runs syncSecretsFromCloud and
  // dispatches cafezin:auth-updated so WorkspacePicker can refresh its state.
  useAuthSession({
    onAuthSuccess: async () => {
      await syncSecretsFromCloud();
      window.dispatchEvent(new CustomEvent('cafezin:auth-updated'));
    },
  });

  // Log one app_session event per day (anonymous device_id, + user_id if logged in).
  useAppSession();

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
  // ── Keep a stable ref to workspace so watcher callback always sees latest ───
  const workspaceRef = useRef<typeof workspace>(workspace);
  useEffect(() => { workspaceRef.current = workspace; }, [workspace]);
  const refreshMemoryPrompt = useCallback(() => {
    setMemoryRefreshKey((prev) => prev + 1);
  }, []);

  const markWorkspaceMemoryForChangedPaths = useCallback(async (
    workspacePath: string,
    changedPaths?: string[],
  ) => {
    if (!workspacePath || !changedPaths || changedPaths.length === 0) return;
    try {
      const marked = await markWorkspaceMemoryEntriesStale(workspacePath, changedPaths);
      if (marked > 0) refreshMemoryPrompt();
    } catch (err) {
      console.error('Failed to update memory freshness:', err);
    }
  }, [refreshMemoryPrompt]);

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
      bumpFileRevision(activeTabId);
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
            bumpFileRevision(activeTabId);
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
    onZoomIn:    () => zoomEditor(1),
    onZoomOut:   () => zoomEditor(-1),
    onZoomReset: resetEditorZoom,
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
  // Use a ref so handleSearchFileOpen stays stable (empty deps, used by React.memo children)
  // while always calling the latest handleOpenFile (which closes over the current workspace).
  const handleOpenFileRef = useRef(handleOpenFile);
  useEffect(() => { handleOpenFileRef.current = handleOpenFile; });

  const handleSearchFileOpen = useCallback(async (relPath: string, lineNo?: number, matchText?: string) => {
    await handleOpenFileRef.current(relPath);
    if (lineNo != null) setPendingJumpLine(lineNo);
    else if (matchText) setPendingJumpText(matchText);
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

  // ── Workspace file tree refresh ────────────────────────────────────────────
  // Rebuilds files + fileTree and merges into workspace state.
  // Used after any operation that creates, deletes, or moves a file.
  const refreshWorkspace = useCallback(async (
    ws: Workspace,
    nextState?: { files: string[]; fileTree: Workspace['fileTree'] },
    changedPaths?: string[],
  ) => {
    const fileTree = nextState?.fileTree ?? await refreshFileTree(ws);
    const files = nextState?.files ?? flatMdFiles(fileTree);
    const previousTree = workspaceRef.current?.path === ws.path ? workspaceRef.current.fileTree : undefined;
    const previousFiles = workspaceRef.current?.path === ws.path ? workspaceRef.current.files : undefined;
    const treeChanged = previousTree ? !sameFileTree(previousTree, fileTree) : true;
    const filesChanged = previousFiles ? !sameStringArray(previousFiles, files) : true;

    if (treeChanged) {
      recordWorkspaceStructureDiff(previousTree, fileTree);
    }

    if (treeChanged || filesChanged) {
      setWorkspace((prev) => {
        if (!prev || prev.path !== ws.path) return prev;
        return { ...prev, files, fileTree };
      });
    }

    void markWorkspaceMemoryForChangedPaths(ws.path, changedPaths);
  }, [markWorkspaceMemoryForChangedPaths, recordWorkspaceStructureDiff]);

  const handleRefreshWorkspaceFiles = useCallback(async () => {
    if (!workspace) return;
    try {
      await refreshWorkspace(workspace);
    } catch (err) {
      console.error('Failed to refresh workspace:', err);
      setSaveError(`Could not refresh workspace: ${(err as Error)?.message ?? String(err)}`);
    }
  }, [refreshWorkspace, workspace]);

  const handlePathRenamed = useCallback((fromPath: string, toPath: string) => {
    if (!fromPath || !toPath || fromPath === toPath) return;
    remapPaths(fromPath, toPath);
    setDirtyFiles((prev) => remapPathSet(prev, fromPath, toPath));
    setAiMarks((prev) => prev.map((mark) => {
      if (mark.fileRelPath === fromPath) return { ...mark, fileRelPath: toPath };
      if (mark.fileRelPath.startsWith(`${fromPath}/`)) {
        return { ...mark, fileRelPath: `${toPath}${mark.fileRelPath.slice(fromPath.length)}` };
      }
      return mark;
    }));
  }, [remapPaths, setAiMarks]);

  useEffect(() => {
    if (!workspace) return;
    const existingPaths = collectWorkspaceFilePaths(workspace.fileTree);
    pruneTabs(existingPaths);
    setDirtyFiles((prev) => {
      const next = new Set<string>();
      for (const path of prev) {
        if (existingPaths.has(path)) next.add(path);
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  // ── PDF export ─────────────────────────────────────────
  const {
    pandocBusy, pandocError, setPandocError, pandocStatus,
    exportLock, exportLockState, setExportLockState,
    handleExportPDF, handleCancelExportPDF,
    handleOpenFileForExport, handleRestoreAfterExport, handleExportConfigChange,
  } = useExport({
    workspace, activeFile, content,
    canvasEditorRef, activeTabId, mountedRef,
    switchToTab, handleOpenFileRef, refreshWorkspace, setWorkspace,
  });

  // ── Workspace session lifecycle ──────────────────────────────────────────
  const {
    handleFileDeleted,
    handleSwitchWorkspace,
    handleOpenNewWindow,
    handleWorkspaceLoaded,
  } = useWorkspaceSession({
    tabs, handleCloseTab,
    dirtyFilesRef, isAIStreamingRef,
    cancelAutosave, clearAll,
    setMemoryRefreshKey,
    fileRevisionRef, workspaceStructureRevisionRef, workspaceChangeSeqRef, workspaceChangeLogRef,
    setWorkspace, setDirtyFiles, setAiMarks, setIsAIStreaming, setHomeVisible,
    setSaveError,
    loadMarksForWorkspace,
    setMobilePendingTasks, setShowMobilePending,
    tabContentsRef, tabViewModeRef, savedContentRef,
    bumpFileRevision,
    setTabs, setPreviewTabId, setActiveTabId: setActiveTabId as React.Dispatch<React.SetStateAction<string>>, setContent, setViewMode,
  });

  // ── Tauri native menu listeners ─────────────────────────────────────────
  useTauriMenuListeners({
    onUpdate: handleUpdate,
    openSettings,
    onNewWindow: handleOpenNewWindow,
    onSwitchWorkspace: handleSwitchWorkspace,
    setSidebarOpen,
    newFileRef,
    onExportPDF: handleExportPDF,
    setExportModalOpen,
    setImgSearchOpen,
    setAiOpen,
    setViewMode,
    tabViewModeRef,
    onFormat: handleFormat,
    fileTypeKind: fileTypeInfo?.kind,
    viewMode,
    activeTabId,
  });

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

  // ── Drag-and-drop from Finder ─────────────────────────────────────────────
  const { dragOver, dragFiles } = useDroppedFiles({
    workspace,
    workspaceRef,
    activeTabIdRef,
    aiPanelRef,
    setAiOpen,
    refreshWorkspace,
    handleOpenFile,
  });

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
      bumpFileRevision(filename);
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
    if (isSameWorkspace) {
      recordWorkspaceStructureDiff(workspaceRef.current?.fileTree, ws.fileTree);
    }
    setWorkspace(ws);
    // On workspace switch, close all tabs and go to home
    if (!isSameWorkspace) {
      clearAll();
    }
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
      const previousContent = activeFile ? tabContentsRef.current.get(activeFile) : null;
      // Canvas files are self-managed by tldraw — never feed changed JSON back
      // into React state or tldraw will see the `snapshot` prop change and reset.
      if (!activeFile?.endsWith('.tldr.json')) setContent(newContent);
      // Keep per-tab content ref in sync so switching away/back is lossless
      if (activeFile) tabContentsRef.current.set(activeFile, newContent);
      if (activeFile && previousContent !== newContent) bumpFileRevision(activeFile);
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
    [workspace, activeFile, scheduleAutosave, recordEdit, bumpFileRevision]
  );

  // ── App settings persistence ─────────────────────────────────
  function handleAppSettingsChange(settings: AppSettings) {
    setAppSettings(settings);
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
  }

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

  const handleFileWritten = useCallback(async (path: string, newContent?: string) => {
    if (!workspace) return;
    // Immediately sync the live in-memory buffer so subsequent agent tool reads
    // (getLiveFileContent) return the fresh content, not the pre-edit version.
    // Without this, a second patch in the same agent turn reads stale tabContentsRef
    // and silently overwrites the first edit.
    if (newContent != null && path) {
      tabContentsRef.current.set(path, newContent);
      savedContentRef.current.set(path, newContent);
      if (activeFileRef.current === path) {
        setContent(newContent);
      }
    }
    try {
      await refreshWorkspace(workspace, undefined, path ? [path] : undefined);
      if (path === '.cafezin/memory.md') {
        refreshMemoryPrompt();
      }
    } catch (err) {
      console.error('Failed to refresh workspace after file write:', err);
    }
  }, [workspace, refreshWorkspace, refreshMemoryPrompt, tabContentsRef, savedContentRef, activeFileRef, setContent]);

  const { aiDocumentContext } = useAIDocumentContext({
    activeFile,
    fileTypeKind: fileTypeInfo?.kind,
    canvasEditorRef,
    content,
  });
  const title = useMemo(
    () => activeFile
      ? (content.slice(0, 500).match(/^#\s+(.+)$/m)?.[1] ?? activeFile)
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
      bumpFileRevision(activeFile);
      setContent(fresh);
    } catch {
      // Keep whatever is on disk if reload fails.
    }
    setCanvasResetKey((value) => value + 1);
  }, [activeFile, bumpFileRevision, savedContentRef, setContent, tabContentsRef, workspace]);

  // ── Stable callbacks for memoised children (Sidebar, AIPanel, AppOverlays) ─
  // These are defined with useCallback so that React.memo on those components
  // actually prevents re-renders on every keystroke (content change in App).

  // Sidebar callbacks
  // Keep a ref to activeFileMarks so onOpenAIReview doesn't need it in deps.
  const activeFileMarksRef = useRef(activeFileMarks);
  activeFileMarksRef.current = activeFileMarks;

  const handleSidebarOpenAIReview = useCallback(() => {
    setAiHighlight(true);
    setAiNavIndex(0);
    const marks = activeFileMarksRef.current;
    if (marks.length > 0) {
      const m = marks[0];
      if (m.canvasShapeIds?.length && canvasEditorRef.current) {
        const bounds = canvasEditorRef.current.getShapePageBounds(m.canvasShapeIds[0] as TLShapeId);
        if (bounds) canvasEditorRef.current.zoomToBounds(bounds, { animation: { duration: 300 }, inset: 60 });
      } else {
        setTimeout(() => editorRef.current?.jumpToText({ text: m.text, revert: m.revert }), 120);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // refs handle mutable values — no deps needed

  const handleOpenTerminalAt = useCallback((relDir: string) => {
    const absDir = relDir ? `${workspace?.path}/${relDir}` : workspace?.path ?? '';
    setTerminalOpen(true);
    setTerminalRequestCd(absDir + '|' + Date.now());
  }, [workspace?.path]);

  const handleRunButtonCommand = useCallback((command: string) => {
    setTerminalOpen(true);
    setTerminalRequestRun(command + '|' + Date.now());
  }, []);

  const handleExpandSidebar = useCallback(() => {
    if (sidebarWidthRef.current < 80) setSidebarWidth(220);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // sidebarWidthRef is a ref — stable

  const handleExportOpen = useCallback(() => setExportModalOpen(true), []);

  // getActiveHtml reads content via tabContentsRef at call time — no content dep.
  const getActiveHtml = useCallback((): { html: string; absPath: string } | null => {
    if (!activeFile || !fileTypeInfo || fileTypeInfo.kind !== 'code' || !fileTypeInfo.supportsPreview) return null;
    const html = tabContentsRef.current.get(activeFile) ?? '';
    return { html, absPath: `${workspace?.path}/${activeFile}` };
  }, [activeFile, fileTypeInfo, workspace?.path]); // tabContentsRef is a ref — stable

  // AppOverlays callbacks
  const handleCloseUpdateModal = useCallback(() => setShowUpdateModal(false), []);
  const handleCloseUpdateReleaseModal = useCallback(() => setShowUpdateReleaseModal(false), []);
  const handleOpenUpdateReleaseModal = useCallback(() => setShowUpdateReleaseModal(true), []);
  const handleCloseMobilePending = useCallback(() => setShowMobilePending(false), []);
  const handleDeleteMobilePendingTask = useCallback((id: string) =>
    setMobilePendingTasks((prev) => prev.filter((task) => task.id !== id)), []);
  const handleCloseSettings = useCallback(() => setShowSettings(false), []);
  const handleCloseExportModal = useCallback(() => setExportModalOpen(false), []);
  const handleOpenAIFromExport = useCallback((prompt: string) => {
    setExportModalOpen(false);
    setAiInitialPrompt(prompt);
    setAiOpen(true);
  }, []);
  const handleCloseImageSearch = useCallback(() => setImgSearchOpen(false), []);
  const handleAskNudge = useCallback((prompt: string) => {
    dismissNudge();
    setAiInitialPrompt(prompt);
    setAiOpen(true);
  }, [dismissNudge]);

  // AppHeader callbacks
  const handleToggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const handleGoHome = useCallback(() => switchToTab(null), [switchToTab]);
  const handleClearDemoHubToast = useCallback(() => clearDemoHubToast(), [clearDemoHubToast]);
  const handleClearPandocError = useCallback(() => setPandocError(null), []);
  const handleToggleAi = useCallback(() => setAiOpen((v) => !v), []);
  const handleCloseAi   = useCallback(() => setAiOpen(false), []);

  // ── AppEditorArea stable callbacks (broken out of JSX to enable React.memo) ─
  const handleEditorAreaOpenAIReview = useCallback(() => {
    setAiHighlight(true);
    setAiNavIndex(0);
  }, []);
  const handleActivateSync = useCallback(() => openSettings('sync'), [openSettings]);
  const handleCanvasEditorReady = useCallback((editor: TldrawEditor | null) => {
    canvasEditorRef.current = editor;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // canvasEditorRef is a ref — stable

  // activeFile captured via ref so this callback is stable across file switches.
  const activeFileRef2 = useRef(activeFile);
  activeFileRef2.current = activeFile;
  const handleEditorFileSaved = useCallback(() => {
    handleFileWritten(activeFileRef2.current ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // handleFileWritten is stable (useCallback with stable deps)

  // AIPanel style — memoised so React.memo on AIPanel isn't defeated by
  // a new style object on every parent render.
  const aiPanelStyle = useMemo(
    () => (aiOpen ? { width: aiPanelWidth } : undefined),
    [aiOpen, aiPanelWidth],
  );

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
        onToggleSidebar={handleToggleSidebar}
        activeFile={activeFile}
        title={title}
        workspace={workspace}
        onGoHome={handleGoHome}
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
        onClearDemoHubToast={handleClearDemoHubToast}
        pandocError={pandocError}
        onClearPandocError={handleClearPandocError}
        isDev={import.meta.env.DEV}
        aiOpen={aiOpen}
        onToggleAi={handleToggleAi}
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
              onOpenAIReview={handleSidebarOpenAIReview}
              onAIPrev={handleAINavPrev}
              onAINext={handleAINavNext}
              onFileDeleted={handleFileDeleted}
              onPathRenamed={handlePathRenamed}
              onSearchFileOpen={handleSearchFileOpen}
              onRefreshFiles={handleRefreshWorkspaceFiles}
              lockedFiles={lockedFiles}
              newFileRef={newFileRef}
              onOpenTerminalAt={handleOpenTerminalAt}
              onRunButtonCommand={handleRunButtonCommand}
              onPublishDemoHub={handlePublishDemoHub}
              onExportOpen={handleExportOpen}
              onExpandSidebar={handleExpandSidebar}
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
          onOpenAIReview={handleEditorAreaOpenAIReview}
          onSwitchWorkspace={handleSwitchWorkspace}
          onActivateSync={handleActivateSync}
          onSetHomeVisible={setHomeVisible}
          onSetFileStat={setFileStat}
          onRecoverCanvas={handleRecoverCanvas}
          onCanvasEditorReady={handleCanvasEditorReady}
          onCanvasPresentModeChange={handleCanvasPresentModeChange}
          onFileSaved={handleEditorFileSaved}
          onFormat={handleFormat}
          onImagePaste={handleEditorImagePaste}

        />



        {/* AI panel resize handle — only visible when open */}
        {aiOpen && <div className="resize-divider" onMouseDown={startAiDrag} />}
        {shouldRenderAiPanel && (
          <Suspense fallback={null}>
            <AIPanel
              ref={aiPanelRef}
              isOpen={aiOpen}
              onClose={handleCloseAi}
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
              memoryRefreshKey={memoryRefreshKey}
              canvasEditorRef={canvasEditorRef}
              onFileWritten={handleFileWritten}
              onPathRenamed={handlePathRenamed}
              getLiveFileContent={getLiveFileContent}
              isFileDirty={isFileDirty}
              getAgentContextSnapshot={getAgentContextSnapshot}
              onMarkRecorded={handleMarkRecorded}
              onCanvasMarkRecorded={handleCanvasMarkRecorded}
              activeFile={activeFile ?? undefined}
              rescanFramesRef={rescanFramesRef}
              onStreamingChange={setIsAIStreaming}
              style={aiPanelStyle}
              screenshotTargetRef={editorAreaRef}
              webPreviewRef={webPreviewRef}
              getActiveHtml={getActiveHtml}
              workspaceExportConfig={workspace.config.exportConfig}
              onExportConfigChange={handleExportConfigChange}
              workspaceConfig={workspace.config}
              appLocale={appSettings.locale}
              onWorkspaceConfigChange={handleWorkspaceConfigChange}
              onOpenFileReference={handleSearchFileOpen}
              onOpenSettings={(tab) => openSettings(tab as Parameters<typeof openSettings>[0])}
              selectionContext={aiSelectionContext}
              pendingVoiceMemos={pendingVoiceMemos}
              onVoiceMemoHandled={handleVoiceMemoHandled}
            />
          </Suspense>
        )}

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
        onCloseUpdateModal={handleCloseUpdateModal}
        showUpdateReleaseModal={showUpdateReleaseModal}
        onCloseUpdateReleaseModal={handleCloseUpdateReleaseModal}
        forceUpdateOpen={forceUpdateOpen}
        forceUpdateRequired={forceUpdateRequired}
        forceUpdateChannel={forceUpdateChannel}
        onUpdate={handleUpdate}
        showMobilePending={showMobilePending}
        mobilePendingTasks={mobilePendingTasks}
        onExecutePendingTask={handleExecutePendingTask}
        onCloseMobilePending={handleCloseMobilePending}
        onDeleteMobilePendingTask={handleDeleteMobilePendingTask}
        showSettings={showSettings}
        appSettings={appSettings}
        onAppSettingsChange={handleAppSettingsChange}
        onWorkspaceChange={setWorkspace}
        onOpenHelp={handleOpenDesktopHelp}
        onContactUs={handleContactUs}
        onCloseSettings={handleCloseSettings}
        settingsInitialTab={settingsInitialTab}
        showDesktopOnboarding={showDesktopOnboarding}
        desktopOnboardingSeen={desktopOnboardingSeen}
        onCloseDesktopOnboarding={handleCloseDesktopOnboarding}
        exportModalOpen={exportModalOpen}
        canvasEditorRef={canvasEditorRef}
        activeFile={activeFile}
        onOpenFileForExport={handleOpenFileForExport}
        onRestoreAfterExport={handleRestoreAfterExport}
        onCloseExportModal={handleCloseExportModal}
        onOpenAIFromExport={handleOpenAIFromExport}
        onExportLockStateChange={setExportLockState}
        imgSearchOpen={imgSearchOpen}
        onCloseImageSearch={handleCloseImageSearch}
        copilotOverlayActive={copilotOverlayActive}
        activeNudge={activeNudge}
        onAskNudge={handleAskNudge}
        onDismissNudge={dismissNudge}
        updateToastVersion={updateToastVersion}
        setUpdateToastVersion={setUpdateToastVersion}
        onOpenUpdateReleaseModal={handleOpenUpdateReleaseModal}
      />

    </div>
  );
}
