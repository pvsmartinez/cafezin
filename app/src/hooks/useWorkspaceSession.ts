import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  loadPendingTasks,
  type MobilePendingTask,
} from '../services/mobilePendingTasks';
import { buildWorkspaceIndex, readFile } from '../services/workspace';
import { loadWorkspaceSession } from '../services/workspaceSession';
import { openWorkspaceWindow } from '../services/windowing';
import { getFileTypeInfo } from '../utils/fileType';
import type { AIEditMark, Workspace, WorkspaceChangeNotice } from '../types';

interface UseWorkspaceSessionParams {
  // handleFileDeleted
  tabs: string[];
  handleCloseTab: (filePath: string) => void;

  // handleSwitchWorkspace
  dirtyFilesRef: MutableRefObject<Set<string>>;
  isAIStreamingRef: MutableRefObject<boolean>;
  cancelAutosave: () => void;
  clearAll: () => void;
  setMemoryRefreshKey: Dispatch<SetStateAction<number>>;
  fileRevisionRef: MutableRefObject<Map<string, number>>;
  workspaceStructureRevisionRef: MutableRefObject<number>;
  workspaceChangeSeqRef: MutableRefObject<number>;
  workspaceChangeLogRef: MutableRefObject<WorkspaceChangeNotice[]>;
  setWorkspace: Dispatch<SetStateAction<Workspace | null>>;
  setDirtyFiles: Dispatch<SetStateAction<Set<string>>>;
  setAiMarks: Dispatch<SetStateAction<AIEditMark[]>>;
  setIsAIStreaming: Dispatch<SetStateAction<boolean>>;
  setHomeVisible: Dispatch<SetStateAction<boolean>>;
  setSaveError: (err: string | null) => void;

  // handleWorkspaceLoaded
  loadMarksForWorkspace: (ws: Workspace) => void;
  setMobilePendingTasks: Dispatch<SetStateAction<MobilePendingTask[]>>;
  setShowMobilePending: Dispatch<SetStateAction<boolean>>;
  tabContentsRef: MutableRefObject<Map<string, string>>;
  tabViewModeRef: MutableRefObject<Map<string, 'edit' | 'preview'>>;
  savedContentRef: MutableRefObject<Map<string, string>>;
  bumpFileRevision: (path: string) => void;
  setTabs: Dispatch<SetStateAction<string[]>>;
  setPreviewTabId: Dispatch<SetStateAction<string | null>>;
  setActiveTabId: Dispatch<SetStateAction<string>>;
  setContent: Dispatch<SetStateAction<string>>;
  setViewMode: Dispatch<SetStateAction<'edit' | 'preview'>>;
}

export function useWorkspaceSession({
  tabs,
  handleCloseTab,
  dirtyFilesRef,
  isAIStreamingRef,
  cancelAutosave,
  clearAll,
  setMemoryRefreshKey,
  fileRevisionRef,
  workspaceStructureRevisionRef,
  workspaceChangeSeqRef,
  workspaceChangeLogRef,
  setWorkspace,
  setDirtyFiles,
  setAiMarks,
  setIsAIStreaming,
  setHomeVisible,
  setSaveError,
  loadMarksForWorkspace,
  setMobilePendingTasks,
  setShowMobilePending,
  tabContentsRef,
  tabViewModeRef,
  savedContentRef,
  bumpFileRevision,
  setTabs,
  setPreviewTabId,
  setActiveTabId,
  setContent,
  setViewMode,
}: UseWorkspaceSessionParams) {
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
    cancelAutosave();
    clearAll();
    setMemoryRefreshKey(0);
    fileRevisionRef.current.clear();
    workspaceStructureRevisionRef.current = 0;
    workspaceChangeSeqRef.current = 0;
    workspaceChangeLogRef.current = [];
    setWorkspace(null);
    setDirtyFiles(new Set());
    setAiMarks([]);
    setIsAIStreaming(false);
    setHomeVisible(true);
  }

  // ── Open new window ─────────────────────────────────────
  async function handleOpenNewWindow() {
    try {
      await openWorkspaceWindow();
    } catch (err) {
      setSaveError(`Could not open a new window: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  // ── Workspace loaded ─────────────────────────────────────────
  async function handleWorkspaceLoaded(ws: Workspace) {
    clearAll();
    fileRevisionRef.current.clear();
    workspaceStructureRevisionRef.current = 0;
    workspaceChangeSeqRef.current = 0;
    workspaceChangeLogRef.current = [];
    setWorkspace(ws);
    setHomeVisible(true);
    loadMarksForWorkspace(ws);

    // Trigger async index rebuild in the background.
    buildWorkspaceIndex(ws.path, ws.fileTree, ws.workspaceIndex ?? null)
      .then((index) => {
        setWorkspace((prev) =>
          prev?.path === ws.path ? { ...prev, workspaceIndex: index } : prev,
        );
      })
      .catch(() => { /* non-fatal — agent falls back to live outline_workspace */ });

    // Check for pending tasks queued from mobile.
    const pending = await loadPendingTasks(ws.path);
    if (pending.length > 0) {
      setMobilePendingTasks(pending);
      setShowMobilePending(true);
    }

    // Restore last session (open tabs + active file) — read all files in parallel.
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
            bumpFileRevision(filePath);
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

  return { handleFileDeleted, handleSwitchWorkspace, handleOpenNewWindow, handleWorkspaceLoaded };
}
