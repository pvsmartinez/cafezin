import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Check, CloudArrowUp, GithubLogo, GearSix, Globe, X } from '@phosphor-icons/react';
import type { ToastType } from '../../hooks/useToast';
import type { Workspace } from '../../types';
import {
  createGitHubRepo,
  getGitAccountToken,
  registerWorkspace,
  registerWorkspaceByUrl,
  startGitAccountFlow,
  type SyncDeviceFlowState,
} from '../../services/syncConfig';
import { getActiveProvider, getProviderKey, PROVIDER_LABELS, type AIProviderType } from '../../services/aiProvider';
import { saveApiSecret } from '../../services/apiSecrets';
import { loadWorkspace } from '../../services/workspace';

const DEFAULT_GIT_ACCOUNT_LABEL = 'personal';

const PROVIDER_KEY_MAP: Record<Exclude<AIProviderType, 'copilot'>, string> = {
  openai: 'cafezin-openai-key',
  anthropic: 'cafezin-anthropic-key',
  groq: 'cafezin-groq-key',
};

function sanitizeRepoName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

interface MobileSettingsSheetProps {
  open: boolean;
  workspace: Workspace | null;
  isLoggedIn: boolean;
  onClose: () => void;
  onWorkspaceUpdated: (workspace: Workspace, gitUrl?: string | null) => void;
  onRefreshSyncedList: () => Promise<void>;
  toast: (options: { message: string; type?: ToastType; duration?: number | null }) => number;
}

export default function MobileSettingsSheet({
  open,
  workspace,
  isLoggedIn,
  onClose,
  onWorkspaceUpdated,
  onRefreshSyncedList,
  toast,
}: MobileSettingsSheetProps) {
  const [aiProvider, setAIProvider] = useState<AIProviderType>('copilot');
  const [providerKey, setProviderKey] = useState('');
  const [vercelToken, setVercelToken] = useState('');
  const [savedSection, setSavedSection] = useState<'provider' | 'vercel' | null>(null);

  const [gitFlowBusy, setGitFlowBusy] = useState(false);
  const [gitFlowState, setGitFlowState] = useState<SyncDeviceFlowState | null>(null);

  const [publishRepoName, setPublishRepoName] = useState('');
  const [publishPrivateRepo, setPublishPrivateRepo] = useState(true);
  const [publishBusy, setPublishBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedMode, setAdvancedMode] = useState<'create' | 'existing'>('create');
  const [advancedUrl, setAdvancedUrl] = useState('');

  useEffect(() => {
    if (!open) return;
    const provider = getActiveProvider();
    setAIProvider(provider);
    setProviderKey(provider === 'copilot' ? '' : getProviderKey(provider));
    setVercelToken(localStorage.getItem('cafezin-vercel-token') ?? '');
    setPublishRepoName(sanitizeRepoName(workspace?.name ?? 'workspace'));
    setPublishPrivateRepo(true);
    setGitFlowState(null);
    setSavedSection(null);
    setShowAdvanced(false);
    setAdvancedMode('create');
    setAdvancedUrl('');
  }, [open, workspace?.name]);

  const providerHelpUrl = useMemo(() => {
    if (aiProvider === 'openai') return 'https://platform.openai.com/api-keys';
    if (aiProvider === 'anthropic') return 'https://console.anthropic.com/settings/keys';
    if (aiProvider === 'groq') return 'https://console.groq.com/keys';
    return 'https://github.com/settings/copilot';
  }, [aiProvider]);

  if (!open) return null;

  async function ensureGitHubToken(label: string): Promise<string> {
    const existing = getGitAccountToken(label);
    if (existing) return existing;

    setGitFlowBusy(true);
    try {
      const token = await startGitAccountFlow(label, (state) => setGitFlowState(state));
      setGitFlowState(null);
      return token;
    } finally {
      setGitFlowBusy(false);
    }
  }

  function handleSaveProvider() {
    localStorage.setItem('cafezin-ai-provider', aiProvider);
    void saveApiSecret('cafezin-ai-provider', aiProvider);

    if (aiProvider !== 'copilot') {
      void saveApiSecret(PROVIDER_KEY_MAP[aiProvider], providerKey.trim());
    }

    setSavedSection('provider');
    setTimeout(() => setSavedSection((current) => current === 'provider' ? null : current), 1800);
    toast({ message: 'Configuração de IA salva neste dispositivo.', type: 'success' });
  }

  function handleSaveVercelToken() {
    void saveApiSecret('cafezin-vercel-token', vercelToken.trim());
    setSavedSection('vercel');
    setTimeout(() => setSavedSection((current) => current === 'vercel' ? null : current), 1800);
    toast({ message: 'Token da Vercel salvo.', type: 'success' });
  }

  async function handleConnectGitAccount() {
    try {
      await ensureGitHubToken(DEFAULT_GIT_ACCOUNT_LABEL);
      toast({ message: 'Conta GitHub conectada.', type: 'success' });
    } catch (err) {
      toast({ message: `Falha ao conectar GitHub: ${String(err)}`, type: 'error', duration: null });
    }
  }

  async function refreshWorkspaceAfterGitChange(gitUrl?: string | null) {
    if (!workspace) return;
    const refreshed = await loadWorkspace(workspace.path);
    onWorkspaceUpdated(refreshed, gitUrl ?? null);
  }

  async function handleActivateSync() {
    if (!workspace) return;
    setPublishBusy(true);
    try {
      let gitUrl: string;
      if (showAdvanced && advancedMode === 'existing') {
        gitUrl = advancedUrl.trim();
        if (!gitUrl) throw new Error('Informe a URL do repositório');
      } else {
        const repoName = showAdvanced ? sanitizeRepoName(publishRepoName) : sanitizeRepoName(workspace.name);
        const isPrivate = showAdvanced ? publishPrivateRepo : true;
        const token = await ensureGitHubToken(DEFAULT_GIT_ACCOUNT_LABEL);
        const repo = await createGitHubRepo(repoName, isPrivate, token);
        gitUrl = repo.cloneUrl;
      }
      const authToken = getGitAccountToken(DEFAULT_GIT_ACCOUNT_LABEL) ?? undefined;
      await invoke('git_set_remote', { path: workspace.path, url: gitUrl });
      if (authToken) {
        await invoke('git_sync', {
          path: workspace.path,
          message: 'Initial commit from Cafezin',
          token: authToken,
        });
      }
      await registerWorkspaceByUrl(workspace.name, gitUrl, DEFAULT_GIT_ACCOUNT_LABEL).catch(() => null);
      await onRefreshSyncedList().catch(() => {});
      await refreshWorkspaceAfterGitChange(gitUrl);
      toast({ message: 'Sync ativado! Workspace conectado ao GitHub.', type: 'success' });
      onClose();
    } catch (err) {
      toast({ message: `Falha ao ativar sync: ${String(err)}`, type: 'error', duration: null });
    } finally {
      setPublishBusy(false);
    }
  }

  async function handleRegisterCurrentWorkspace() {
    if (!workspace?.hasGit) return;
    setPublishBusy(true);
    try {
      const entry = await registerWorkspace(workspace.path, workspace.name, DEFAULT_GIT_ACCOUNT_LABEL);
      await onRefreshSyncedList().catch(() => {});
      await refreshWorkspaceAfterGitChange(entry?.gitUrl ?? null);
      toast({ message: 'Workspace atualizado na lista do Cafezin.', type: 'success' });
    } catch (err) {
      toast({ message: `Falha ao registrar workspace: ${String(err)}`, type: 'error', duration: null });
    } finally {
      setPublishBusy(false);
    }
  }

  return (
    <div className="mb-overlay fixed inset-0 z-[1000] flex items-end justify-center px-4 pb-[calc(16px+env(safe-area-inset-bottom,0px))]" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="mb-card flex w-full max-w-[460px] max-h-[82vh] flex-col overflow-hidden rounded-[22px] border border-app-border bg-surface">
        <div className="flex items-center gap-2 border-b border-app-border px-4 py-3">
          <GearSix size={18} />
          <span className="flex-1 text-[16px] font-semibold">Ajustes do mobile</span>
          <button className="icon-btn" onClick={onClose} title="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scroll-touch px-4 py-4">
          <div className="mb-card mb-4 flex flex-col gap-3 rounded-2xl p-4">
            <div>
              <div className="text-[13px] font-semibold text-app-text">Chaves e provedor de IA</div>
              <div className="mt-1 text-[12px] leading-[1.5] text-muted">
                Igual ao desktop: escolha o provedor e salve sua chave neste dispositivo.
              </div>
            </div>

            <label className="flex flex-col gap-1.5 text-[12px] text-muted">
              <span>Provedor</span>
              <select
                className="mb-input rounded-xl px-3 py-3 text-[14px] outline-none"
                value={aiProvider}
                onChange={(event) => {
                  const next = event.target.value as AIProviderType;
                  setAIProvider(next);
                  setProviderKey(next === 'copilot' ? '' : getProviderKey(next));
                }}
              >
                {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>

            {aiProvider === 'copilot' ? (
              <div className="rounded-xl border border-app-border bg-surface-2 px-3 py-3 text-[12px] leading-[1.5] text-muted">
                O login do Copilot continua sendo feito pela aba Copilot. Aqui você só escolhe o provedor padrão.
              </div>
            ) : (
              <label className="flex flex-col gap-1.5 text-[12px] text-muted">
                <span>Chave da API</span>
                <input
                  type="password"
                  className="mb-input rounded-xl px-3 py-3 text-[14px] outline-none"
                  value={providerKey}
                  onChange={(event) => setProviderKey(event.target.value)}
                  placeholder={aiProvider === 'openai' ? 'sk-...' : aiProvider === 'anthropic' ? 'sk-ant-...' : 'gsk_...'}
                />
              </label>
            )}

            <div className="flex items-center gap-2">
              <button className="btn-primary flex-1 text-[14px]" onClick={handleSaveProvider}>
                {savedSection === 'provider' ? <><Check size={14} /> Salvo</> : 'Salvar IA'}
              </button>
              <button
                className="btn-secondary px-4 text-[14px]"
                onClick={() => openUrl(providerHelpUrl).catch(() => window.open(providerHelpUrl, '_blank', 'noopener,noreferrer'))}
              >
                <Globe size={14} /> Abrir
              </button>
            </div>
          </div>

          <div className="mb-card mb-4 flex flex-col gap-3 rounded-2xl p-4">
            <div>
              <div className="text-[13px] font-semibold text-app-text">Vercel token</div>
              <div className="mt-1 text-[12px] leading-[1.5] text-muted">
                Mesmo token global do desktop para export e publish.
              </div>
            </div>

            <input
              type="password"
              className="mb-input rounded-xl px-3 py-3 text-[14px] outline-none"
              value={vercelToken}
              onChange={(event) => setVercelToken(event.target.value)}
              placeholder="vercel_..."
            />

            <button className="btn-primary text-[14px]" onClick={handleSaveVercelToken}>
              {savedSection === 'vercel' ? <><Check size={14} /> Salvo</> : 'Salvar Vercel token'}
            </button>
          </div>

          {workspace && (
            <div className="mb-card flex flex-col gap-3 rounded-2xl p-4">
              <div>
                <div className="text-[13px] font-semibold text-app-text">Sync deste workspace</div>
                <div className="mt-1 text-[12px] leading-[1.5] text-muted">
                  {workspace.hasGit
                    ? 'Sync ativado — workspace conectado ao GitHub.'
                    : 'Ative o sync para acessar este workspace em todos os seus dispositivos.'}
                </div>
              </div>

              {workspace.hasGit ? (
                <>
                  <div className="flex items-center gap-2 rounded-xl border border-app-border bg-surface-2 px-3 py-3 text-[13px]">
                    <Check size={14} weight="bold" className="text-accent" />
                    <span>Sync ativo</span>
                  </div>
                  {isLoggedIn && (
                    <button
                      className="btn-secondary text-[13px]"
                      onClick={() => void handleRegisterCurrentWorkspace()}
                      disabled={publishBusy}
                    >
                      {publishBusy
                        ? <><div className="spinner w-4 h-4" /> Atualizando…</>
                        : <><CloudArrowUp size={14} /> Atualizar lista do Cafezin</>}
                    </button>
                  )}
                </>
              ) : (
                <>
                  {gitFlowState && (
                    <div className="rounded-xl border border-app-border bg-surface-2 px-3 py-3 text-[12px] leading-[1.5] text-muted">
                      <div>Abra o GitHub e insira este código:</div>
                      <div className="device-flow-code mt-2 text-[24px] font-semibold tracking-[0.18em] text-accent">{gitFlowState.userCode}</div>
                      <button
                        className="btn-secondary mt-3 w-full text-[13px]"
                        onClick={() => openUrl(gitFlowState.verificationUri).catch(() => window.open(gitFlowState.verificationUri, '_blank', 'noopener,noreferrer'))}
                      >
                        <GithubLogo size={14} /> Abrir GitHub
                      </button>
                    </div>
                  )}

                  <button
                    className="btn-primary text-[14px]"
                    onClick={() => void handleActivateSync()}
                    disabled={publishBusy || gitFlowBusy}
                  >
                    {(publishBusy || gitFlowBusy)
                      ? <><div className="spinner w-4 h-4" /> {gitFlowBusy ? 'Aguardando GitHub…' : 'Ativando sync…'}</>
                      : <><CloudArrowUp size={14} /> Ativar sync</>}
                  </button>

                  <button
                    className="btn-secondary text-[12px]"
                    onClick={() => setShowAdvanced((v) => !v)}
                  >
                    {showAdvanced ? '▲ Ocultar opções avançadas' : '▼ Opções avançadas'}
                  </button>

                  {showAdvanced && (
                    <div className="flex flex-col gap-3 rounded-xl border border-app-border bg-surface-2 p-3">
                      <div className="flex gap-2">
                        <button
                          className={`btn-secondary flex-1 text-[12px] ${advancedMode === 'create' ? 'border-accent text-accent' : ''}`}
                          onClick={() => setAdvancedMode('create')}
                        >
                          Criar repo
                        </button>
                        <button
                          className={`btn-secondary flex-1 text-[12px] ${advancedMode === 'existing' ? 'border-accent text-accent' : ''}`}
                          onClick={() => setAdvancedMode('existing')}
                        >
                          URL existente
                        </button>
                      </div>

                      {advancedMode === 'create' ? (
                        <>
                          <label className="flex flex-col gap-1.5 text-[11px] text-muted">
                            <span>Nome do repositório (GitHub)</span>
                            <input
                              className="mb-input rounded-xl px-3 py-2.5 text-[13px] outline-none"
                              value={publishRepoName}
                              onChange={(event) => setPublishRepoName(sanitizeRepoName(event.target.value))}
                              placeholder="nome-do-repositorio"
                            />
                          </label>
                          <div className="flex gap-2 text-[12px]">
                            <button
                              className={`btn-secondary flex-1 ${publishPrivateRepo ? 'border-accent text-accent' : ''}`}
                              onClick={() => setPublishPrivateRepo(true)}
                            >
                              🔒 Privado
                            </button>
                            <button
                              className={`btn-secondary flex-1 ${!publishPrivateRepo ? 'border-accent text-accent' : ''}`}
                              onClick={() => setPublishPrivateRepo(false)}
                            >
                              🌐 Público
                            </button>
                          </div>
                        </>
                      ) : (
                        <label className="flex flex-col gap-1.5 text-[11px] text-muted">
                          <span>URL do repositório existente</span>
                          <input
                            className="mb-input rounded-xl px-3 py-2.5 text-[13px] outline-none"
                            value={advancedUrl}
                            onChange={(event) => setAdvancedUrl(event.target.value)}
                            placeholder="https://github.com/usuario/repo.git"
                          />
                        </label>
                      )}

                      <div className="flex items-center justify-between border-t border-app-border pt-2 text-[11px] text-muted">
                        <span>Conta GitHub: {getGitAccountToken(DEFAULT_GIT_ACCOUNT_LABEL) ? 'conectada ✓' : 'não conectada'}</span>
                        <button
                          className="text-accent underline-offset-2 hover:underline"
                          onClick={() => void handleConnectGitAccount()}
                          disabled={gitFlowBusy}
                        >
                          {gitFlowBusy ? 'conectando…' : 'reconectar'}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}