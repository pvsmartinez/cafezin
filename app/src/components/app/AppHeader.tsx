import { invoke } from '@tauri-apps/api/core';
import { House, List, Sparkle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { Workspace } from '../../types';
import type { FileTypeInfo } from '../../utils/fileType';

export interface AppHeaderProps {
  sidebarOpen: boolean;
  sidebarShortcutLabel: string;
  onToggleSidebar: () => void;
  activeFile: string | null;
  title: string;
  workspace: Workspace;
  onGoHome: () => void;
  fileTypeInfo: FileTypeInfo | null;
  viewMode: 'edit' | 'preview';
  onSetViewMode: (mode: 'edit' | 'preview') => void;
  pandocBusy: boolean;
  pandocStatus: { detail?: string; cancelRequested?: boolean } | null;
  onCancelPandocExport: () => void;
  activeTabId: string | null;
  saveError: string | null;
  onRetrySave: () => void;
  dirtyFiles: Set<string>;
  savedToast: boolean;
  pandocError: string | null;
  onClearPandocError: () => void;
  isDev: boolean;
  aiOpen: boolean;
  onToggleAi: () => void;
  previewShortcutLabel: string;
}

export function AppHeader({
  sidebarOpen,
  sidebarShortcutLabel,
  onToggleSidebar,
  activeFile,
  title,
  workspace,
  onGoHome,
  fileTypeInfo,
  viewMode,
  onSetViewMode,
  pandocBusy,
  pandocStatus,
  onCancelPandocExport,
  activeTabId,
  saveError,
  onRetrySave,
  dirtyFiles,
  savedToast,
  pandocError,
  onClearPandocError,
  isDev,
  aiOpen,
  onToggleAi,
  previewShortcutLabel,
}: AppHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="app-header">
      <div className="app-header-left">
        <button
          className={`app-sidebar-toggle ${sidebarOpen ? 'active' : ''}`}
          onClick={onToggleSidebar}
          title={sidebarOpen ? `Hide sidebar (${sidebarShortcutLabel})` : `Show sidebar (${sidebarShortcutLabel})`}
        >
          <List weight="thin" size={18} />
        </button>
        <span className="app-logo">✦</span>
        {activeFile && (
          <button
            className="app-home-btn"
            onClick={onGoHome}
            title="Go to workspace home"
          >
            <House weight="thin" size={15} />
          </button>
        )}
        {!activeFile && (
          <>
            <span className="app-title">{title}</span>
            {workspace.config.name && (
              <span className="app-workspace-name">{workspace.config.name}</span>
            )}
          </>
        )}
      </div>

      <div className="app-header-right">
        {fileTypeInfo?.kind === 'markdown' && (
          <div className="app-view-toggle">
            <button
              className={`app-view-btn ${viewMode === 'edit' ? 'active' : ''}`}
              onClick={() => onSetViewMode('edit')}
              title={`Edit mode (${previewShortcutLabel} to toggle)`}
            >
              Edit
            </button>
            <button
              className={`app-view-btn ${viewMode === 'preview' ? 'active' : ''}`}
              onClick={() => onSetViewMode('preview')}
              title={`Preview rendered markdown (${previewShortcutLabel} to toggle)`}
            >
              Preview
            </button>
          </div>
        )}

        {pandocBusy && (
          <button
            className={`app-export-pdf-btn busy${pandocStatus?.cancelRequested ? ' stopping' : ''}`}
            title={pandocStatus?.detail ?? 'PDF export in progress'}
            onClick={onCancelPandocExport}
          >
            {pandocStatus?.cancelRequested
              ? 'Stopping PDF…'
              : `Stop PDF${pandocStatus?.detail ? ` · ${pandocStatus.detail}` : ''}`}
          </button>
        )}

        {activeTabId && fileTypeInfo && !['pdf', 'video', 'audio', 'image'].includes(fileTypeInfo.kind) && (
          saveError ? (
            <span
              className="app-save-error"
              title={t('app.saveFailedTitle', { error: saveError })}
              onClick={onRetrySave}
            >
              {t('app.saveFailedLabel')}
            </span>
          ) : dirtyFiles.has(activeTabId) && !savedToast ? (
            <span className="app-unsaved" title={t('app.unsavedTitle')}>
              {t('app.unsavedLabel')}
            </span>
          ) : null
        )}

        {savedToast && <span className="app-saved-toast">{t('app.savedLabel')}</span>}


        {pandocError && (
          <span
            className="app-save-error"
            title={pandocError}
            onClick={onClearPandocError}
          >
            ⚠ {pandocError.length > 45 ? `${pandocError.slice(0, 45)}…` : pandocError}
          </span>
        )}

        {isDev && (
          <button
            className="app-devtools-btn"
            onClick={() => invoke('open_devtools')}
            title={t('app.openDevtoolsTitle')}
          >
            {t('app.devtoolsLabel')}
          </button>
        )}

        <button
          className={`app-ai-toggle ${aiOpen ? 'active' : ''}`}
          onClick={onToggleAi}
          title={t('app.toggleCopilotTitle')}
        >
          <Sparkle weight="thin" size={16} />
          <span>{t('app.copilotLabel')}</span>
        </button>
      </div>
    </header>
  );
}
