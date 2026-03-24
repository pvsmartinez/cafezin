import { useState, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { Editor as TldrawEditor } from 'tldraw';
import { exportMarkdownToPDF } from '../utils/exportPDF';
import { saveWorkspaceConfig } from '../services/workspace';
import {
  normalizeWorkspaceExportConfig,
  type Workspace,
  type WorkspaceExportConfig,
} from '../types';

interface UseExportOptions {
  workspace: Workspace | null;
  activeFile: string | null;
  content: string;
  canvasEditorRef: MutableRefObject<TldrawEditor | null>;
  activeTabId: string | null;
  mountedRef: MutableRefObject<boolean>;
  switchToTab: (path: string) => void;
  /** A ref whose .current always points to the latest handleOpenFile implementation. */
  handleOpenFileRef: MutableRefObject<(path: string) => void | Promise<void>>;
  refreshWorkspace: (ws: Workspace) => Promise<void>;
  setWorkspace: React.Dispatch<React.SetStateAction<Workspace | null>>;
}

export function useExport({
  workspace,
  activeFile,
  content,
  canvasEditorRef,
  activeTabId,
  mountedRef,
  switchToTab,
  handleOpenFileRef,
  refreshWorkspace,
  setWorkspace,
}: UseExportOptions) {
  const [pandocBusy, setPandocBusy] = useState(false);
  const [pandocError, setPandocError] = useState<string | null>(null);
  const [pandocStatus, setPandocStatus] = useState<{
    detail?: string;
    cancelRequested?: boolean;
  } | null>(null);
  const pandocCancelRef = useRef(false);

  const [exportLock, setExportLock] = useState(false);
  const [exportLockState, setExportLockState] = useState<{
    title: string;
    detail?: string;
    cancelRequested?: boolean;
  } | null>(null);
  const exportRestoreTabRef = useRef<string | null>(null);

  function handleRestoreAfterExport(): void {
    const prev = exportRestoreTabRef.current;
    if (prev) switchToTab(prev);
    exportRestoreTabRef.current = null;
    setExportLock(false);
    setExportLockState(null);
  }

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
      await handleOpenFileRef.current(relPath);
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
        check();
        void timerId;
      });
    } catch (e) {
      handleRestoreAfterExport();
      throw e;
    }
  }

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
      await handleOpenFileRef.current(outRelPath);
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      if (!message.includes('Export canceled by user.')) {
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

  return {
    pandocBusy,
    pandocError,
    setPandocError,
    pandocStatus,
    exportLock,
    exportLockState,
    setExportLockState,
    handleExportPDF,
    handleCancelExportPDF,
    handleOpenFileForExport,
    handleRestoreAfterExport,
    handleExportConfigChange,
  };
}
