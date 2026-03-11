import { useState, useEffect } from 'react';
import { FolderOpen, Plus, SignIn, SignOut, Cloud, CloudSlash, CloudArrowUp, GitBranch, ArrowSquareOut } from '@phosphor-icons/react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { AuthScreen } from '@pvsmartinez/shared';
import { supabase } from '../services/supabase';
import { mkdir } from '../services/fs';
import { pickWorkspaceFolder, loadWorkspace, getRecents, removeRecent } from '../services/workspace';
import {
  getSession, getUser, signOut,
  listSyncedWorkspaces, registerWorkspace, registerWorkspaceByUrl,
  type SyncedWorkspace,
} from '../services/syncConfig';
import type { Workspace, RecentWorkspace } from '../types';
import './WorkspacePicker.css';
import { timeAgo } from '../utils/timeAgo';

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
  const [publishUrl, setPublishUrl] = useState('');
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

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
    setPublishPath(r.path);
    setPublishName(r.name);
    setPublishUrl('');
    setPublishError(null);
  }

  /** Set remote + register in Supabase for a local workspace with no git remote. */
  async function handlePublish() {
    if (!publishPath || !publishUrl.trim()) return;
    setPublishBusy(true);
    setPublishError(null);
    try {
      await invoke('git_set_remote', { path: publishPath, url: publishUrl.trim() });
      await registerWorkspaceByUrl(publishName, publishUrl.trim());
      await loadCloud();
      setPublishPath(null);
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
            <p className="wp-publish-label">Cole a URL do repositório remoto:</p>
            <input
              className="wp-auth-input"
              placeholder="https://github.com/usuario/repo.git"
              value={publishUrl}
              onChange={(e) => setPublishUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handlePublish(); if (e.key === 'Escape') setPublishPath(null); }}
              autoFocus
            />
            {publishError && <div className="wp-auth-error">{publishError}</div>}
            <div className="wp-publish-actions">
              <button className="wp-publish-cancel" onClick={() => setPublishPath(null)}>Cancelar</button>
              <button className="wp-btn-action wp-btn-action--primary wp-btn-action--sm" onClick={handlePublish} disabled={publishBusy || !publishUrl.trim()}>
                {publishBusy ? 'Salvando…' : <><CloudArrowUp weight="thin" size={13} /> Publicar</>}
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
