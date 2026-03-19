/**
 * useFileWatcher
 *
 * Sets up a Tauri fs.watch() on the workspace root path and auto-reloads
 * open text tabs when their on-disk content changes (provided the tab has
 * no unsaved user edits).
 *
 * Re-attaches the watcher only when `watchPath` changes.  The caller must
 * pass stable refs (created once with useRef) so the effect dependency array
 * stays minimal.
 */
import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { watch as fsWatch } from '@tauri-apps/plugin-fs';
import type { WatchEvent } from '@tauri-apps/plugin-fs';
import type { Workspace } from '../types';
import { readFile } from '../services/workspace';
import { refreshWorkspaceFiles } from '../services/workspace';
import { getFileTypeInfo } from '../utils/fileType';

const RELOAD_SKIP_KINDS = new Set(['pdf', 'video', 'audio', 'image', 'canvas']);
const WATCH_DEBOUNCE_MS = 600;
const WATCH_POLL_MS = 4000;

/**
 * Path segments that are internal to the app — changes inside these dirs
 * should NOT rebuild the file tree or reload tabs.
 * Covers the current '.cafezin/' + '.git/' dirs and a few known legacy files.
 */
const INTERNAL_TOP_LEVEL_DIRS = new Set(['.cafezin', '.git']);
const INTERNAL_LEGACY_FILES = new Set([
  'cafezin/ai-marks.json',
  'cafezin/copilot-log.jsonl',
  'cafezin/mobile-pending.json',
]);

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function toRelativeWatchPath(path: string, watchPath: string): string | null {
  const normalizedPath = normalizePath(path);
  const normalizedWatchPath = normalizePath(watchPath);
  if (normalizedPath === normalizedWatchPath) return '';
  if (!normalizedPath.startsWith(`${normalizedWatchPath}/`)) return null;
  return normalizedPath.slice(normalizedWatchPath.length + 1);
}

export function isInternalWatchPath(path: string, watchPath: string): boolean {
  const relPath = toRelativeWatchPath(path, watchPath);
  if (relPath === null) return false;
  if (!relPath) return false;

  const [topLevel] = relPath.split('/');
  if (topLevel && INTERNAL_TOP_LEVEL_DIRS.has(topLevel)) return true;
  return INTERNAL_LEGACY_FILES.has(relPath);
}

function buildTreeSignature(nodes: Workspace['fileTree']): string {
  return nodes.flatMap((node) => {
    const marker = `${node.path}:${node.isDirectory ? 'd' : 'f'}`;
    return node.isDirectory && node.children
      ? [marker, buildTreeSignature(node.children)]
      : [marker];
  }).join('|');
}

export interface UseFileWatcherOptions {
  /** Absolute workspace path; pass null/undefined to disable the watcher. */
  watchPath: string | null | undefined;
  /** Always-fresh ref to the current workspace object. */
  workspaceRef:    MutableRefObject<Workspace | null>;
  /** Always-fresh ref to the list of currently-open tab paths. */
  tabsRef:         MutableRefObject<string[]>;
  /** Always-fresh ref to the set of files with unsaved edits. */
  dirtyFilesRef:   MutableRefObject<Set<string>>;
  /** Always-fresh ref to the currently-active tab path. */
  activeTabIdRef:  MutableRefObject<string | null>;
  /** Always-fresh ref to the per-tab content map. */
  tabContentsRef:  MutableRefObject<Map<string, string>>;
  /** Always-fresh ref to the last-saved content map. */
  savedContentRef: MutableRefObject<Map<string, string>>;
  /** Callback to refresh the sidebar file tree after an external change. */
  onRefresh: (
    ws: Workspace,
    nextState?: { files: string[]; fileTree: Workspace['fileTree'] },
  ) => Promise<void>;
  /** Callback to push new content to the editor for the active tab. */
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

    let unwatch: (() => void | Promise<void>) | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    // Guard against the race where the cleanup runs *before* fsWatch resolves.
    // Without this flag the resolved unlistener would never be called, leaving a
    // stale watcher running until the next workspace switch.
    let cancelled = false;

    const reloadOpenTabs = async () => {
      const currentTabs  = tabsRef.current;
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
          /* file may be deleted — ignore */
        }
      }
    };

    const scheduleRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const ws = workspaceRef.current;
        if (!ws || ws.path !== watchPath) return;
        try {
          await onRefresh(ws);
        } catch {
          /* workspace may have been closed — ignore */
        }
        await reloadOpenTabs();
      }, WATCH_DEBOUNCE_MS);
    };

    fsWatch(
      watchPath,
      (event: WatchEvent) => {
        // Ignore events where ALL changed paths are inside internal dirs
        // (.cafezin/, .git/, known legacy files) — those are app-internal writes
        // (e.g. copilot-log.jsonl, ai-marks.json, git object DB) and do not
        // need to trigger a file-tree rebuild or tab reload.
        const hasUserChange = event.paths.some(
          (path) => !isInternalWatchPath(path, watchPath),
        );
        if (!hasUserChange) return;
        scheduleRefresh();
      },
      { recursive: true },
    )
      .then((fn) => {
        if (cancelled) {
          // Cleanup already ran — stop the watcher immediately rather than leaking it.
          try { fn(); } catch { /* ignore */ }
          return;
        }
        unwatch = fn;
      })
      .catch(() => { /* watch not available — ignore */ });

    // Fallback for platforms / workspace locations where native watch can be
    // flaky. We only rebuild when the tree signature actually changes, so the
    // sidebar stays current without re-rendering every interval tick.
    pollTimer = setInterval(() => {
      if (document.hidden) return;
      const ws = workspaceRef.current;
      if (!ws || ws.path !== watchPath) return;
      void (async () => {
        try {
          const nextState = await refreshWorkspaceFiles(ws);
          const currentSignature = buildTreeSignature(ws.fileTree);
          const nextSignature = buildTreeSignature(nextState.fileTree);
          if (currentSignature === nextSignature) return;
          await onRefresh(ws, nextState);
        } catch {
          /* workspace may have been closed — ignore */
        }
      })();
    }, WATCH_POLL_MS);

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (pollTimer) clearInterval(pollTimer);
      if (unwatch) { try { unwatch(); } catch { /* ignore */ } }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchPath]);
}
