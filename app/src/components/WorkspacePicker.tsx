import { useState, useEffect } from 'react';
import { FolderOpen, Plus, SignIn, SignOut, Cloud, CloudSlash, CloudArrowUp, GitBranch, ArrowSquareOut } from '@phosphor-icons/react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { AuthScreen } from '@pvsmartinez/shared';
import { supabase } from '../services/supabase';
import { mkdir } from '../services/fs';
import { pickWorkspaceFolder, loadWorkspace, getRecents, removeRecent } from '../services/workspace';
import {
  createGitHubRepo,
  getGitAccountToken,
  getSession, getUser, signOut,
  listGitAccountLabels,
  listSyncedWorkspaces, registerWorkspace, registerWorkspaceByUrl,
  startGitAccountFlow,
  type SyncedWorkspace,
  type SyncDeviceFlowState,
} from '../services/syncConfig';
import type { Workspace, RecentWorkspace } from '../types';
import './WorkspacePicker.css';
import { timeAgo } from '../utils/timeAgo';

const DEFAULT_GIT_ACCOUNT_LABEL = 'personal';

function getPreferredGitAccountLabel(labels: string[]): string {
  if (labels.includes(DEFAULT_GIT_ACCOUNT_LABEL)) return DEFAULT_GIT_ACCOUNT_LABEL;
  return labels[0] ?? DEFAULT_GIT_ACCOUNT_LABEL;
}

function sanitizeRepoName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

/** Normalize a git URL for comparison: strip protocol/host, trailing .git, lowercase */
function normalizeGitUrl(url: string): string {
  return url
    .trim()
    .replace(/\.git$/, '')
    .replace(/^git@[^:]+:/, '')      // git@github.com:user/repo → user/repo
    .replace(/^https?:\/\/[^/]+\//, '') // https://github.com/user/repo → user/repo
    .toLowerCase();
}

type MergedEntry =
  | { type: 'synced';       cloud: SyncedWorkspace; local: RecentWorkspace }
  | { type: 'cloud-only';   cloud: SyncedWorkspace }
  | { type: 'local-git';    local: RecentWorkspace }
  | { type: 'local-nogit';  local: RecentWorkspace };

function buildMergedList(
  cloudWorkspaces: SyncedWorkspace[],
  recents: RecentWorkspace[],
): MergedEntry[] {
  const matchedLocalPaths = new Set<string>();
  const entries: MergedEntry[] = [];

  for (const cw of cloudWorkspaces) {
    const normalized = normalizeGitUrl(cw.gitUrl);
    const matched = recents.find(
      (r) => r.gitRemote && normalizeGitUrl(r.gitRemote) === normalized,
    );
    if (matched) {
      entries.push({ type: 'synced', cloud: cw, local: matched });
      matchedLocalPaths.add(matched.path);
    } else {
      entries.push({ type: 'cloud-only', cloud: cw });
    }
  }

  for (const r of recents) {
    if (matchedLocalPaths.has(r.path)) continue;
    entries.push(r.hasGit
      ? { type: 'local-git',   local: r }
      : { type: 'local-nogit', local: r },
    );
  }

  return entries;
}

interface WorkspacePickerProps {
  onOpen: (workspace: Workspace) => void;
}

export default function WorkspacePicker({ onOpen }: WorkspacePickerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentWorkspace[]>(getRecents);
  const [uncommitted, setUncommitted] = useState<Record<string, number | null>>({});

  // ── Auth ──────────────────────────────────────────────────────────────────
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  // ── Cloud workspaces ──────────────────────────────────────────────────────
  const [cloudWorkspaces, setCloudWorkspaces] = useState<SyncedWorkspace[]>([]);
  const [cloudLoading, setCloudLoading] = useState(false);

  // ── New workspace state ───────────────────────────────────────────────────
  const [createMode, setCreateMode] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [publishPath, setPublishPath] = useState<string | null>(null);
  const [publishName, setPublishName] = useState('');
  const [publishMode, setPublishMode] = useState<'create' | 'existing'>('create');
  const [publishRepoName, setPublishRepoName] = useState('');
  const [publishPrivateRepo, setPublishPrivateRepo] = useState(true);
  const [publishGitAccountLabel, setPublishGitAccountLabel] = useState(DEFAULT_GIT_ACCOUNT_LABEL);
  const [publishUrl, setPublishUrl] = useState('');
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [gitFlowBusy, setGitFlowBusy] = useState(false);
  const [gitFlowState, setGitFlowState] = useState<SyncDeviceFlowState | null>(null);
  const [gitAccountLabels, setGitAccountLabels] = useState<string[]>(() => {
    const labels = listGitAccountLabels();
    return labels.includes(DEFAULT_GIT_ACCOUNT_LABEL)
      ? labels
      : [DEFAULT_GIT_ACCOUNT_LABEL, ...labels.filter((label) => label !== DEFAULT_GIT_ACCOUNT_LABEL)];
  });

  // ── Publish-to-cloud state (local-nogit flow) ─────────────────────────────
  const [cloneBusy, setCloneBusy] = useState<string | null>(null); // gitUrl being cloned

  // ── Clone state (cloud-only flow) ─────────────────────────────────────────
  const [registerBusy, setRegisterBusy] = useState<string | null>(null); // local path being registered

  /** Create a new empty workspace folder and open it. */
  async function handleCreate() {
    const name = createName.trim();
    if (!name) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const parent = await pickWorkspaceFolder();
      if (!parent) { setCreateBusy(false); return; }
      const dest = `${parent}/${name}`;
      await mkdir(dest, { recursive: true });
      const workspace = await loadWorkspace(dest);
      onOpen(workspace);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
      setCreateBusy(false);
    }
  }

  // ── Initialise session + recents ─────────────────────────────────────────
  useEffect(() => {
    getSession().then(async (session) => {
      if (session) {
        const user = await getUser();
        setUserEmail(user?.email ?? null);
        await loadCloud();
      }
    }).catch(() => {});

    const onAuthUpdated = async () => {
      const user = await getUser().catch(() => null);
      if (user) {
        setUserEmail(user.email ?? null);
        await loadCloud();
      }
    };
    window.addEventListener('cafezin:auth-updated', onAuthUpdated as EventListener);

    if (recents.length > 0) {
      setUncommitted(Object.fromEntries(recents.map((r) => [r.path, null])));
      recents.forEach((r) => {
        invoke<{ files: string[] }>('git_diff', { path: r.path })
          .then((res) => setUncommitted((prev) => ({ ...prev, [r.path]: res.files.length })))
          .catch(() => setUncommitted((prev) => ({ ...prev, [r.path]: 0 })));
      });

      // Backfill gitRemote for old entries that were saved before remote detection existed
      const needsRemote = recents.filter((r) => r.gitRemote === undefined);
      if (needsRemote.length > 0) {
        Promise.allSettled(
          needsRemote.map((r) =>
            invoke<string>('git_get_remote', { path: r.path })
              .then((remote) => ({ path: r.path, remote: remote?.trim() || undefined }))
              .catch(() => ({ path: r.path, remote: undefined as string | undefined }))
          )
        ).then((results) => {
          const updates: Record<string, string | undefined> = {};
          results.forEach((res) => {
            if (res.status === 'fulfilled') updates[res.value.path] = res.value.remote;
          });
          setRecents((prev) => {
            const next = prev.map((r) =>
              r.path in updates
                ? { ...r, gitRemote: updates[r.path], hasGit: !!updates[r.path] }
                : r
            );
            // Persist backfilled data to localStorage — slice to cap size
            localStorage.setItem('cafezin-recent-workspaces', JSON.stringify(next.slice(0, 20)));
            return next;
          });
        });
      }
    }

    return () => window.removeEventListener('cafezin:auth-updated', onAuthUpdated as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadCloud() {
    setCloudLoading(true);
    try {
      const list = await listSyncedWorkspaces();
      setCloudWorkspaces(list);
    } catch { /* not fatal */ }
    finally { setCloudLoading(false); }
  }

  async function handleSignOut() {
    await signOut();
    setUserEmail(null);
    setCloudWorkspaces([]);
  }

  async function handlePick() {
    setError(null);
    setLoading(true);
    try {
      const path = await pickWorkspaceFolder();
      if (!path) { setLoading(false); return; }
      const workspace = await loadWorkspace(path);
      onOpen(workspace);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  }

  async function handleOpenLocal(recent: RecentWorkspace) {
    setError(null);
    setLoading(true);
    try {
      const workspace = await loadWorkspace(recent.path);
      onOpen(workspace);
    } catch (err) {
      setError(`Could not open "${recent.name}": ${err}`);
      removeRecent(recent.path);
      setRecents(getRecents());
      setLoading(false);
    }
  }

  /** Clone a cloud-only workspace: pick parent folder, then clone + open. */
  async function handleClone(cw: SyncedWorkspace) {
    setCloneBusy(cw.gitUrl);
    setError(null);
    try {
      const parent = await pickWorkspaceFolder();
      if (!parent) { setCloneBusy(null); return; }
      // Use workspace name as the folder name inside the picked parent
      const dest = `${parent}/${cw.name}`;
      await invoke('git_clone', { url: cw.gitUrl, path: dest, token: null, branch: cw.branch ?? null });
      const workspace = await loadWorkspace(dest);
      onOpen(workspace);
    } catch (err) {
      setError(`Erro ao clonar: ${err}`);
      setCloneBusy(null);
    }
  }

  /** Register an existing local-git workspace to the cloud (one-click). */
  async function handleRegisterLocalGit(r: RecentWorkspace) {
    if (!r.gitRemote) return;
    setRegisterBusy(r.path);
    setError(null);
    try {
      await registerWorkspace(r.path, r.name, 'personal');
      await loadCloud();
    } catch (err) {
      setError(`Erro ao sincronizar: ${err}`);
    } finally {
      setRegisterBusy(null);
    }
  }

  /** Open publish-to-cloud form for a local-nogit workspace. */
  function openPublishForm(r: RecentWorkspace) {
    const preferredLabel = getPreferredGitAccountLabel(gitAccountLabels);
    setPublishPath(r.path);
    setPublishName(r.name);
    setPublishMode('create');
    setPublishRepoName(sanitizeRepoName(r.name));
    setPublishPrivateRepo(true);
    setPublishGitAccountLabel(preferredLabel);
    setPublishUrl('');
    setPublishError(null);
  }

  async function ensureGitHubToken(label: string): Promise<string> {
    const existing = getGitAccountToken(label);
    if (existing) return existing;

    setGitFlowBusy(true);
    setPublishError(null);
    try {
      const token = await startGitAccountFlow(label, (state) => setGitFlowState(state));
      setGitFlowState(null);
      setGitAccountLabels((prev) => prev.includes(label) ? prev : [...prev, label]);
      return token;
    } finally {
      setGitFlowBusy(false);
    }
  }

  function updateRecentWorkspace(path: string, gitRemote: string) {
    setRecents((prev) => {
      const next = prev.map((r) =>
        r.path === path ? { ...r, hasGit: true, gitRemote } : r,
      );
      localStorage.setItem('cafezin-recent-workspaces', JSON.stringify(next.slice(0, 20)));
      return next;
    });
  }

  async function finalizePublishedWorkspace(gitUrl: string, gitAccountLabel: string, token?: string) {
    if (!publishPath) return;
    await invoke('git_set_remote', { path: publishPath, url: gitUrl });
    if (token) {
      await invoke('git_sync', {
        path: publishPath,
        message: 'Initial commit from Cafezin',
        token,
      });
    }
    await registerWorkspaceByUrl(publishName, gitUrl, gitAccountLabel);
    updateRecentWorkspace(publishPath, gitUrl);
    await loadCloud();
    setPublishPath(null);
    setGitFlowState(null);
  }

  /** Create a GitHub repo automatically, then push and register it. */
  async function handlePublishCreate() {
    if (!publishPath || !publishRepoName.trim()) return;
    setPublishBusy(true);
    setPublishError(null);
    try {
      const token = await ensureGitHubToken(publishGitAccountLabel);
      const repo = await createGitHubRepo(sanitizeRepoName(publishRepoName), publishPrivateRepo, token);
      await finalizePublishedWorkspace(repo.cloneUrl, publishGitAccountLabel, token);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishBusy(false);
    }
  }

  /** Set remote + register in Supabase for a local workspace with no git remote. */
  async function handlePublishExisting() {
    if (!publishPath || !publishUrl.trim()) return;
    setPublishBusy(true);
    setPublishError(null);
    try {
      const token = getGitAccountToken(publishGitAccountLabel) ?? undefined;
      await finalizePublishedWorkspace(publishUrl.trim(), publishGitAccountLabel, token);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishBusy(false);
    }
  }

  const merged = buildMergedList(cloudWorkspaces, recents);
  const hasAnyWorkspaces = merged.length > 0 || cloudLoading;

  return (
    <div className="wp-overlay">
      <div className="wp-card">

        {/* ── Header ── */}
        <div className="wp-header">
          <div className="wp-logo">✦</div>
          <h1 className="wp-title">Cafezin</h1>
          <p className="wp-tagline">Just Chilling</p>
        </div>

        {/* ── Primary actions ── */}
        <div className="wp-actions">
          <button className="wp-btn-action" onClick={handlePick} disabled={loading || createBusy}>
            <FolderOpen weight="thin" size={16} />
            <span>Abrir pasta</span>
          </button>
          <button
            className={`wp-btn-action wp-btn-action--create${createMode ? ' wp-btn-action--active' : ''}`}
            onClick={() => { setCreateMode((m) => !m); setCreateName(''); setCreateError(null); }}
            disabled={loading || createBusy}
          >
            <Plus weight="thin" size={16} />
            <span>Novo workspace</span>
          </button>
        </div>

        {/* ── New workspace inline form ── */}
        {createMode && (
          <div className="wp-create-form">
            <input
              className="wp-auth-input"
              placeholder="Nome do workspace"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate();
                if (e.key === 'Escape') { setCreateMode(false); setCreateName(''); }
              }}
              autoFocus
            />
            <p className="wp-create-hint">Escolha onde salvar na próxima etapa.</p>
            {createError && <div className="wp-auth-error">{createError}</div>}
            <button
              className="wp-btn-action wp-btn-action--primary"
              onClick={handleCreate}
              disabled={createBusy || !createName.trim()}
            >
              {createBusy ? 'Criando…' : 'Escolher local e criar'}
            </button>
          </div>
        )}

        {error && <div className="wp-error">{error}</div>}

        {/* ── Publish-to-cloud form (inline) ── */}
        {publishPath && (
          <div className="wp-publish-form">
            <div className="wp-publish-mode-row">
              <button
                className={`wp-publish-mode-btn${publishMode === 'create' ? ' wp-publish-mode-btn--active' : ''}`}
                onClick={() => setPublishMode('create')}
                disabled={publishBusy}
              >
                Criar repo no GitHub
              </button>
              <button
                className={`wp-publish-mode-btn${publishMode === 'existing' ? ' wp-publish-mode-btn--active' : ''}`}
                onClick={() => setPublishMode('existing')}
                disabled={publishBusy}
              >
                Usar URL existente
              </button>
            </div>

            {publishMode === 'create' ? (
              <>
                <p className="wp-publish-label">Padrão seguro: privado + conta git padrão. Se quiser, pode só clicar em Criar.</p>
                <input
                  className="wp-auth-input"
                  placeholder="nome-do-repositorio"
                  value={publishRepoName}
                  onChange={(e) => setPublishRepoName(sanitizeRepoName(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handlePublishCreate();
                    if (e.key === 'Escape') setPublishPath(null);
                  }}
                  autoFocus
                />
                <div className="wp-publish-settings">
                  <label className="wp-publish-setting">
                    <span className="wp-publish-setting-label">Conta git</span>
                    <select
                      className="wp-publish-select"
                      value={publishGitAccountLabel}
                      onChange={(e) => setPublishGitAccountLabel(e.target.value)}
                      disabled={publishBusy || gitFlowBusy}
                    >
                      {gitAccountLabels.map((label) => (
                        <option key={label} value={label}>{label}</option>
                      ))}
                    </select>
                  </label>

                  <div className="wp-publish-setting">
                    <span className="wp-publish-setting-label">Visibilidade</span>
                    <div className="wp-visibility-toggle" role="tablist" aria-label="Visibilidade do repositório">
                      <button
                        type="button"
                        className={`wp-visibility-btn${publishPrivateRepo ? ' wp-visibility-btn--active' : ''}`}
                        onClick={() => setPublishPrivateRepo(true)}
                        disabled={publishBusy}
                      >
                        Privado
                      </button>
                      <button
                        type="button"
                        className={`wp-visibility-btn${!publishPrivateRepo ? ' wp-visibility-btn--active' : ''}`}
                        onClick={() => setPublishPrivateRepo(false)}
                        disabled={publishBusy}
                      >
                        Publico
                      </button>
                    </div>
                  </div>
                </div>
                <p className="wp-publish-hint">
                  {getGitAccountToken(publishGitAccountLabel)
                    ? `Conta ${publishGitAccountLabel} ja autenticada.`
                    : `Se necessario, o GitHub vai pedir login para a conta ${publishGitAccountLabel}.`}
                </p>
              </>
            ) : (
              <>
                <p className="wp-publish-label">Cole a URL do repositório remoto:</p>
                <input
                  className="wp-auth-input"
                  placeholder="https://github.com/usuario/repo.git"
                  value={publishUrl}
                  onChange={(e) => setPublishUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handlePublishExisting();
                    if (e.key === 'Escape') setPublishPath(null);
                  }}
                  autoFocus
                />
                <label className="wp-publish-setting">
                  <span className="wp-publish-setting-label">Conta git</span>
                  <select
                    className="wp-publish-select"
                    value={publishGitAccountLabel}
                    onChange={(e) => setPublishGitAccountLabel(e.target.value)}
                    disabled={publishBusy || gitFlowBusy}
                  >
                    {gitAccountLabels.map((label) => (
                      <option key={label} value={label}>{label}</option>
                    ))}
                  </select>
                </label>
                <p className="wp-publish-hint">
                  Se a conta selecionada estiver autenticada, o Cafezin também faz o push inicial automaticamente.
                </p>
              </>
            )}

            {gitFlowState && (
              <div className="wp-publish-flow">
                <p className="wp-publish-flow-text">Abra esta URL no navegador e insira o código:</p>
                <button
                  className="wp-publish-link"
                  onClick={() => openUrl(gitFlowState.verificationUri).catch(() => window.open(gitFlowState.verificationUri, '_blank'))}
                  type="button"
                >
                  {gitFlowState.verificationUri}
                </button>
                <div className="wp-publish-flow-code">{gitFlowState.userCode}</div>
                <p className="wp-publish-hint">Aguardando autorização do GitHub…</p>
              </div>
            )}

            {publishError && <div className="wp-auth-error">{publishError}</div>}
            <div className="wp-publish-actions">
              <button className="wp-publish-cancel" onClick={() => setPublishPath(null)}>Cancelar</button>
              <button
                className="wp-btn-action wp-btn-action--primary wp-btn-action--sm"
                onClick={publishMode === 'create' ? handlePublishCreate : handlePublishExisting}
                disabled={publishBusy || gitFlowBusy || (publishMode === 'create' ? !publishRepoName.trim() : !publishUrl.trim())}
              >
                {publishBusy || gitFlowBusy
                  ? 'Publicando…'
                  : publishMode === 'create'
                    ? <><CloudArrowUp weight="thin" size={13} /> Criar</>
                    : <><CloudArrowUp weight="thin" size={13} /> Conectar</>}
              </button>
            </div>
          </div>
        )}

        {/* ── Workspaces (merged) ── */}
        {hasAnyWorkspaces && (
          <div className="wp-recents">
            <div className="wp-recents-label">
              {userEmail
                ? <><Cloud weight="thin" size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Workspaces</>
                : 'Recent workspaces'}
            </div>

            {cloudLoading && <div className="wp-cloud-empty">Loading…</div>}

            {merged.map((entry) => {
              if (entry.type === 'synced') {
                const { cloud: cw, local: r } = entry;
                const uncom = uncommitted[r.path];
                return (
                  <button
                    key={r.path}
                    className="wp-recent-item wp-recent-item--synced"
                    onClick={() => handleOpenLocal(r)}
                    disabled={loading}
                  >
                    <div className="wp-recent-top">
                      <span className="wp-recent-name">{r.name}</span>
                      <div className="wp-badges">
                        {uncom != null && uncom > 0 && (
                          <span className="wp-recent-badge" title={`${uncom} uncommitted`}>{uncom}</span>
                        )}
                        <span className="wp-synced-badge" title={cw.gitUrl}>
                          <ArrowSquareOut weight="thin" size={9} /> synced
                        </span>
                      </div>
                    </div>
                    <div className="wp-recent-bottom">
                      <span className="wp-recent-path">{r.path}</span>
                      {r.lastEditedAt && <span className="wp-recent-time">{timeAgo(r.lastEditedAt)}</span>}
                    </div>
                  </button>
                );
              }

              if (entry.type === 'cloud-only') {
                const { cloud: cw } = entry;
                return (
                  <div key={cw.id ?? cw.gitUrl} className="wp-recent-item wp-recent-item--cloud-only">
                    <div className="wp-recent-top">
                      <span className="wp-recent-name">{cw.name}</span>
                      <span className="wp-git-badge" title={cw.gitUrl}><GitBranch weight="thin" size={9} /> git</span>
                    </div>
                    <div className="wp-recent-bottom">
                      <span className="wp-recent-path">{cw.gitUrl}</span>
                      <span className="wp-recent-time">{timeAgo(cw.addedAt)}</span>
                    </div>
                    <button
                      className="wp-action-btn"
                      onClick={() => handleClone(cw)}
                      disabled={cloneBusy === cw.gitUrl}
                    >
                      {cloneBusy === cw.gitUrl ? 'Clonando…' : 'Clonar'}
                    </button>
                  </div>
                );
              }

              if (entry.type === 'local-git') {
                const { local: r } = entry;
                const uncom = uncommitted[r.path];
                return (
                  <div key={r.path} className="wp-recent-item wp-recent-item--row">
                    <button
                      className="wp-recent-item-inner"
                      onClick={() => handleOpenLocal(r)}
                      disabled={loading}
                    >
                      <div className="wp-recent-top">
                        <span className="wp-recent-name">{r.name}</span>
                        <div className="wp-badges">
                          {uncom != null && uncom > 0 && (
                            <span className="wp-recent-badge" title={`${uncom} uncommitted`}>{uncom}</span>
                          )}
                          <span className="wp-git-badge" title={r.gitRemote}><GitBranch weight="thin" size={9} /> git</span>
                        </div>
                      </div>
                      <div className="wp-recent-bottom">
                        <span className="wp-recent-path">{r.path}</span>
                        {r.lastEditedAt && <span className="wp-recent-time">{timeAgo(r.lastEditedAt)}</span>}
                      </div>
                    </button>
                    {userEmail && (
                      <button
                        className="wp-action-btn"
                        onClick={() => handleRegisterLocalGit(r)}
                        disabled={registerBusy === r.path}
                        title="Registrar na nuvem"
                      >
                        {registerBusy === r.path
                          ? '…'
                          : <><CloudArrowUp weight="thin" size={11} /> Nuvem</>}
                      </button>
                    )}
                  </div>
                );
              }

              // local-nogit
              const { local: r } = entry;
              const uncom = uncommitted[r.path];
              return (
                <div key={r.path} className="wp-recent-item wp-recent-item--row">
                  <button
                    className="wp-recent-item-inner"
                    onClick={() => handleOpenLocal(r)}
                    disabled={loading}
                  >
                    <div className="wp-recent-top">
                      <span className="wp-recent-name">{r.name}</span>
                      <div className="wp-badges">
                        {uncom != null && uncom > 0 && (
                          <span className="wp-recent-badge" title={`${uncom} uncommitted`}>{uncom}</span>
                        )}
                        <span className="wp-local-badge"><CloudSlash weight="thin" size={10} style={{ verticalAlign: 'middle' }} /> local</span>
                      </div>
                    </div>
                    <div className="wp-recent-bottom">
                      <span className="wp-recent-path">{r.path}</span>
                      {r.lastEditedAt && <span className="wp-recent-time">{timeAgo(r.lastEditedAt)}</span>}
                    </div>
                  </button>
                  {userEmail && (
                    <button
                      className="wp-action-btn"
                      onClick={() => openPublishForm(r)}
                      title="Publicar na nuvem"
                    >
                      <CloudArrowUp weight="thin" size={11} /> Nuvem
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Account section ── */}
        <div className="wp-account-section">
          {userEmail ? (
            <div className="wp-account-signed-in">
              <span className="wp-account-email">{userEmail}</span>
              <button className="wp-account-signout" onClick={handleSignOut} title="Sign out">
                <SignOut weight="thin" size={13} /> Sair
              </button>
            </div>
          ) : (
            <>
              <button
                className="wp-account-signin-btn"
                onClick={() => setAuthOpen((o) => !o)}
              >
                <SignIn weight="thin" size={13} />
                {authOpen ? 'Cancelar' : 'Entrar na conta'}
              </button>

              {authOpen && (
                <AuthScreen
                  supabase={supabase}
                  brand={{ name: 'Cafezin', subtitle: 'Just Chilling' }}
                  theme="dark"
                  features={{ google: true, apple: true, signUp: true, forgotPassword: true }}
                  redirectTo="cafezin://auth/callback"
                  openUrl={openUrl}
                  variant="panel"
                  onSuccess={async () => {
                    const user = await getUser();
                    setUserEmail(user?.email ?? null);
                    setAuthOpen(false);
                    await loadCloud();
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
