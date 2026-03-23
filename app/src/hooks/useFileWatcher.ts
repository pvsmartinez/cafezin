/**
 * useFileWatcher
 *
 * Lightweight workspace refresh behavior for desktop:
 * instead of continuously polling or watching the filesystem, mark the
 * workspace as potentially stale when Cafezin loses focus or becomes hidden,
 * then refresh once when it becomes active again.
 */
import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { Workspace } from '../types';
import { readFile, refreshWorkspaceFiles } from '../services/workspace';
import { getFileTypeInfo } from '../utils/fileType';

const RELOAD_SKIP_KINDS = new Set(['pdf', 'video', 'audio', 'image', 'canvas']);

export interface UseFileWatcherOptions {
  watchPath: string | null | undefined;
  workspaceRef: MutableRefObject<Workspace | null>;
  tabsRef: MutableRefObject<string[]>;
  dirtyFilesRef: MutableRefObject<Set<string>>;
  activeTabIdRef: MutableRefObject<string | null>;
  tabContentsRef: MutableRefObject<Map<string, string>>;
  savedContentRef: MutableRefObject<Map<string, string>>;
  onRefresh: (
    ws: Workspace,
    nextState?: { files: string[]; fileTree: Workspace['fileTree'] },
    changedPaths?: string[],
  ) => Promise<void>;
  setContent: (content: string) => void;
}

export function useFileWatcher({
  watchPath,
  workspaceRef,
  tabsRef,
  dirtyFilesRef,
  activeTabIdRef,
  tabContentsRef,
  savedContentRef,
  onRefresh,
  setContent,
}: UseFileWatcherOptions): void {
  useEffect(() => {
    if (!watchPath) return;

    let staleSinceBackground = false;
    let refreshRunning = false;
    let refreshQueued = false;
    let cancelled = false;

    const reloadOpenTabs = async () => {
      const currentTabs = tabsRef.current;
      const currentDirty = dirtyFilesRef.current;

      for (const tabPath of currentTabs) {
        if (currentDirty.has(tabPath)) continue;
        const tabKind = getFileTypeInfo(tabPath).kind;
        if (RELOAD_SKIP_KINDS.has(tabKind)) continue;

        try {
          const ws = workspaceRef.current;
          if (!ws) break;
          const freshText = await readFile(ws, tabPath);
          const savedText = savedContentRef.current.get(tabPath);
          if (freshText === savedText) continue;
          savedContentRef.current.set(tabPath, freshText);
          tabContentsRef.current.set(tabPath, freshText);
          if (tabPath === activeTabIdRef.current) setContent(freshText);
        } catch {
          // File may have been removed externally; the workspace refresh already handles that.
        }
      }
    };

    const runRefresh = async () => {
      if (refreshRunning) {
        refreshQueued = true;
        return;
      }

      const ws = workspaceRef.current;
      if (!ws || ws.path !== watchPath) return;

      refreshRunning = true;
      try {
        const nextState = await refreshWorkspaceFiles(ws);
        if (cancelled) return;
        await onRefresh(ws, nextState);
        await reloadOpenTabs();
      } catch {
        // Workspace may have been closed while the refresh was running.
      } finally {
        refreshRunning = false;
        if (refreshQueued && !cancelled) {
          refreshQueued = false;
          void runRefresh();
        }
      }
    };

    const requestRefreshIfNeeded = () => {
      if (document.hidden || !staleSinceBackground) return;
      staleSinceBackground = false;
      void runRefresh();
    };

    const markPossiblyStale = () => {
      staleSinceBackground = true;
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        markPossiblyStale();
        return;
      }
      requestRefreshIfNeeded();
    };

    window.addEventListener('blur', markPossiblyStale);
    window.addEventListener('focus', requestRefreshIfNeeded);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener('blur', markPossiblyStale);
      window.removeEventListener('focus', requestRefreshIfNeeded);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [watchPath, activeTabIdRef, dirtyFilesRef, onRefresh, savedContentRef, setContent, tabContentsRef, tabsRef, workspaceRef]);
}
