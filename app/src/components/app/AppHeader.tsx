import { List } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { Workspace } from '../../types';
import type { FileTypeInfo } from '../../utils/fileType';

export type EditorMode = 'write' | 'source' | 'read';

export interface AppHeaderProps {
  sidebarOpen: boolean;
  sidebarShortcutLabel: string;
  onToggleSidebar: () => void;
  activeFile: string | null;
  workspace: Workspace;
  onGoHome: () => void;
  fileTypeInfo: FileTypeInfo | null;
  editorMode: EditorMode;
  onSetEditorMode: (mode: EditorMode) => void;
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
  previewShortcutLabel: string;
  /** Words in the active text, shown next to the save status. */
  wordCount?: number;
}

export function AppHeader({
  sidebarOpen,
  sidebarShortcutLabel,
  onToggleSidebar,
  activeFile,
  workspace,
  onGoHome,
  fileTypeInfo,
  editorMode,
  onSetEditorMode,
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
  previewShortcutLabel,
  wordCount,
}: AppHeaderProps) {
  const { t, i18n } = useTranslation();

  return (
    <header className="app-header">
      <div className="app-header-left">
        <button
          className={`app-sidebar-toggle ${sidebarOpen ? 'active' : ''}`}
          onClick={onToggleSidebar}
          title={t(sidebarOpen ? 'app.hideSidebarTitle' : 'app.showSidebarTitle', { shortcut: sidebarShortcutLabel })}
        >
          <List weight="thin" size={18} />
        </button>
        {!sidebarOpen && (
          <button className="app-home-btn" onClick={onGoHome} title={t('app.goHomeTitle')}>
            {workspace.config.name || workspace.name}
          </button>
        )}
      </div>

      <div className="app-header-right">
        {activeFile && fileTypeInfo?.kind === 'markdown' && (
          <div className="app-view-toggle" role="group" aria-label={t('app.editorModeLabel')}>
            {(['write', 'source'] as const).map((mode) => (
              <button
                key={mode}
                className={`app-view-btn ${editorMode === mode ? 'active' : ''}`}
                aria-pressed={editorMode === mode}
                onClick={() => onSetEditorMode(mode)}
                title={t(`app.${mode}ModeTitle`, { shortcut: previewShortcutLabel })}
              >
                {t(`app.${mode}ModeLabel`)}
              </button>
            ))}
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

        {activeTabId && fileTypeInfo && !['pdf', 'video', 'audio', 'image', 'unsupported'].includes(fileTypeInfo.kind) && (
          saveError ? (
            <span
              className="app-save-error"
              title={t('app.saveFailedTitle', { error: saveError })}
              onClick={onRetrySave}
            >
              {t('app.saveFailedLabel')}
            </span>
          ) : (
            <span className="app-doc-status" title={dirtyFiles.has(activeTabId) ? t('app.unsavedTitle') : undefined}>
              {wordCount !== undefined && `${t('app.wordCount', { count: wordCount, formatted: wordCount.toLocaleString(i18n.language) })} · `}
              {dirtyFiles.has(activeTabId) && !savedToast ? t('app.unsavedLabel') : t('app.savedLabel')}
            </span>
          )
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

      </div>
    </header>
  );
}
