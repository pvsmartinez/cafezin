import { useState, useEffect, useCallback, useRef } from 'react';
import { Coffee, Folders, Robot, Microphone, ArrowDown, ArrowClockwise, ArrowsClockwise, House, FolderSimple, SignOut, ArrowRight, GithubLogo, Copy, CheckCircle, Warning } from '@phosphor-icons/react';
import { readTextFile, remapToCurrentDocDir } from './services/fs';
import { loadWorkspace } from './services/workspace';
import { useAuthSession } from './hooks/useAuthSession';
import { gitClone, gitPull, gitSync, getGitAccountToken, setLocalClonedPath, startGitAccountFlow, type SyncDeviceFlowState } from './services/syncConfig';
import { CONFIG_DIR } from './services/config';
import type { Workspace } from './types';
import { syncSecretsFromCloud } from './services/apiSecrets';
import MobileFileBrowser from './components/mobile/MobileFileBrowser';
import MobilePreview from './components/mobile/MobilePreview';
import MobileCopilot from './components/mobile/MobileCopilot';
import MobileVoiceMemo from './components/mobile/MobileVoiceMemo';
import ToastList from './components/mobile/ToastList';
import { useToast } from './hooks/useToast';
import { openUrl } from '@tauri-apps/plugin-opener';
import './mobile.css';

type Tab = 'files' | 'copilot' | 'voice'

const LAST_WS_KEY = 'mobile-last-workspace-path';

/**
 * Strip the config dir suffix if it was accidentally stored.
 * e.g. ".../book/cafezin" → ".../book"
 */
function sanitizeWsPath(p: string): string {
  const suffix = `/${CONFIG_DIR}`;
  return p.endsWith(suffix) ? p.slice(0, -suffix.length) : p;
}

/** Transforma erros técnicos do libgit2 em mensagens legíveis em português. */

function friendlyGitError(err: unknown): string {
  const raw = String(err);
  if (/Certificate|host key|hostkey|ssh.*23|code=-17/i.test(raw))
    return 'Não foi possível verificar o servidor SSH. Verifique sua conexão.';
  if (/Authentication|credential|auth/i.test(raw))
    return 'Falha de autenticação. Verifique o token ou chave SSH.';
  if (/not found|repository not found|does not exist/i.test(raw))
    return 'Repositório não encontrado. Confira a URL.';
  if (/timed? ?out|Operation.*timed/i.test(raw))
    return 'Tempo limite esgotado. Verifique sua conexão.';
  if (/network|could not resolve|name or service not known/i.test(raw))
    return 'Sem conexão com o servidor git. Verifique o Wi-Fi.';
  // fallback: mostra só a primeira linha para não poluir o toast
  return raw.split('\n')[0].replace(/^Error: /i, '').slice(0, 120);
}

export default function MobileApp() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loadingWs, setLoadingWs] = useState(true);
  const [wsError, setWsError] = useState<string | null>(null);

  // gitUrl → 'clone' | 'pull'
  const [gitBusy, setGitBusy] = useState<Record<string, 'clone' | 'pull'>>({});
  const [isSyncing, setIsSyncing] = useState(false);
  // gitUrl of the currently open workspace — used to find the token in handleSync
  const [wsGitUrl, setWsGitUrl] = useState<string | null>(null);

  // GitHub device flow state
  const [gitAuthBusy, setGitAuthBusy] = useState<string | null>(null); // account label currently authenticating
  const [gitAuthModal, setGitAuthModal] = useState<{ label: string; userCode: string; verificationUri: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [activeTab, setActiveTab] = useState<Tab>('files');
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);

  // Form state — local only, not part of auth business logic
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');

  const { toasts, toast, dismiss } = useToast();

  // Shell topbar scroll-hide (Safari-style)
  const screenRef = useRef<HTMLDivElement>(null);
  const [headerHidden, setHeaderHidden] = useState(false);
  const lastScrollY = useRef(0);
  useEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLElement;
      const y = target.scrollTop ?? 0;
      const delta = y - lastScrollY.current;
      if (delta > 6) {
        setHeaderHidden(true);
        lastScrollY.current = y;
      } else if (delta < -6) {
        setHeaderHidden(false);
        lastScrollY.current = y;
      }
    };
    el.addEventListener('scroll', handler, true);
    return () => el.removeEventListener('scroll', handler, true);
  }, []);

  const {
    isLoggedIn,
    oauthBusy,
    authBusy,
    authMode,
    setAuthMode,
    syncedWorkspaces,
    loadingSynced,
    syncError,
    loadSyncedList,
    handleAuth: _handleAuth,
    handleSignOut,
    handleOAuth: _handleOAuth,
  } = useAuthSession({
    onAuthSuccess: () => {
      toast({ message: 'Login realizado com sucesso!', type: 'success' });
      // Pull all synced secrets (Groq key, Copilot token, etc.) right after login
      void syncSecretsFromCloud();
    },
  });

  // Reload synced workspace list whenever auth state becomes active
  useEffect(() => {
    if (isLoggedIn) void loadSyncedList();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  // Pull secrets from cloud on startup (covers the case where the session
  // was already active from a previous launch — no login event fires)
  useEffect(() => { void syncSecretsFromCloud(); }, []);

  // ── Bootstrap: load last workspace from localStorage ─────────────────────
  useEffect(() => {
    const raw = localStorage.getItem(LAST_WS_KEY);
    if (raw) {
      const lastPath = sanitizeWsPath(raw);
      // Self-heal: overwrite if we stripped a bad suffix
      if (lastPath !== raw) localStorage.setItem(LAST_WS_KEY, lastPath);
      void openWorkspacePath(lastPath);
      return;
    }
    setLoadingWs(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Wraps hook handleAuth with toast feedback for the mobile UI. */
  async function handleAuth() {
    const err = await _handleAuth(emailInput.trim(), passwordInput.trim());
    if (err) {
      toast({ message: err, type: 'error', duration: 6000 });
    } else {
      setEmailInput('');
      setPasswordInput('');
      void loadSyncedList();
    }
  }

  /** Wraps hook handleOAuth with toast feedback for the mobile UI. */
  async function handleOAuth(provider: 'google' | 'apple') {
    const err = await _handleOAuth(provider);
    if (err) toast({ message: err, type: 'error', duration: 6000 });
  }

  async function openWorkspacePath(rawPath: string, gitUrl?: string) {
    const sanitized = sanitizeWsPath(rawPath);
    // Remap stale container UUID — the UUID changes between TestFlight builds
    const path = await remapToCurrentDocDir(sanitized);

    // Resolve gitUrl even when not passed (e.g. bootstrap from LAST_WS_KEY).
    // Match by exact localPath first, then by folder name as fallback.
    const repoFolderName = path.replace(/\/+$/, '').split('/').pop() ?? '';
    const resolvedGitUrl = gitUrl
      ?? syncedWorkspaces.find(w => w.localPath === sanitized || w.localPath === path)?.gitUrl
      ?? syncedWorkspaces.find(w => w.localPath?.replace(/\/+$/, '').split('/').pop() === repoFolderName)?.gitUrl
      ?? null;

    // Persist the remapped path for this git repo so handleSync / handlePull can
    // find it, and so the next Abrir/bootstrap uses the correct UUID immediately.
    if (resolvedGitUrl) {
      setLocalClonedPath(resolvedGitUrl, path);
      setWsGitUrl(resolvedGitUrl);
    } else if (gitUrl) {
      setWsGitUrl(gitUrl);
    }
    setLoadingWs(true);
    setWsError(null);
    try {
      const ws = await loadWorkspace(path);
      setWorkspace(ws);
      // Persist the remapped path so next boot uses the correct UUID
      localStorage.setItem(LAST_WS_KEY, path);

      // If the workspace has no git remote but we know the gitUrl, the repo was
      // re-init'd empty (UUID change + fresh install / data not migrated by iOS).
      // Clear localClonedPath so the picker shows "Clonar" instead of keeping the
      // user stuck in an empty workspace.
      if (ws.fileTree.length === 0 && !ws.hasGit && resolvedGitUrl) {
        setLocalClonedPath(resolvedGitUrl, '');
        await loadSyncedList();
        setWorkspace(null);
        localStorage.removeItem(LAST_WS_KEY);
        toast({ message: 'Repositório local não encontrado. Use Clonar para baixar novamente.', type: 'error', duration: null });
        return;
      }

      // If the workspace opened but is empty AND has a git remote, auto-pull.
      // This happens when the container UUID changes between builds and the local
      // repo needs a fast-forward pull to restore any files that are "missing"
      // (or when the SSH remote needs to be normalized to HTTPS first).
      if (ws.fileTree.length === 0 && ws.hasGit) {
        toast({ message: 'Workspace vazio — tentando sincronizar automaticamente…', type: 'info', duration: 4000 });
        try {
          // Find the token via resolvedGitUrl (set above, better than wsGitUrl state
          // which may not be updated yet since setState is async).
          const urlForToken = resolvedGitUrl ?? wsGitUrl;
          const wsEntry = urlForToken
            ? syncedWorkspaces.find(w => w.gitUrl === urlForToken)
            : syncedWorkspaces.find(w => {
                const n = path.replace(/\/+$/, '').split('/').pop();
                return w.localPath?.replace(/\/+$/, '').split('/').pop() === n;
              });
          const token = wsEntry ? (getGitAccountToken(wsEntry.gitAccountLabel) ?? undefined) : undefined;
          await gitPull(path, token);
          const refreshed = await loadWorkspace(path);
          setWorkspace(refreshed);
          if (refreshed.fileTree.length > 0) {
            toast({ message: 'Arquivos sincronizados!', type: 'success' });
          } else {
            toast({ message: `Workspace ainda vazio após pull. Caminho: ${path.split('/').slice(-3).join('/')}`, type: 'error', duration: null });
          }
        } catch (pullErr) {
          const pullErrStr = String(pullErr);
          if (/no_commits/i.test(pullErrStr)) {
            // Empty repo — re-init'd after UUID change or fresh install. Force re-clone.
            if (resolvedGitUrl) {
              setLocalClonedPath(resolvedGitUrl, '');
              await loadSyncedList();
            }
            setWorkspace(null);
            localStorage.removeItem(LAST_WS_KEY);
            toast({ message: 'Repositório local está vazio. Use Clonar para baixar novamente.', type: 'error', duration: null });
          } else {
            toast({ message: `Auto-pull falhou: ${friendlyGitError(pullErr)}`, type: 'error', duration: null });
          }
        }
      }
    } catch (err) {
      setWsError(`Could not open workspace: ${err}`);
    } finally {
      setLoadingWs(false);
    }
  }

  /** GitHub Device Flow: authenticate a git account label and store the token on device. */
  async function handleGitAuth(label: string) {
    setGitAuthBusy(label);
    setGitAuthModal(null);
    try {
      await startGitAccountFlow(label, (state: SyncDeviceFlowState) => {
        setGitAuthModal({ label, userCode: state.userCode, verificationUri: state.verificationUri });
      });
      setGitAuthModal(null);
      toast({ message: `Conta GitHub "${label}" conectada com sucesso!`, type: 'success' });
      await loadSyncedList();
    } catch (err) {
      setGitAuthModal(null);
      toast({ message: `Erro ao conectar GitHub: ${String(err).split('\n')[0]}`, type: 'error', duration: 8000 });
    } finally {
      setGitAuthBusy(null);
    }
  }

  function handleCopyCode(code: string) {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleClone(gitUrl: string, accountLabel: string, branch?: string) {
    setGitBusy(b => ({ ...b, [gitUrl]: 'clone' }));
    try {
      const token = getGitAccountToken(accountLabel) ?? undefined;
      const localPath = await gitClone(gitUrl, token, branch || undefined);
      // Auto-pull after clone to ensure we're on the latest commit of the branch
      try {
        await gitPull(localPath, token);
      } catch { /* ignore pull errors on fresh clone */ }
      toast({ message: 'Repositório clonado e sincronizado!', type: 'success' });
      // Reload list so localPath shows up, then open
      await loadSyncedList();
      void openWorkspacePath(localPath);
    } catch (err) {
      toast({ message: `Erro ao clonar: ${friendlyGitError(err)}`, type: 'error', duration: null });
    } finally {
      setGitBusy(b => { const n = { ...b }; delete n[gitUrl]; return n; });
    }
  }

  async function handlePull(gitUrl: string, rawLocalPath: string, accountLabel: string) {
    setGitBusy(b => ({ ...b, [gitUrl]: 'pull' }));
    // Remap stale /private/var/... or old-UUID paths before doing any git work
    const localPath = await remapToCurrentDocDir(rawLocalPath).catch(() => rawLocalPath);
    if (localPath !== rawLocalPath) setLocalClonedPath(gitUrl, localPath);
    try {
      const token = getGitAccountToken(accountLabel) ?? undefined;
      const result = await gitPull(localPath, token);
      const msg = result === 'up_to_date' ? 'Já está atualizado.' : 'Pull realizado com sucesso!';
      toast({ message: msg, type: 'success' });
      void refreshWorkspace();
    } catch (err) {
      const errStr = String(err);
      // If the local repo doesn't exist at all (UUID changed, etc.) clear the stored path
      // so the picker shows "Clonar" on the next render — allows the user to re-clone.
      if (/repository not found|could not find repository|not a git|no_commits/i.test(errStr)) {
        setLocalClonedPath(gitUrl, '');
        await loadSyncedList();
        toast({ message: 'Repositório local não encontrado ou vazio. Use Clonar para baixar novamente.', type: 'error', duration: null });
      } else {
        toast({ message: `Erro no pull: ${friendlyGitError(err)}`, type: 'error', duration: null });
      }
    } finally {
      setGitBusy(b => { const n = { ...b }; delete n[gitUrl]; return n; });
    }
  }

  /**
   * Mobile sync: pull latest + commit & push local changes.
   * "Sync" para os leigos = pull + push.
   */
  async function handleSync() {
    if (!workspace) return;
    setIsSyncing(true);
    try {
      // Find the git account label for this workspace.
      // Primary: match by gitUrl stored when the workspace was opened.
      // Fallback: match by localPath or by repo folder name (handles UUID-remapped paths).
      const repoName = workspace.path.replace(/\/+$/, '').split('/').pop();
      const ws = syncedWorkspaces.find(w =>
        (wsGitUrl && w.gitUrl === wsGitUrl) ||
        w.localPath === workspace.path ||
        (w.localPath && w.localPath.replace(/\/+$/, '').split('/').pop() === repoName) ||
        // Also match against stale UUID paths (before remap is stored back)
        (w.localPath && (() => {
          const m = w.localPath.match(/\/Documents\/(.+)$/);
          return m && workspace.path.endsWith(`/Documents/${m[1]}`);
        })())
      );
      const token = ws ? (getGitAccountToken(ws.gitAccountLabel) ?? undefined) : undefined;
      const result = await gitSync(workspace.path, token);
      const msg = result === 'synced' ? 'Sincronizado com sucesso!' : 'Já estava atualizado.';
      toast({ message: msg, type: 'success' });
      void refreshWorkspace();
    } catch (err) {
      toast({ message: `Erro ao sincronizar: ${friendlyGitError(err)}`, type: 'error', duration: null });
    } finally {
      setIsSyncing(false);
    }
  }



  // ── Refresh workspace file tree ──────────────────────────────────────────
  const refreshWorkspace = useCallback(async () => {
    if (!workspace) return;
    try {
      const ws = await loadWorkspace(workspace.path);
      setWorkspace(ws);
    } catch { /* not fatal */ }
  }, [workspace]);

  // ── File select ───────────────────────────────────────────────────────────
  async function handleFileSelect(relPath: string) {
    setOpenFile(relPath);
    // Stay on 'files' tab — preview renders inline via push navigation
    // Pre-load content for Copilot context (text files only, max 8KB)
    if (workspace) {
      try {
        const absPath = `${workspace.path}/${relPath}`;
        const content = await readTextFile(absPath);
        setFileContent(content.slice(0, 20_000));
      } catch {
        setFileContent(null);
      }
    }
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loadingWs) {
    return (
      <div className="mb-shell fixed inset-0 flex flex-col overflow-hidden bg-app-bg">
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="spinner" />
          <div className="text-sm text-muted">Loading workspace…</div>
        </div>
      </div>
    );
  }

  // ── No workspace: show connect screen ────────────────────────────────────
  if (!workspace) {
    // ── Not signed in — email + password form ────────────────────────────
    if (!isLoggedIn) {
      return (
        <div className="mb-shell fixed inset-0 flex flex-col overflow-hidden bg-app-bg">
          <ToastList toasts={toasts} onDismiss={dismiss} />
          <div className="flex-1 overflow-y-auto scroll-touch flex flex-col">
            <div className="flex flex-col items-center gap-5 px-6 py-10 text-center flex-1">
              <div className="opacity-30"><Coffee weight="thin" size={48} /></div>
              <div className="text-xl font-semibold">Bem-vindo ao Cafezin</div>
              <div className="text-sm text-muted max-w-[280px] leading-[1.55]">
                Entre com sua conta para acessar seus workspaces.
              </div>

              {/* ── OAuth providers ── */}
              <div className="flex gap-2.5 w-full max-w-[300px]">
                <button
                  className="btn-secondary flex-1 text-sm"
                  onClick={() => void handleOAuth('google')}
                  disabled={oauthBusy !== null}
                >
                  {oauthBusy === 'google'
                    ? <><div className="spinner w-4 h-4" /> Aguarde</>
                    : 'Google'
                  }
                </button>
                <button
                  className="btn-secondary flex-1 text-sm"
                  onClick={() => void handleOAuth('apple')}
                  disabled={oauthBusy !== null}
                >
                  {oauthBusy === 'apple'
                    ? <><div className="spinner w-4 h-4" /> Aguarde</>
                    : '\u{F8FF} Apple'
                  }
                </button>
              </div>

              {oauthBusy !== null && (
                <div className="text-xs text-muted text-center max-w-[300px]">
                  Aguardando autorização no navegador…
                </div>
              )}

              <div className="flex items-center gap-2.5 text-white/30 text-xs w-full max-w-[300px]">
                <div className="flex-1 h-px bg-white/[0.1]" />
                ou
                <div className="flex-1 h-px bg-white/[0.1]" />
              </div>

              <div className="flex rounded-lg overflow-hidden border border-white/[0.12] w-full max-w-[300px]">
                <button
                  className={`flex-1 py-2.5 text-sm font-semibold border-0 cursor-pointer transition-opacity active:opacity-75 ${authMode === 'login' ? 'bg-accent text-white' : 'bg-transparent text-muted'}`}
                  onClick={() => { setAuthMode('login') }}
                >Entrar</button>
                <button
                  className={`flex-1 py-2.5 text-sm font-semibold border-0 cursor-pointer transition-opacity active:opacity-75 ${authMode === 'signup' ? 'bg-accent text-white' : 'bg-transparent text-muted'}`}
                  onClick={() => { setAuthMode('signup') }}
                >Criar conta</button>
              </div>

              <input
                type="email"
                placeholder="seu@email.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="w-full max-w-[300px] px-[14px] py-[10px] bg-white/[0.08] border border-white/[0.15] rounded-lg text-white text-[15px] outline-none placeholder:text-white/40"
              />
              <input
                type="password"
                placeholder="Senha"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleAuth() }}
                className="w-full max-w-[300px] px-[14px] py-[10px] bg-white/[0.08] border border-white/[0.15] rounded-lg text-white text-[15px] outline-none placeholder:text-white/40"
              />

              {authBusy && (
                <div className="text-xs text-muted">Conectando…</div>
              )}

              <button
                className="btn-primary w-full max-w-[300px]"
                onClick={() => void handleAuth()}
                disabled={authBusy || !emailInput.trim() || !passwordInput.trim()}
              >
                {authBusy
                  ? <><div className="spinner w-4 h-4" /> Aguarde…</>
                  : authMode === 'login' ? 'Entrar com e-mail' : 'Criar conta'
                }
              </button>
            </div>
          </div>
        </div>
      )
    }

    // ── Signed in — show workspace list ───────────────────────────────────
    // Collect unique account labels that need a token
    const uniqueLabels = [...new Set(syncedWorkspaces.map(w => w.gitAccountLabel))];
    const labelsNeedingAuth = uniqueLabels.filter(l => !getGitAccountToken(l));

    return (
      <div className="mb-shell fixed inset-0 flex flex-col overflow-hidden bg-app-bg">
        <ToastList toasts={toasts} onDismiss={dismiss} />

        {/* ── GitHub Device Flow modal ── */}
        {gitAuthModal && (
          <div className="fixed inset-0 z-[999] bg-black/85 flex items-center justify-center px-6">
            <div className="bg-surface border border-app-border rounded-2xl py-7 px-6 max-w-[360px] w-full flex flex-col gap-4 items-center">
              <GithubLogo size={40} weight="thin" className="opacity-80" />
              <div className="text-lg font-bold text-center">Conectar GitHub</div>
              <div className="text-[13px] text-muted text-center">
                Acesse <strong className="text-app-text">github.com/login/device</strong> e insira o código abaixo:
              </div>
              <div className="font-mono text-[32px] font-bold tracking-[0.25em] text-accent px-5 py-3 bg-white/[0.06] rounded-[10px] border border-white/[0.12]">
                {gitAuthModal.userCode}
              </div>
              <div className="flex gap-2 w-full">
                <button
                  className="btn-primary flex-1 text-sm"
                  onClick={() => void openUrl(gitAuthModal.verificationUri)}
                >
                  <GithubLogo size={16} /> Abrir GitHub
                </button>
                <button
                  className="btn-secondary text-sm px-[14px]"
                  onClick={() => handleCopyCode(gitAuthModal.userCode)}
                >
                  {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <div className="flex items-center gap-2 text-muted text-xs">
                <div className="spinner w-3 h-3" />
                Aguardando autorização…
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto scroll-touch flex flex-col">
          <div className="flex flex-col items-center gap-4 px-6 py-10 text-center flex-1">
            <div className="opacity-30"><Folders weight="thin" size={48} /></div>
            <div className="text-xl font-semibold">Workspaces</div>

            {wsError && (
              <div className="bg-[rgba(var(--red-rgb),0.15)] border border-[rgba(var(--red-rgb),0.3)] text-danger rounded-lg px-[14px] py-[10px] text-[13px] max-w-[300px] text-left">
                {wsError}
              </div>
            )}

            {syncError && (
              <div className="bg-[rgba(var(--red-rgb),0.15)] border border-[rgba(var(--red-rgb),0.3)] text-danger rounded-lg px-[14px] py-[10px] text-[13px] max-w-[300px] text-left">
                Could not load workspaces: {syncError}
              </div>
            )}

            {loadingSynced && (
              <div className="flex items-center gap-2.5 text-muted text-[13px]">
                <div className="spinner w-4 h-4" />
                Loading workspaces…
              </div>
            )}

            {/* ── GitHub accounts that need authentication ── */}
            {!loadingSynced && labelsNeedingAuth.length > 0 && (
              <div className="w-full max-w-[360px] bg-[rgba(255,165,0,0.08)] border border-[rgba(255,165,0,0.25)] rounded-xl px-[14px] py-3 flex flex-col gap-2.5">
                <div className="flex items-center gap-2 text-[13px] font-semibold">
                  <Warning size={16} color="var(--mb-warning, #e8a020)" />
                  Conta GitHub não conectada
                </div>
                <div className="text-xs text-muted text-left">
                  Para clonar e sincronizar repositórios privados, conecte sua conta GitHub a este dispositivo.
                </div>
                {labelsNeedingAuth.map(label => (
                  <button
                    key={label}
                    className="btn-secondary text-[13px] py-[7px]"
                    onClick={() => void handleGitAuth(label)}
                    disabled={gitAuthBusy !== null}
                  >
                    {gitAuthBusy === label
                      ? <><div className="spinner w-3.5 h-3.5" /> Aguarde…</>
                      : <><GithubLogo size={16} /> Conectar conta "{label}"</>
                    }
                  </button>
                ))}
              </div>
            )}

            {!loadingSynced && syncedWorkspaces.length > 0 && (
              <div className="w-full max-w-[360px] flex flex-col gap-2.5">
                {syncedWorkspaces.map(ws => {
                  const canOpen = !!ws.localPath;
                  const busy = gitBusy[ws.gitUrl];
                  const hasToken = !!getGitAccountToken(ws.gitAccountLabel);
                  return (
                    <div
                      key={ws.gitUrl}
                      className={`bg-white/[0.05] rounded-xl px-[14px] py-3 flex flex-col gap-1 border ${!hasToken ? 'border-[rgba(255,165,0,0.3)]' : 'border-white/[0.1]'}`}
                    >
                      <div className="font-semibold text-[15px]">{ws.name}</div>
                      <div className="text-[11px] text-muted break-all">{ws.gitUrl}</div>
                      {!hasToken && (
                        <div className="text-[11px] text-[#e8a020] flex items-center gap-1 mt-0.5">
                          <Warning size={12} /> Token GitHub não configurado — conecte a conta acima
                        </div>
                      )}
                      {canOpen ? (
                        <div className="mt-1.5 flex gap-2">
                          <button
                            className="btn-primary flex-1 text-[13px] py-1.5"
                            onClick={() => void openWorkspacePath(ws.localPath!, ws.gitUrl)}
                            disabled={!!busy}
                          >
                            <ArrowRight size={14} /> Abrir
                          </button>
                          <button
                            className="btn-secondary text-[13px] py-1.5 px-[14px]"
                            onClick={() => void handlePull(ws.gitUrl, ws.localPath!, ws.gitAccountLabel)}
                            disabled={!!busy}
                          >
                            {busy === 'pull'
                              ? <><div className="spinner w-3 h-3" /> Pull…</>
                              : <><ArrowDown size={14} /> Pull</>
                            }
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn-secondary mt-1.5 text-[13px] py-1.5"
                          onClick={() => void handleClone(ws.gitUrl, ws.gitAccountLabel, ws.branch)}
                          disabled={!!busy || !hasToken}
                        >
                          {busy === 'clone'
                            ? <><div className="spinner w-3 h-3" /> Clonando…</>
                            : <><ArrowDown size={14} /> Clonar</>
                          }
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!loadingSynced && syncedWorkspaces.length === 0 && !syncError && (
              <div className="text-sm text-muted max-w-[280px] leading-[1.55]">
                No workspaces registered yet. Open Settings → Sync on your desktop to register one.
              </div>
            )}

            <button
              className="btn-ghost mt-1 text-sm"
              onClick={loadSyncedList}
            >
              <ArrowClockwise size={15} /> Atualizar
            </button>

            <button
              className="btn-ghost text-[13px] text-muted"
              onClick={() => void handleSignOut()}
            >
              <SignOut size={14} /> Sair da conta
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main app ──────────────────────────────────────────────────────────────
  function renderTab() {
    switch (activeTab) {
      case 'files':
        // Push-navigation pattern: preview slides in when a file is open
        if (openFile) {
          return (
            <MobilePreview
              workspacePath={workspace!.path}
              filePath={openFile}
              features={workspace!.config.features}
              onClear={() => setOpenFile(null)}
            />
          );
        }
        return (
          <MobileFileBrowser
            fileTree={workspace!.fileTree}
            selectedPath={openFile ?? undefined}
            onFileSelect={handleFileSelect}
            onBack={() => { setWorkspace(null); setWsGitUrl(null); }}
          />
        );

      case 'copilot':
        return (
          <MobileCopilot
            workspace={workspace}
            contextFilePath={openFile ?? undefined}
            contextFileContent={fileContent ?? undefined}
            onFileWritten={refreshWorkspace}
          />
        );

      case 'voice':
        return <MobileVoiceMemo workspacePath={workspace!.path} />;
    }
  }

  return (
    <div className="mb-shell fixed inset-0 flex flex-col overflow-hidden bg-app-bg">
      <ToastList toasts={toasts} onDismiss={dismiss} />

      {/* Shell-level workspace topbar — overlay (Safari-style), always on top */}
      {workspace && (
        <div
          className={`fixed left-0 right-0 z-50 flex items-center gap-2 px-4 backdrop-glass border-b border-app-border bg-surface/80 transition-transform duration-300 ${headerHidden ? '-translate-y-full' : 'translate-y-0'}`}
          style={{
            top: 0,
            height: 'calc(var(--mb-topbar-h) + env(safe-area-inset-top, 0px))',
            paddingTop: 'env(safe-area-inset-top, 0px)',
          }}
        >
          <button
            className="icon-btn"
            onClick={() => { setWorkspace(null); setWsGitUrl(null); }}
            title="Trocar workspace"
          >
            <House weight="thin" size={18} />
          </button>
          <span className="text-muted flex">
            <FolderSimple weight="thin" size={20} />
          </span>
          <span className="flex-1 text-[15px] font-semibold truncate text-app-text">{workspace.name}</span>
          {workspace.hasGit && (
            <button
              className="icon-btn flex items-center gap-1 text-[13px] px-[10px] py-1 rounded-md"
              onClick={() => void handleSync()}
              disabled={isSyncing}
              title="Sincronizar (pull + push)"
            >
              {isSyncing
                ? <><div className="spinner w-3 h-3" /> Sincronizando…</>
                : <><ArrowsClockwise weight="thin" size={16} /> Sync</>
              }
            </button>
          )}
          <button
            className="icon-btn"
            onClick={refreshWorkspace}
            title="Atualizar"
            disabled={isSyncing}
          >
            <ArrowClockwise weight="thin" size={18} />
          </button>
        </div>
      )}

      <div
        className="flex-1 overflow-hidden flex flex-col"
        ref={screenRef}
        style={workspace ? { paddingTop: 'calc(var(--mb-topbar-h) + env(safe-area-inset-top, 0px))' } : undefined}
      >
        {renderTab()}
      </div>

      <nav
        className="shrink-0 flex bg-surface border-t border-app-border"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <button
          className={`flex flex-col items-center justify-center flex-1 gap-0.5 py-2 border-0 bg-transparent cursor-pointer transition-colors ${activeTab === 'files' ? 'text-accent' : 'text-muted'}`}
          onClick={() => {
            if (activeTab === 'files' && openFile) { setOpenFile(null); return; }
            setActiveTab('files');
          }}
        >
          <span className="leading-none"><Folders weight="thin" size={22} /></span>
          <span className="text-[10px] font-medium">Arquivos</span>
        </button>
        <button
          className={`flex flex-col items-center justify-center flex-1 gap-0.5 py-2 border-0 bg-transparent cursor-pointer transition-colors ${activeTab === 'copilot' ? 'text-accent' : 'text-muted'}`}
          onClick={() => setActiveTab('copilot')}
        >
          <span className="leading-none"><Robot weight="thin" size={22} /></span>
          <span className="text-[10px] font-medium">Copilot</span>
        </button>
        <button
          className={`flex flex-col items-center justify-center flex-1 gap-0.5 py-2 border-0 bg-transparent cursor-pointer transition-colors ${activeTab === 'voice' ? 'text-accent' : 'text-muted'}`}
          onClick={() => setActiveTab('voice')}
        >
          <span className="leading-none"><Microphone weight="thin" size={22} /></span>
          <span className="text-[10px] font-medium">Voz</span>
        </button>
      </nav>
    </div>
  );
}
