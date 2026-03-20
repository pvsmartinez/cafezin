import { invoke } from '@tauri-apps/api/core';
import { ArrowSquareOut, House, List, Sparkle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { Workspace } from '../../types';
import type { FileTypeInfo } from '../../utils/fileType';

interface DemoHubToast {
  msg: string;
  ok: boolean;
}

export interface AppHeaderProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  activeFile: string | null;
  title: string;
  workspace: Workspace;
  onGoHome: () => void;
  fileTypeInfo: FileTypeInfo | null;
  viewMode: 'edit' | 'preview';
  onSetViewMode: (mode: 'edit' | 'preview') => void;
  pandocBusy: boolean;
  activeTabId: string | null;
  saveError: string | null;
  onRetrySave: () => void;
  dirtyFiles: Set<string>;
  savedToast: boolean;
  demoHubToast: DemoHubToast | null;
  onClearDemoHubToast: () => void;
  pandocError: string | null;
  onClearPandocError: () => void;
  isDev: boolean;
  aiOpen: boolean;
  onToggleAi: () => void;
  onOpenNewWindow: () => void;
}

export function AppHeader({
  sidebarOpen,
  onToggleSidebar,
  activeFile,
  title,
  workspace,
  onGoHome,
  fileTypeInfo,
  viewMode,
  onSetViewMode,
  pandocBusy,
  activeTabId,
  saveError,
  onRetrySave,
  dirtyFiles,
  savedToast,
  demoHubToast,
  onClearDemoHubToast,
  pandocError,
  onClearPandocError,
  isDev,
  aiOpen,
  onToggleAi,
  onOpenNewWindow,
}: AppHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="app-header">
      <div className="app-header-left">
        <button
          className={`app-sidebar-toggle ${sidebarOpen ? 'active' : ''}`}
          onClick={onToggleSidebar}
          title={sidebarOpen ? 'Hide sidebar (⌘B)' : 'Show sidebar (⌘B)'}
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
        {(fileTypeInfo?.kind === 'markdown' ||
          fileTypeInfo?.kind === 'canvas' ||
          fileTypeInfo?.kind === 'html' ||
          (fileTypeInfo?.kind === 'code' && fileTypeInfo.supportsPreview)) && (
          <div className="app-view-toggle">
            <button
              className={`app-view-btn ${viewMode === 'edit' ? 'active' : ''}`}
              onClick={() => onSetViewMode('edit')}
              title="Edit mode (⌘⇧P to toggle)"
            >
              Edit
            </button>
            <button
              className={`app-view-btn ${viewMode === 'preview' ? 'active' : ''}`}
              onClick={() => onSetViewMode('preview')}
              title={
                fileTypeInfo?.kind === 'canvas'
                  ? 'Present — keyboard: ←→ to navigate, Esc to exit'
                  : fileTypeInfo?.kind === 'html' ||
                      (fileTypeInfo?.kind === 'code' && fileTypeInfo.supportsPreview)
                    ? 'Preview in browser (⌘⇧P to toggle)'
                    : 'Preview rendered markdown (⌘⇧P to toggle)'
              }
            >
              {fileTypeInfo?.kind === 'canvas' ? 'Present' : 'Preview'}
            </button>
          </div>
        )}

        {fileTypeInfo?.kind === 'html' && activeFile && (
          <>
            <button
              className="app-view-btn"
              title="Abrir no navegador (file://)"
              onClick={async () => {
                const { openUrl } = await import('@tauri-apps/plugin-opener');
                openUrl(`file://${workspace.path}/${activeFile}`);
              }}
            >
              ⊕ Browser
            </button>
            {workspace.config.vercelConfig?.demoHub?.projectName && (
              <button
                className="app-view-btn"
                title={`Abrir URL publicada: ${workspace.config.vercelConfig.demoHub.projectName}.vercel.app`}
                onClick={async () => {
                  const { openUrl } = await import('@tauri-apps/plugin-opener');
                  const base = `https://${workspace.config.vercelConfig!.demoHub!.projectName}.vercel.app`;
                  const sourceDir = workspace.config.vercelConfig?.demoHub?.sourceDir ?? '';
                  const relToSource = sourceDir
                    ? activeFile.replace(new RegExp(`^${sourceDir}/?`), '')
                    : activeFile;
                  openUrl(`${base}/${relToSource}`);
                }}
              >
                ⊕ Vercel
              </button>
            )}
          </>
        )}

        {pandocBusy && <span className="app-export-pdf-btn busy">Exporting…</span>}

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

        {demoHubToast && (
          <span
            className={demoHubToast.ok ? 'app-saved-toast' : 'app-save-error'}
            style={{ maxWidth: 360, cursor: 'pointer' }}
            title={demoHubToast.msg}
            onClick={onClearDemoHubToast}
          >
            {demoHubToast.msg.length > 55 ? `${demoHubToast.msg.slice(0, 55)}…` : demoHubToast.msg}
          </span>
        )}

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
          className="app-header-btn"
          onClick={onOpenNewWindow}
          title="Abrir outra janela do Cafezin"
        >
          <ArrowSquareOut weight="thin" size={14} />
          <span>Nova janela</span>
        </button>

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