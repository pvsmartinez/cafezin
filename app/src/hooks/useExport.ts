import { useState, useRef } from 'react';
import type { MutableRefObject } from 'react';
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
  activeTabId: string | null;
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
  activeTabId,
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
    exportRestoreTabRef.current = activeTabId;
    setExportLock(true);
    setExportLockState((current) => current ?? {
      title: 'Exporting…',
      detail: `Opening ${relPath}…`,
      cancelRequested: false,
    });

    try {
      await handleOpenFileRef.current(relPath);
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
      const { exportMarkdownToPDF } = await import('../utils/exportPDF');
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
