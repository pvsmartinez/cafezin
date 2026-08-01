import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Workspace, SidebarButton } from '../../types';

export interface WorkspaceTabProps {
  workspace: Workspace;
  wsName: string;
  setWsName: (v: string) => void;
  wsVercelToken: string;
  setWsVercelToken: (v: string) => void;
  wsVercelTeamId: string;
  setWsVercelTeamId: (v: string) => void;
  wsVercelDemoHubProject: string;
  setWsVercelDemoHubProject: (v: string) => void;
  wsVercelDemoHubSourceDir: string;
  setWsVercelDemoHubSourceDir: (v: string) => void;
  wsSidebarButtons: SidebarButton[];
  setWsSidebarButtons: React.Dispatch<React.SetStateAction<SidebarButton[]>>;
  wsInboxFile: string;
  setWsInboxFile: (v: string) => void;
  wsGitBranch: string;
  setWsGitBranch: (v: string) => void;
  newBtnLabel: string;
  setNewBtnLabel: (v: string) => void;
  newBtnCmd: string;
  setNewBtnCmd: (v: string) => void;
  newBtnDesc: string;
  setNewBtnDesc: (v: string) => void;
  wsSaving: boolean;
  wsSaved: boolean;
  onWsSave: () => void;
}

export function WorkspaceTab({
  workspace,
  wsName,
  setWsName,
  wsVercelToken,
  setWsVercelToken,
  wsVercelTeamId,
  setWsVercelTeamId,
  wsVercelDemoHubProject,
  setWsVercelDemoHubProject,
  wsVercelDemoHubSourceDir,
  setWsVercelDemoHubSourceDir,
  wsSidebarButtons,
  setWsSidebarButtons,
  wsInboxFile,
  setWsInboxFile,
  wsGitBranch,
  setWsGitBranch,
  newBtnLabel,
  setNewBtnLabel,
  newBtnCmd,
  setNewBtnCmd,
  newBtnDesc,
  setNewBtnDesc,
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
        <h3 className="sm-section-title">{t('settings.wsSidebarShortcutsTitle')}</h3>
        <p className="sm-section-desc">
          {t('settings.wsSidebarShortcutsDesc')}
        </p>
        {wsSidebarButtons.map((btn) => (
          <div key={btn.id} className="sm-sidebar-btn-row">
            <span className="sm-sidebar-btn-label">{btn.label}</span>
            <code className="sm-sidebar-btn-cmd">{btn.command}</code>
            <button
              className="sm-sidebar-btn-delete"
              onClick={() => setWsSidebarButtons((prev) => prev.filter((b) => b.id !== btn.id))}
              title={t('settings.wsRemoveButton') ?? ''}
            >✕</button>
          </div>
        ))}
        <div className="sm-sidebar-btn-form">
          <input
            className="sm-input"
            placeholder={t('settings.wsLabelPlaceholder') ?? ''}
            value={newBtnLabel}
            onChange={(e) => setNewBtnLabel(e.target.value)}
          />
          <input
            className="sm-input"
            placeholder={t('settings.wsCommandPlaceholder') ?? ''}
            value={newBtnCmd}
            onChange={(e) => setNewBtnCmd(e.target.value)}
          />
          <input
            className="sm-input"
            placeholder={t('settings.wsDescPlaceholder') ?? ''}
            value={newBtnDesc}
            onChange={(e) => setNewBtnDesc(e.target.value)}
          />
          <button
            className="sm-save-btn"
            style={{ marginTop: 8 }}
            disabled={!newBtnLabel.trim() || !newBtnCmd.trim()}
            onClick={() => {
              setWsSidebarButtons((prev) => [...prev, {
                id: Math.random().toString(36).slice(2, 9),
                label: newBtnLabel.trim(),
                command: newBtnCmd.trim(),
                description: newBtnDesc.trim() || undefined,
              }]);
              setNewBtnLabel(''); setNewBtnCmd(''); setNewBtnDesc('');
            }}
          >{t('settings.wsAddButton')}</button>
        </div>
      </section>

      <section className="sm-section">
        <h3 className="sm-section-title">Vercel Publish</h3>
        <p className="sm-section-desc">
          {t('settings.wsVercelPublishDesc')}
        </p>

        <div className="sm-row sm-row--col">
          <label className="sm-label">
            {t('settings.wsTokenOverrideLabel')}
            <span className="sm-row-desc"> {t('settings.wsTokenOverrideHint')}</span>
          </label>
          <input
            className="sm-input"
            type="password"
            value={wsVercelToken}
            onChange={(e) => setWsVercelToken(e.target.value)}
            placeholder={t('settings.wsTokenOverridePlaceholder') ?? ''}
          />
        </div>

        <div className="sm-row sm-row--col">
          <label className="sm-label">
            {t('settings.wsTeamIdLabel')}
            <span className="sm-row-desc"> {t('settings.wsTeamIdHint')}</span>
          </label>
          <input
            className="sm-input"
            value={wsVercelTeamId}
            onChange={(e) => setWsVercelTeamId(e.target.value)}
            placeholder={t('settings.wsTeamIdPlaceholder') ?? ''}
          />
        </div>

        <p className="sm-section-desc" style={{ marginTop: 16 }}>
          <strong>Demo Hub</strong> — {t('settings.wsDemoHubDesc')}{' '}
          {t('settings.wsDemoHubExamplePrefix')} <code>demos/aula1/</code> {t('settings.wsDemoHubExampleMid')} <code>projeto.vercel.app/aula1</code>.
        </p>

        <div className="sm-row sm-row--col">
          <label className="sm-label">
            {t('settings.wsDemoHubProjectLabel')}
            <span className="sm-row-desc"> {t('settings.wsDemoHubProjectHint')}</span>
          </label>
          <input
            className="sm-input"
            value={wsVercelDemoHubProject}
            onChange={(e) => setWsVercelDemoHubProject(e.target.value)}
            placeholder={t('settings.wsDemoHubProjectPlaceholder') ?? ''}
          />
        </div>

        {wsVercelDemoHubProject.trim() && (
          <div className="sm-row sm-row--col">
            <label className="sm-label">
              {t('settings.wsDemoHubFolderLabel')}
              <span className="sm-row-desc"> {t('settings.wsDemoHubFolderHint')}</span>
            </label>
            <input
              className="sm-input"
              value={wsVercelDemoHubSourceDir}
              onChange={(e) => setWsVercelDemoHubSourceDir(e.target.value)}
              placeholder={t('settings.wsDemoHubFolderPlaceholder') ?? ''}
            />
          </div>
        )}
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
