import { useState, useRef, useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { copyFile } from '../services/fs';
import { getFileTypeInfo } from '../utils/fileType';
import type { Workspace } from '../types';
import type { AIPanelHandle } from '../components/AIPanel';

/** True when running inside a Tauri WebView. */
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

interface UseDroppedFilesOptions {
  workspace: Workspace | null;
  workspaceRef: MutableRefObject<Workspace | null>;
  activeTabIdRef: MutableRefObject<string | null>;
  aiPanelRef: MutableRefObject<AIPanelHandle | null>;
  setAiOpen: React.Dispatch<React.SetStateAction<boolean>>;
  refreshWorkspace: (ws: Workspace) => Promise<void>;
  /** handleOpenFile is a hoisted function — safe to pass as a param. */
  handleOpenFile: (filename: string) => Promise<void>;
}

export function useDroppedFiles({
  workspace,
  workspaceRef,
  activeTabIdRef,
  aiPanelRef,
  setAiOpen,
  refreshWorkspace,
  handleOpenFile,
}: UseDroppedFilesOptions) {
  const [dragOver, setDragOver] = useState(false);
  const [dragFiles, setDragFiles] = useState<string[]>([]);
  const dragOverRef = useRef(false);
  const dragFilesRef = useRef<string[]>([]);

  async function handleDroppedFiles(paths: string[]) {
    const ws = workspaceRef.current;
    if (!ws) return;
    const wsRoot = ws.path;
    const opened: string[] = [];

    const activeKind = activeTabIdRef.current
      ? getFileTypeInfo(activeTabIdRef.current).kind
      : null;
    const canvasIsActive = activeKind === 'canvas';

    for (const absPath of paths) {
      const name = absPath.split('/').pop();
      if (!name) continue;

      const dropKind = getFileTypeInfo(name).kind;
      if (canvasIsActive && (dropKind === 'image' || dropKind === 'video' || dropKind === 'audio')) {
        continue;
      }

      let relPath: string;
      if (absPath.startsWith(wsRoot + '/')) {
        relPath = absPath.slice(wsRoot.length + 1);
      } else {
        relPath = name;
        const dest = `${wsRoot}/${name}`;
        try {
          await copyFile(absPath, dest);
        } catch (err) {
          console.error('Failed to copy dropped file:', err);
          continue;
        }
        await refreshWorkspace(ws);
      }

      opened.push(relPath);
    }

    for (const relPath of opened) {
      await handleOpenFile(relPath);
    }
  }

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;

    const samePaths = (left: string[], right: string[]) =>
      left.length === right.length && left.every((p, i) => p === right[i]);

    const updateDragFiles = (nextPaths: string[]) => {
      if (samePaths(dragFilesRef.current, nextPaths)) return;
      dragFilesRef.current = nextPaths;
      setDragFiles(nextPaths);
    };

    const updateDragOver = (nextValue: boolean) => {
      if (dragOverRef.current === nextValue) return;
      dragOverRef.current = nextValue;
      setDragOver(nextValue);
    };

    getCurrentWindow().onDragDropEvent((event) => {
      const type = event.payload.type;
      if (type === 'enter' || type === 'over') {
        const paths: string[] = (event.payload as { paths?: string[] }).paths ?? [];
        if (paths.length === 0) return;
        updateDragFiles(paths);
        const pos = (event.payload as { position?: { x: number; y: number } }).position;
        const hitEl = pos ? document.elementFromPoint(pos.x, pos.y) : null;
        updateDragOver(!hitEl?.closest('[data-panel="ai"]'));
      } else if (type === 'drop') {
        updateDragOver(false);
        const paths: string[] = (event.payload as { paths?: string[] }).paths ?? [];
        if (paths.length > 0 && workspaceRef.current) {
          const pos = (event.payload as { position?: { x: number; y: number } }).position;
          const hitEl = pos ? document.elementFromPoint(pos.x, pos.y) : null;
          if (aiPanelRef.current && hitEl?.closest('[data-panel="ai"]')) {
            setAiOpen(true);
            aiPanelRef.current.receiveFinderFiles(paths);
          } else {
            void handleDroppedFiles(paths);
          }
        }
      } else {
        updateDragOver(false);
        updateDragFiles([]);
      }
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  // Re-register when workspace changes so workspaceRef is always fresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.path]);

  return { dragOver, dragFiles };
}
