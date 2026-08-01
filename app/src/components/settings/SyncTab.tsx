import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Workspace } from '../../types';
import type { SyncDeviceFlowState, SyncedWorkspace } from '../../services/syncConfig';

type SyncStatus = 'idle' | 'checking' | 'not_connected' | 'connected';

export interface SyncTabProps {
  onCancelDeviceFlow: () => void;
  workspace: Workspace | null;
  syncStatus: SyncStatus;
  syncUser: string;
  syncWorkspaces: SyncedWorkspace[];
  onSignOut: () => void;
  showGitDetails: boolean;
  setShowGitDetails: React.Dispatch<React.SetStateAction<boolean>>;
  currentSyncEntry: SyncedWorkspace | null;
  regLabel: string;
  setRegLabel: (v: string) => void;
  regState: 'idle' | 'busy' | 'done' | 'error';
  regError: string;
  onRegister: () => void;
  gitAccounts: string[];
  knownGitLabels: string[];
  hasLocalGitTokenForSelectedLabel: boolean;
  activateSyncBusy: boolean;
  activateSyncFlowState: SyncDeviceFlowState | null;
  gitFlowBusy: boolean;
  gitFlowState: SyncDeviceFlowState | null;
  syncAdvancedMode: 'create' | 'existing';
  setSyncAdvancedMode: (v: 'create' | 'existing') => void;
  syncAdvancedRepoName: string;
  setSyncAdvancedRepoName: (v: string) => void;
  syncAdvancedPrivate: boolean;
  setSyncAdvancedPrivate: (v: boolean) => void;
  syncAdvancedUrl: string;
  setSyncAdvancedUrl: (v: string) => void;
  onActivateSync: () => void;
  gitLabel: string;
  setGitLabel: (v: string) => void;
  onConnectGitAccount: () => void;
  onUnregister: (gitUrl: string) => void;
  syncError: string | null;
  onNavigateToAccount: () => void;
}


export function SyncTab({
  workspace,
  syncStatus,
  syncUser,
  syncWorkspaces,
  onSignOut,
  showGitDetails,
  setShowGitDetails,
  currentSyncEntry,
  regLabel,
  setRegLabel,
  regState,
  regError,
  onRegister,
  gitAccounts,
  knownGitLabels,
  hasLocalGitTokenForSelectedLabel,
  activateSyncBusy,
  activateSyncFlowState,
  gitFlowBusy,
  gitFlowState,
  syncAdvancedMode,
  setSyncAdvancedMode,
  syncAdvancedRepoName,
  setSyncAdvancedRepoName,
  syncAdvancedPrivate,
  setSyncAdvancedPrivate,
  syncAdvancedUrl,
  setSyncAdvancedUrl,
  onActivateSync,
  gitLabel,
  setGitLabel,
  onConnectGitAccount,
  onUnregister,
  syncError,
  onNavigateToAccount,
  onCancelDeviceFlow,
}: SyncTabProps) {
  const { t } = useTranslation();
  const needsGitAuthOnThisDevice = !hasLocalGitTokenForSelectedLabel;
  const activateLabel = syncAdvancedMode === 'existing'
    ? t('settings.syncActivateConnectRepo')
    : t('settings.syncActivateCreateRepo');

  return (
    <div className="sm-section-list">

      <section className="sm-section">
        <h3 className="sm-section-title">{t('settings.accountTitle')}</h3>

        {syncStatus === 'checking' && (
          <div className="sm-sync-status">{t('settings.connecting')}</div>
        )}

        {syncStatus === 'not_connected' && (
          <p className="sm-section-desc">
            {t('settings.syncLoginPre')}{' '}
            <button
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' }}
              onClick={onNavigateToAccount}
            >
              {t('settings.tabAccount')}
            </button>{' '}
            {t('settings.syncLoginPost')}
          </p>
        )}

        {syncStatus === 'connected' && (
          <div className="sm-sync-connected">
            <div className="sm-sync-connected-info">
              <span className="sm-sync-dot" />
              <span>{syncUser ? t('settings.connectedAs', { user: syncUser }) : t('settings.connected')}</span>
            </div>
            <button className="sm-sync-disconnect" onClick={() => void onSignOut()}>
              {t('settings.signOut')}
            </button>
          </div>
        )}
      </section>

      {syncStatus === 'connected' && (
        <section className="sm-section">
          <h3 className="sm-section-title">{t('settings.syncedWorkspacesTitle')}</h3>
          {syncWorkspaces.length === 0 ? (
            <p className="sm-sync-empty">{t('settings.syncedWorkspacesEmpty')}</p>
          ) : (
            <ul className="sm-sync-ws-list">
              {syncWorkspaces.map((ws) => (
                <li key={ws.gitUrl} className="sm-sync-ws-item">
                  <div className="sm-sync-ws-info">
                    <span className="sm-sync-ws-name">{ws.name}</span>
                    <span className="sm-sync-ws-url">{ws.gitUrl}</span>
                    {showGitDetails && (
                      <span className="sm-sync-ws-label">{t('settings.syncTechAccount', { label: ws.gitAccountLabel })}</span>
                    )}
                  </div>
                  <button
                    className="sm-sync-ws-remove"
                    title={t('settings.syncRemoveFromSync') ?? ''}
                    onClick={() => onUnregister(ws.gitUrl)}
                  >✕</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {syncStatus === 'connected' && workspace && (
        <section className="sm-section">
          <h3 className="sm-section-title">
            {workspace.hasGit ? t('settings.syncThisWorkspaceTitle') : t('settings.syncActivateThisWorkspaceTitle')}
          </h3>
          {workspace.hasGit ? (
            <>
              {currentSyncEntry ? (
                <div className="sm-sync-state-card">
                  <strong>{t('settings.syncAlreadySynced')}</strong>
                  <span>{currentSyncEntry.name}</span>
                  <span className="sm-sync-ws-url">{currentSyncEntry.gitUrl}</span>
                  <span className="sm-sync-ws-label">{t('settings.syncAccountUsed', { label: currentSyncEntry.gitAccountLabel })}</span>
                </div>
              ) : (
                <>
                  <p className="sm-section-desc">
                    {t('settings.syncRegisterDesc')}
                  </p>
                  <div className="sm-row sm-row--col">
                    <label className="sm-label">
                      {t('settings.syncGitAccountLabel')}
                      <span className="sm-row-desc"> {t('settings.syncGitAccountLabelHint')}</span>
                    </label>
                    {gitAccounts.length > 0 ? (
                      <select
                        className="sm-select"
                        value={regLabel}
                        onChange={(e) => setRegLabel(e.target.value)}
                      >
                        {knownGitLabels.map((label) => (
                          <option key={label} value={label}>{label}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="sm-row-desc">{t('settings.syncNoLabelsKnown')}</span>
                    )}
                  </div>
                  <div className="sm-sync-register">
                    <button
                      className={`sm-save-btn ${regState === 'done' ? 'saved' : ''}`}
                      onClick={onRegister}
                      disabled={regState === 'busy' || knownGitLabels.length === 0}
                    >
                      {regState === 'busy' ? t('settings.syncRegistering') : regState === 'done' ? t('settings.syncRegisteredDone') : t('settings.syncRegisterButton')}
                    </button>
                  </div>
                  {regState === 'error' && <p className="sm-sync-error" style={{ marginTop: 8 }}>{regError}</p>}
                </>
              )}
            </>
          ) : (
            <>
              <p className="sm-section-desc">
                {t('settings.syncConnectRepoDesc')}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className={`sm-secondary-btn ${syncAdvancedMode === 'create' ? 'active' : ''}`}
                    onClick={() => setSyncAdvancedMode('create')}
                    style={{ flex: 1, fontSize: 12 }}
                  >
                    {t('settings.syncCreateNewRepo')}
                  </button>
                  <button
                    className={`sm-secondary-btn ${syncAdvancedMode === 'existing' ? 'active' : ''}`}
                    onClick={() => setSyncAdvancedMode('existing')}
                    style={{ flex: 1, fontSize: 12 }}
                  >
                    {t('settings.syncUseExistingUrl')}
                  </button>
                </div>

                {syncAdvancedMode === 'create' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label className="sm-label">{t('settings.syncRepoNameLabel')}</label>
                    <input
                      className="sm-input"
                      value={syncAdvancedRepoName}
                      onChange={(e) => setSyncAdvancedRepoName(e.target.value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-'))}
                      placeholder={workspace.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className={`sm-secondary-btn ${syncAdvancedPrivate ? 'active' : ''}`}
                        onClick={() => setSyncAdvancedPrivate(true)}
                        style={{ flex: 1, fontSize: 12 }}
                      >
                        {t('settings.syncPrivate')}
                      </button>
                      <button
                        className={`sm-secondary-btn ${!syncAdvancedPrivate ? 'active' : ''}`}
                        onClick={() => setSyncAdvancedPrivate(false)}
                        style={{ flex: 1, fontSize: 12 }}
                      >
                        {t('settings.syncPublic')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label className="sm-label">{t('settings.syncExistingRepoUrlLabel')}</label>
                    <input
                      className="sm-input"
                      value={syncAdvancedUrl}
                      onChange={(e) => setSyncAdvancedUrl(e.target.value)}
                      placeholder="https://github.com/usuario/repo.git"
                    />
                  </div>
                )}
              </div>

              <div className="sm-row sm-row--col">
                <label className="sm-label">
                  {t('settings.syncGitAccountToUseLabel')}
                  <span className="sm-row-desc"> {t('settings.syncGitAccountToUseHint')}</span>
                </label>
                {knownGitLabels.length > 1 ? (
                  <select
                    className="sm-select"
                    value={regLabel}
                    onChange={(e) => setRegLabel(e.target.value)}
                  >
                    {knownGitLabels.map((label) => (
                      <option key={label} value={label}>
                        {label}{gitAccounts.includes(label) ? t('settings.syncAuthenticatedOnDevice') : t('settings.syncKnownBySync')}
                      </option>
                    ))}
                  </select>
                ) : knownGitLabels.length === 1 ? (
                  <div className="sm-sync-state-card">
                    <strong>{knownGitLabels[0]}</strong>
                    <span>
                      {gitAccounts.includes(knownGitLabels[0])
                        ? t('settings.syncAccountAuthenticated')
                        : t('settings.syncAccountSuggested')}
                    </span>
                  </div>
                ) : (
                  <span className="sm-row-desc">{t('settings.syncNoKnownAccount')}</span>
                )}
              </div>

              {(activateSyncFlowState || (gitFlowBusy && gitFlowState)) && (
                <div className="sm-sync-flow">
                  <p className="sm-sync-flow-text">{t('settings.syncOpenUrlHint')}</p>
                  <a
                    className="sm-sync-flow-url"
                    href={(activateSyncFlowState ?? gitFlowState)!.verificationUri}
                    target="_blank" rel="noreferrer"
                  >
                    {(activateSyncFlowState ?? gitFlowState)!.verificationUri}
                  </a>
                  <div className="sm-sync-flow-code">{(activateSyncFlowState ?? gitFlowState)!.userCode}</div>
                  <p className="sm-sync-flow-hint">{t('settings.syncAwaitingAuth')}</p>
                </div>
              )}

              {needsGitAuthOnThisDevice && !activateSyncFlowState && !gitFlowBusy && (
                <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 4px' }}>
                  {t('settings.syncNoTokenYetHint')}
                </p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(gitFlowBusy || activateSyncBusy) ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="sm-save-btn"
                      disabled
                      style={{ flex: 1 }}
                    >
                      {gitFlowBusy ? t('settings.syncAwaitingGithub') : t('settings.syncActivating')}
                    </button>
                    <button
                      className="sm-secondary-btn"
                      onClick={onCancelDeviceFlow}
                      style={{ flexShrink: 0 }}
                    >
                      {t('settings.syncCancel')}
                    </button>
                  </div>
                ) : (
                <button
                  className="sm-save-btn"
                  onClick={() => void onActivateSync()}
                  disabled={activateSyncBusy || gitFlowBusy}
                  style={{ width: '100%' }}
                >
                  ☁ {activateLabel}
                </button>
                )}
              </div>

              {syncError && <p className="sm-sync-error" style={{ marginTop: 8 }}>{syncError}</p>}
            </>
          )}
        </section>
      )}

      {syncStatus === 'connected' && (
        <section className="sm-section">
          <button
            className="sm-secondary-btn"
            onClick={() => setShowGitDetails((value) => !value)}
            style={{ fontSize: 12 }}
          >
            {showGitDetails ? t('settings.syncAdvancedOptionsHide') : t('settings.syncAdvancedOptionsShow')}
          </button>

          {showGitDetails && (
            <>
              <p className="sm-section-desc" style={{ marginTop: 12 }}>
                {t('settings.syncConnectMoreAccountsDesc')}
              </p>
              {gitAccounts.length > 0 && (
                <ul className="sm-sync-ws-list" style={{ marginBottom: 12 }}>
                  {gitAccounts.map((l) => (
                    <li key={l} className="sm-sync-ws-item">
                      <span className="sm-sync-dot" />
                      <span className="sm-sync-ws-name" style={{ marginLeft: 8 }}>{l}</span>
                      <span className="sm-sync-ws-label" style={{ marginLeft: 'auto' }}>{t('settings.syncAuthenticatedTag')}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!gitFlowState && (
                <div className="sm-sync-register">
                  <input
                    className="sm-input"
                    value={gitLabel}
                    onChange={(e) => setGitLabel(e.target.value)}
                    placeholder={t('settings.syncAccountLabelPlaceholder') ?? ''}
                  />
                  <button
                    className="sm-save-btn"
                    onClick={onConnectGitAccount}
                    disabled={gitFlowBusy || !gitLabel.trim()}
                  >
                    {gitFlowBusy ? t('settings.syncWaiting') : t('settings.syncConnect')}
                  </button>
                </div>
              )}
              {syncError && <p className="sm-sync-error" style={{ marginTop: 8 }}>{syncError}</p>}
            </>
          )}
        </section>
      )}

    </div>
  );
}
