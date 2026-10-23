import { useTranslation } from 'react-i18next';
import type { Workspace } from '../../types';

export interface WorkspaceTabProps {
  workspace: Workspace;
  wsName: string;
  setWsName: (v: string) => void;
  wsInboxFile: string;
  setWsInboxFile: (v: string) => void;
  wsGitBranch: string;
  setWsGitBranch: (v: string) => void;
  wsSaving: boolean;
  wsSaved: boolean;
  onWsSave: () => void;
}

export function WorkspaceTab({
  workspace,
  wsName,
  setWsName,
  wsInboxFile,
  setWsInboxFile,
  wsGitBranch,
  setWsGitBranch,
  wsSaving,
  wsSaved,
  onWsSave,
}: WorkspaceTabProps) {
  const { t } = useTranslation();
  return (
    <div className="sm-section-list">

      <section className="sm-section">
        <h3 className="sm-section-title">{t('settings.wsIdentificationTitle')}</h3>

        <div className="sm-row sm-row--col">
          <label className="sm-label">{t('settings.wsNameLabel')}</label>
          <input
            className="sm-input"
            value={wsName}
            onChange={(e) => setWsName(e.target.value)}
            placeholder={t('settings.wsNamePlaceholder') ?? ''}
          />
        </div>

        <div className="sm-row sm-row--col">
          <label className="sm-label">
            {t('settings.wsPathLabel')}
            <span className="sm-row-desc" style={{ marginLeft: 8 }}>{t('settings.wsReadOnly')}</span>
          </label>
          <input
            className="sm-input sm-input--readonly"
            value={workspace.path}
            readOnly
            title={workspace.path}
          />
        </div>
      </section>


      <section className="sm-section">
        <h3 className="sm-section-title">{t('settings.wsGitSyncBranchTitle')}</h3>
        <div className="sm-row sm-row--col">
          <label className="sm-label">
            {t('settings.wsBranchLabel')}
            <span className="sm-row-desc"> {t('settings.wsBranchHint')}</span>
          </label>
          <input
            className="sm-input"
            value={wsGitBranch}
            onChange={(e) => setWsGitBranch(e.target.value)}
            placeholder="main"
          />
        </div>
      </section>

      <section className="sm-section">
        <h3 className="sm-section-title">{t('settings.wsVoiceInboxTitle')}</h3>
        <div className="sm-row sm-row--col">
          <label className="sm-label">
            {t('settings.wsInboxPathLabel')}
            <span className="sm-row-desc"> {t('settings.wsInboxPathHint')}</span>
          </label>
          <input
            className="sm-input"
            value={wsInboxFile}
            onChange={(e) => setWsInboxFile(e.target.value)}
            placeholder="00_Inbox/raw_transcripts.md"
          />
        </div>
      </section>

      <div className="sm-footer">
        <button
          className={`sm-save-btn ${wsSaved ? 'saved' : ''}`}
          onClick={onWsSave}
          disabled={wsSaving}
        >
          {wsSaving ? t('settings.wsSaving') : wsSaved ? t('settings.wsSavedDone') : t('settings.wsSaveButton')}
        </button>
      </div>

    </div>
  );
}
