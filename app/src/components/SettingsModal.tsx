import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { GearSix, X } from '@phosphor-icons/react';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  getActiveProvider, setActiveProvider, getActiveModel, setActiveModel,
  getProviderKey, PROVIDER_LABELS, PROVIDER_MODELS, PROVIDER_DEFAULT_MODELS,
  type AIProviderType,
} from '../services/aiProvider';
import { resolveCopilotModelForChatCompletions } from '../services/copilot';
import { writeTextFile } from '../services/fs';
import { saveWorkspaceConfig } from '../services/workspace';
import {
  signIn, signUp, signOut, getUser,
  startGitAccountFlow,
  listSyncedWorkspaces, registerWorkspace, unregisterWorkspace,
  listGitAccountLabels,
  type SyncDeviceFlowState, type SyncedWorkspace,
} from '../services/syncConfig'
import type { Workspace, AppSettings, SidebarButton, VercelWorkspaceConfig, WorkspaceFeatureConfig } from '../types';
import { saveApiSecret } from '../services/apiSecrets';
import { createCheckoutUrl, createCustomerPortalUrl } from '../services/accountService';
import { useAccountState } from '../hooks/useAccountState';
import './SettingsModal.css';

interface SettingsModalProps {
  open: boolean;
  appSettings: AppSettings;
  workspace: Workspace | null;
  onAppSettingsChange: (s: AppSettings) => void;
  onWorkspaceChange: (ws: Workspace) => void;
  onClose: () => void;
  /** Open directly on a specific tab. Defaults to 'general'. */
  initialTab?: Tab;
}

type Tab = 'general' | 'workspace' | 'sync' | 'account';

const FONT_OPTIONS = [
  { label: 'Pequena (13px)', value: 13 },
  { label: 'Média (14px)', value: 14 },
  { label: 'Grande (15px)', value: 15 },
  { label: 'Extra grande (16px)', value: 16 },
];

const AUTOSAVE_OPTIONS = [
  { label: 'Rápido (500ms)', value: 500 },
  { label: 'Normal (1s)', value: 1000 },
  { label: 'Lento (2s)', value: 2000 },
  { label: 'Manual (desligado)', value: 0 },
];

export default function SettingsModal({
  open,
  appSettings,
  workspace,
  onAppSettingsChange,
  onWorkspaceChange,
  onClose,
  initialTab,
}: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'general');

  // Respect initialTab changes (e.g. first-launch opens directly on sync)
  useEffect(() => {
    if (open) setTab(initialTab ?? 'general');
  }, [open, initialTab]);

  // ── Sync tab state ────────────────────────────────────────────────────────
  type SyncStatus = 'idle' | 'checking' | 'not_connected' | 'connected'
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const [syncUser, setSyncUser] = useState('')
  const [syncWorkspaces, setSyncWorkspaces] = useState<SyncedWorkspace[]>([])
  const [emailInput, setEmailInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [authBusy, setAuthBusy] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [billingBusy, setBillingBusy] = useState<'checkout' | 'portal' | null>(null)
  const [regLabel, setRegLabel] = useState('personal')
  const [regState, setRegState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [regError, setRegError] = useState('')

  const openBillingUrl = useCallback((url: string) => {
    openUrl(url).catch(() => window.open(url, '_blank'))
  }, [])

  const openPremiumPage = useCallback(() => {
    openBillingUrl('https://cafezin.pmatz.com/premium')
  }, [openBillingUrl])

  const handleOpenCheckout = useCallback(async () => {
    setBillingBusy('checkout')
    try {
      const url = await createCheckoutUrl()
      openBillingUrl(url)
    } catch {
      openPremiumPage()
    } finally {
      setBillingBusy(null)
    }
  }, [openBillingUrl, openPremiumPage])

  const handleOpenCustomerPortal = useCallback(async () => {
    setBillingBusy('portal')
    try {
      const url = await createCustomerPortalUrl()
      openBillingUrl(url)
    } catch {
      openPremiumPage()
    } finally {
      setBillingBusy(null)
    }
  }, [openBillingUrl, openPremiumPage])
  const [gitLabel, setGitLabel] = useState('')
  const [gitFlowState, setGitFlowState] = useState<SyncDeviceFlowState | null>(null)
  const [gitFlowBusy, setGitFlowBusy] = useState(false)
  const [gitAccounts, setGitAccounts] = useState<string[]>([])

  const loadSyncState = useCallback(async () => {
    setSyncStatus('checking')
    try {
      const user = await getUser()
      if (!user) { setSyncStatus('not_connected'); return }
      setSyncUser(user.email ?? user.id)
      const list = await listSyncedWorkspaces()
      setSyncWorkspaces(list)
      setGitAccounts(listGitAccountLabels())
      setSyncStatus('connected')
    } catch (e) {
      setSyncError(String(e))
      setSyncStatus('not_connected')
    }
  }, [])

  useEffect(() => {
    if (open && tab === 'sync' && syncStatus === 'idle') loadSyncState();
  }, [open, tab, syncStatus, loadSyncState]);

  async function handleAuth() {
    const email = emailInput.trim()
    const password = passwordInput.trim()
    if (!email || !password) return
    setAuthBusy(true)
    setSyncError(null)
    try {
      if (authMode === 'login') {
        await signIn(email, password)
      } else {
        await signUp(email, password)
      }
      setEmailInput('')
      setPasswordInput('')
      await loadSyncState()
    } catch (e) {
      setSyncError(String(e))
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleSignOut() {
    await signOut()
    setSyncStatus('not_connected')
    setSyncWorkspaces([])
    setSyncUser('')
  }

  async function handleRegister() {
    if (!workspace || !regLabel.trim()) return;
    setRegState('busy');
    setRegError('');
    try {
      const entry = await registerWorkspace(workspace.path, workspace.name, regLabel.trim());
      if (!entry) throw new Error('No sync account connected — please connect your GitHub account first.');
      setSyncWorkspaces((prev) => [...prev.filter((w) => w.gitUrl !== entry.gitUrl), entry]);
      setRegState('done');
      setTimeout(() => setRegState('idle'), 2500);
    } catch (e) {
      setRegError(String(e));
      setRegState('error');
    }
  }

  async function handleConnectGitAccount() {
    if (!gitLabel.trim()) return;
    setGitFlowBusy(true);
    try {
      await startGitAccountFlow(gitLabel.trim(), (s) => setGitFlowState(s));
      setGitFlowState(null);
      const label = gitLabel.trim();
      setGitLabel('');
      setGitAccounts((prev) => prev.includes(label) ? prev : [...prev, label]);
    } catch (e) {
      setSyncError(String(e));
    } finally {
      setGitFlowBusy(false);
    }
  }

  async function handleUnregister(gitUrl: string) {
    await unregisterWorkspace(gitUrl);
    setSyncWorkspaces((prev) => prev.filter((w) => w.gitUrl !== gitUrl));
  }

  // Local draft of workspace editable fields
  const [wsName, setWsName] = useState('');
  const [wsModel, setWsModel] = useState('');
  const [wsLanguage, setWsLanguage] = useState('pt-BR');
  const [wsAgent, setWsAgent] = useState('');
  const [wsSidebarButtons, setWsSidebarButtons] = useState<SidebarButton[]>([]);
  const [wsInboxFile, setWsInboxFile] = useState('');
  const [wsGitBranch, setWsGitBranch] = useState('');
  const [wsMarkdownMermaid, setWsMarkdownMermaid] = useState(false);
  const [wsGitHubClientId, setWsGitHubClientId] = useState('');
  const [wsVercelToken, setWsVercelToken] = useState('');
  const [wsVercelTeamId, setWsVercelTeamId] = useState('');
  const [wsVercelDemoHubProject, setWsVercelDemoHubProject] = useState('');
  const [wsVercelDemoHubSourceDir, setWsVercelDemoHubSourceDir] = useState('');
  const [wsSaving, setWsSaving] = useState(false);
  const [wsSaved, setWsSaved] = useState(false);

  // Global Vercel token (localStorage)
  const [globalVercelToken, setGlobalVercelToken] = useState(
    () => localStorage.getItem('cafezin-vercel-token') ?? '',
  );
  const [vercelTokenSaved, setVercelTokenSaved] = useState(false);

  function handleSaveVercelToken() {
    void saveApiSecret('cafezin-vercel-token', globalVercelToken.trim());
    setVercelTokenSaved(true);
    setTimeout(() => setVercelTokenSaved(false), 2000);
  }

  // ── AI Provider section state ─────────────────────────────────────────────
  const [aiProvider, setAIProviderLocal] = useState<AIProviderType>(() => getActiveProvider());
  const [aiProviderKey, setAIProviderKey] = useState(() => {
    const p = getActiveProvider();
    return p !== 'copilot' ? getProviderKey(p) : '';
  });
  const [aiModel, setAIModel] = useState(() => getActiveModel());
  const [aiKeySaved, setAIKeySaved] = useState(false);
  const [aiModelSaved, setAIModelSaved] = useState(false);

  function handleAIProviderChange(p: AIProviderType) {
    setAIProviderLocal(p);
    setActiveProvider(p);
    void saveApiSecret('cafezin-ai-provider', p);
    setAIProviderKey(p !== 'copilot' ? getProviderKey(p) : '');
    setAIModel(PROVIDER_DEFAULT_MODELS[p]);
  }

  function handleSaveAIKey() {
    if (aiProvider === 'copilot') return;
    const keyMap: Record<Exclude<AIProviderType, 'copilot'>, string> = {
      openai: 'cafezin-openai-key',
      anthropic: 'cafezin-anthropic-key',
      groq: 'cafezin-groq-key',
    };
    void saveApiSecret(keyMap[aiProvider], aiProviderKey.trim());
    setAIKeySaved(true);
    setTimeout(() => setAIKeySaved(false), 2000);
  }

  function handleSaveAIModel() {
    const nextModel = aiProvider === 'copilot'
      ? resolveCopilotModelForChatCompletions(aiModel.trim())
      : aiModel.trim();
    setActiveModel(nextModel);
    setAIModel(nextModel);
    void saveApiSecret('cafezin-ai-model', nextModel);
    setAIModelSaved(true);
    setTimeout(() => setAIModelSaved(false), 2000);
  }
  // New button form state
  const [newBtnLabel, setNewBtnLabel] = useState('');
  const [newBtnCmd, setNewBtnCmd] = useState('');
  const [newBtnDesc, setNewBtnDesc] = useState('');

  // Reset local draft whenever modal opens or workspace changes
  useEffect(() => {
    if (!open || !workspace) return;
    setWsName(workspace.config.name ?? '');
    setWsModel(workspace.config.preferredModel
      ? resolveCopilotModelForChatCompletions(workspace.config.preferredModel)
      : '');
    setWsLanguage(workspace.config.preferredLanguage ?? 'pt-BR');
    setWsAgent(workspace.agentContext ?? '');
    setWsSidebarButtons(workspace.config.sidebarButtons ?? []);
    setWsInboxFile(workspace.config.inboxFile ?? '');
    setWsGitBranch(workspace.config.gitBranch ?? '');
    setWsMarkdownMermaid(workspace.config.features?.markdown?.mermaid ?? false);
    setWsGitHubClientId(workspace.config.githubOAuth?.clientId ?? '');
    setWsVercelToken(workspace.config.vercelConfig?.token ?? '');
    setWsVercelTeamId(workspace.config.vercelConfig?.teamId ?? '');
    setWsVercelDemoHubProject(workspace.config.vercelConfig?.demoHub?.projectName ?? '');
    setWsVercelDemoHubSourceDir(workspace.config.vercelConfig?.demoHub?.sourceDir ?? '');
    setWsSaved(false);
  }, [open, workspace]);

  function setApp<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    onAppSettingsChange({ ...appSettings, [key]: value });
  }

  function buildWorkspaceFeatures(existing?: WorkspaceFeatureConfig): WorkspaceFeatureConfig | undefined {
    const nextFeatures: WorkspaceFeatureConfig = {
      ...existing,
      markdown: wsMarkdownMermaid
        ? { ...existing?.markdown, mermaid: true }
        : existing?.markdown
          ? Object.fromEntries(
              Object.entries(existing.markdown).filter(([key]) => key !== 'mermaid'),
            ) as WorkspaceFeatureConfig['markdown']
          : undefined,
    };

    if (nextFeatures.markdown && Object.keys(nextFeatures.markdown).length === 0) {
      delete nextFeatures.markdown;
    }
    if (nextFeatures.canvas && Object.keys(nextFeatures.canvas).length === 0) {
      delete nextFeatures.canvas;
    }
    if (nextFeatures.code && Object.keys(nextFeatures.code).length === 0) {
      delete nextFeatures.code;
    }

    return Object.keys(nextFeatures).length > 0 ? nextFeatures : undefined;
  }

  const { t } = useTranslation();

  // ── Account state (premium entitlement) ──────────────────────────────────
  const { account, loading: accountLoading, refresh: refreshAccount } = useAccountState();

  const autosaveLabels: Record<number, string> = {
    500:  t('settings.autosaveFast'),
    1000: t('settings.autosaveNormal'),
    2000: t('settings.autosaveSlow'),
    0:    t('settings.autosaveManual'),
  };

  // Save workspace section
  async function handleWsSave() {
    if (!workspace) return;
    setWsSaving(true);
    try {
      // 1. Save config (name + model)
      const updated: Workspace = {
        ...workspace,
        name: wsName,
        config: {
          ...workspace.config,
          name: wsName,
          preferredModel: wsModel
            ? resolveCopilotModelForChatCompletions(wsModel)
            : undefined,
          preferredLanguage: wsLanguage !== 'pt-BR' ? wsLanguage : undefined,
          sidebarButtons: wsSidebarButtons.length > 0 ? wsSidebarButtons : undefined,
          inboxFile: wsInboxFile.trim() || undefined,
          gitBranch: wsGitBranch.trim() || undefined,
          githubOAuth: wsGitHubClientId.trim()
            ? { clientId: wsGitHubClientId.trim() }
            : undefined,
          features: buildWorkspaceFeatures(workspace.config.features),
          vercelConfig: (wsVercelToken.trim() || wsVercelTeamId.trim() || wsVercelDemoHubProject.trim())
            ? {
                token: wsVercelToken.trim() || undefined,
                teamId: wsVercelTeamId.trim() || undefined,
                demoHub: wsVercelDemoHubProject.trim()
                  ? {
                      projectName: wsVercelDemoHubProject.trim(),
                      sourceDir: wsVercelDemoHubSourceDir.trim() || undefined,
                    }
                  : undefined,
              } as VercelWorkspaceConfig
            : undefined,
        },
        agentContext: wsAgent || undefined,
      };
      await saveWorkspaceConfig(updated);

      // 2. Write AGENT.md
      const agentPath = `${workspace.path}/AGENT.md`;
      await writeTextFile(agentPath, wsAgent);

      onWorkspaceChange(updated);
      setWsSaved(true);
      setTimeout(() => setWsSaved(false), 2000);
    } catch (err) {
      console.error('Settings save failed:', err);
    } finally {
      setWsSaving(false);
    }
  }

  if (!open) return null;

  return createPortal(
    <div className="sm-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sm-modal">

        {/* Header */}
        <div className="sm-header">
          <span className="sm-title"><GearSix size={15} weight="bold" /> {t('settings.title')}</span>
          <button className="sm-close" onClick={onClose} title={t('settings.closeTitle')}><X size={14} /></button>
        </div>

        {/* Tabs */}
        <div className="sm-tabs">
          <button
            className={`sm-tab ${tab === 'general' ? 'active' : ''}`}
            onClick={() => setTab('general')}
          >{t('settings.tabGeneral')}</button>
          <button
            className={`sm-tab ${tab === 'workspace' ? 'active' : ''}`}
            onClick={() => setTab('workspace')}
            disabled={!workspace}
          >{t('settings.tabWorkspace')}</button>
          <button
            className={`sm-tab ${tab === 'sync' ? 'active' : ''}`}
            onClick={() => setTab('sync')}
          >{t('settings.tabSync')}</button>
          <button
            className={`sm-tab ${tab === 'account' ? 'active' : ''}`}
            onClick={() => setTab('account')}
          >Conta</button>
        </div>

        {/* Body */}
        <div className="sm-body">

          {/* ── General tab ── */}
          {tab === 'general' && (
            <div className="sm-section-list">

              <section className="sm-section">
                <h3 className="sm-section-title">{t('settings.sectionAppearance')}</h3>

                <div className="sm-row">
                  <div className="sm-row-label">
                    <span>{t('settings.themeLabel')}</span>
                    <span className="sm-row-desc">{t('settings.themeDesc')}</span>
                  </div>
                  <div className="sm-theme-toggle">
                    <button
                      className={`sm-theme-btn ${appSettings.theme === 'system' ? 'active' : ''}`}
                      onClick={() => setApp('theme', 'system')}
                    >
                      {t('settings.themeSystem')}
                    </button>
                    <button
                      className={`sm-theme-btn ${appSettings.theme === 'dark' ? 'active' : ''}`}
                      onClick={() => setApp('theme', 'dark')}
                    >
                      {t('settings.themeDark')}
                    </button>
                    <button
                      className={`sm-theme-btn ${appSettings.theme === 'light' ? 'active' : ''}`}
                      onClick={() => setApp('theme', 'light')}
                    >
                      {t('settings.themeLight')}
                    </button>
                  </div>
                </div>

                <div className="sm-row">
                  <div className="sm-row-label">
                    <span>{t('settings.fontSizeLabel')}</span>
                    <span className="sm-row-desc">{t('settings.fontSizeDesc')}</span>
                  </div>
                  <select
                    className="sm-select"
                    value={appSettings.editorFontSize}
                    onChange={(e) => setApp('editorFontSize', Number(e.target.value))}
                  >
                    {FONT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </section>

              <section className="sm-section">
                <h3 className="sm-section-title">{t('settings.sectionEditor')}</h3>

                <div className="sm-row">
                  <div className="sm-row-label">
                    <span>{t('settings.autosaveLabel')}</span>
                    <span className="sm-row-desc">{t('settings.autosaveDesc')}</span>
                  </div>
                  <select
                    className="sm-select"
                    value={appSettings.autosaveDelay}
                    onChange={(e) => setApp('autosaveDelay', Number(e.target.value))}
                  >
                    {AUTOSAVE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{autosaveLabels[o.value] ?? o.label}</option>
                    ))}
                  </select>
                </div>

                <div className="sm-row">
                  <div className="sm-row-label">
                    <span>{t('settings.wordCountLabel')}</span>
                    <span className="sm-row-desc">{t('settings.wordCountDesc')}</span>
                  </div>
                  <label className="sm-toggle">
                    <input
                      type="checkbox"
                      checked={appSettings.showWordCount}
                      onChange={(e) => setApp('showWordCount', e.target.checked)}
                    />
                    <span className="sm-toggle-track" />
                  </label>
                </div>
              </section>

              <section className="sm-section">
                <h3 className="sm-section-title">{t('settings.sectionAI')}</h3>

                <div className="sm-row">
                  <div className="sm-row-label">
                    <span>{t('settings.aiHighlightLabel')}</span>
                    <span className="sm-row-desc">{t('settings.aiHighlightDesc')}</span>
                  </div>
                  <label className="sm-toggle">
                    <input
                      type="checkbox"
                      checked={appSettings.aiHighlightDefault}
                      onChange={(e) => setApp('aiHighlightDefault', e.target.checked)}
                    />
                    <span className="sm-toggle-track" />
                  </label>
                </div>
              </section>

              <section className="sm-section">
                <h3 className="sm-section-title">{t('settings.sectionLayout')}</h3>

                <div className="sm-row">
                  <div className="sm-row-label">
                    <span>{t('settings.sidebarOpenLabel')}</span>
                    <span className="sm-row-desc">{t('settings.sidebarOpenDesc')}</span>
                  </div>
                  <label className="sm-toggle">
                    <input
                      type="checkbox"
                      checked={appSettings.sidebarOpenDefault}
                      onChange={(e) => setApp('sidebarOpenDefault', e.target.checked)}
                    />
                    <span className="sm-toggle-track" />
                  </label>
                </div>
                <div className="sm-row">
                  <div className="sm-row-label">
                    <span>{t('settings.formatOnSaveLabel')}</span>
                    <span className="sm-row-desc">{t('settings.formatOnSaveDesc')}</span>
                  </div>
                  <label className="sm-toggle">
                    <input
                      type="checkbox"
                      checked={appSettings.formatOnSave ?? true}
                      onChange={(e) => setApp('formatOnSave', e.target.checked)}
                    />
                    <span className="sm-toggle-track" />
                  </label>
                </div>

                <div className="sm-row">
                  <div className="sm-row-label">
                    <span>{t('settings.terminalLabel')}</span>
                    <span className="sm-row-desc">{t('settings.terminalDesc')}</span>
                  </div>
                  <label className="sm-toggle">
                    <input
                      type="checkbox"
                      checked={appSettings.showTerminal ?? false}
                      onChange={(e) => setApp('showTerminal', e.target.checked)}
                    />
                    <span className="sm-toggle-track" />
                  </label>
                </div>

                <div className="sm-row">
                  <div className="sm-row-label">
                    <span>{t('settings.languageLabel')}</span>
                    <span className="sm-row-desc">{t('settings.languageDesc')}</span>
                  </div>
                  <select
                    className="sm-select"
                    value={appSettings.locale ?? 'en'}
                    onChange={(e) => setApp('locale', e.target.value as 'en' | 'pt-BR')}
                  >
                    <option value="en">{t('settings.langEn')}</option>
                    <option value="pt-BR">{t('settings.langPtBR')}</option>
                  </select>
                </div>
              </section>

              <section className="sm-section">
                <h3 className="sm-section-title">{t('settings.sectionAPIKeys')}</h3>
                <p className="sm-section-desc">
                  {t('settings.apiKeysDesc')}
                </p>

                <div className="sm-row sm-row--col">
                  <label className="sm-label">
                    {t('settings.vercelTokenLabel')}
                    <span className="sm-row-desc"> — <a href="https://vercel.com/account/tokens" target="_blank" rel="noreferrer">vercel.com/account/tokens</a></span>
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="sm-input"
                      type="password"
                      value={globalVercelToken}
                      onChange={(e) => setGlobalVercelToken(e.target.value)}
                      placeholder="token_..."
                      style={{ flex: 1 }}
                    />
                    <button
                      className={`sm-save-btn ${vercelTokenSaved ? 'saved' : ''}`}
                      onClick={handleSaveVercelToken}
                    >
                      {vercelTokenSaved ? t('settings.saved') : t('settings.save')}
                    </button>
                  </div>
                </div>
              </section>

              <section className="sm-section">
                <h3 className="sm-section-title">{t('settings.sectionAIAssistant')}</h3>
                <p className="sm-section-desc">
                  {t('settings.aiAssistantDesc')}
                </p>

                <div className="sm-row sm-row--col">
                  <label className="sm-label">{t('settings.providerLabel')}</label>
                  <select
                    className="sm-input"
                    value={aiProvider}
                    onChange={(e) => handleAIProviderChange(e.target.value as AIProviderType)}
                  >
                    {(Object.keys(PROVIDER_LABELS) as AIProviderType[]).map((p) => (
                      <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
                    ))}
                  </select>
                </div>

                {aiProvider !== 'copilot' && (
                  <div className="sm-row sm-row--col">
                    <label className="sm-label">
                      {t('settings.apiKeyLabel')}
                      {aiProvider === 'openai' && (
                        <span className="sm-row-desc"> —{' '}
                          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a>
                        </span>
                      )}
                      {aiProvider === 'anthropic' && (
                        <span className="sm-row-desc"> —{' '}
                          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>
                        </span>
                      )}
                      {aiProvider === 'groq' && (
                        <span className="sm-row-desc"> —{' '}
                          <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a>
                        </span>
                      )}
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        className="sm-input"
                        type="password"
                        value={aiProviderKey}
                        onChange={(e) => setAIProviderKey(e.target.value)}
                        placeholder={aiProvider === 'openai' ? 'sk-...' : aiProvider === 'anthropic' ? 'sk-ant-...' : 'gsk_...'}
                        style={{ flex: 1 }}
                      />
                      <button
                        className={`sm-save-btn ${aiKeySaved ? 'saved' : ''}`}
                        onClick={handleSaveAIKey}
                      >
                        {aiKeySaved ? t('settings.saved') : t('settings.save')}
                      </button>
                    </div>
                  </div>
                )}

                {aiProvider === 'copilot' && (
                  <div className="sm-row">
                    <span className="sm-row-desc">
                      {t('settings.copilotLoginDesc')}
                    </span>
                  </div>
                )}

                <div className="sm-row sm-row--col">
                  <label className="sm-label">{t('settings.defaultModelLabel')}</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="sm-input"
                      type="text"
                      list="ai-models-datalist"
                      value={aiModel}
                      onChange={(e) => setAIModel(e.target.value)}
                      placeholder={PROVIDER_DEFAULT_MODELS[aiProvider]}
                      style={{ flex: 1 }}
                    />
                    <datalist id="ai-models-datalist">
                      {PROVIDER_MODELS[aiProvider].map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                    <button
                      className={`sm-save-btn ${aiModelSaved ? 'saved' : ''}`}
                      onClick={handleSaveAIModel}
                    >
                      {aiModelSaved ? t('settings.saved') : t('settings.save')}
                    </button>
                  </div>
                </div>
              </section>

              <section className="sm-section">
                <h3 className="sm-section-title">{t('settings.sectionShortcuts')}</h3>
                <table className="sm-shortcuts">
                  <tbody>
                    <tr className="sm-shortcuts-group"><td colSpan={2}>{t('settings.scGroupFiles')}</td></tr>
                    <tr><td><kbd>⌘</kbd><kbd>S</kbd></td><td>{t('settings.scSave')}</td></tr>
                    <tr><td><kbd>⌘</kbd><kbd>W</kbd></td><td>{t('settings.scCloseTab')}</td></tr>
                    <tr><td><kbd>⌘</kbd><kbd>⇧</kbd><kbd>R</kbd></td><td>{t('settings.scReload')}</td></tr>
                    <tr><td><kbd>⌃</kbd><kbd>Tab</kbd></td><td>{t('settings.scNextTab')}</td></tr>
                    <tr><td><kbd>⌃</kbd><kbd>⇧</kbd><kbd>Tab</kbd></td><td>{t('settings.scPrevTab')}</td></tr>
                    <tr className="sm-shortcuts-group"><td colSpan={2}>{t('settings.scGroupNav')}</td></tr>
                    <tr><td><kbd>⌘</kbd><kbd>F</kbd></td><td>{t('settings.scFindReplace')}</td></tr>
                    <tr><td><kbd>⌘</kbd><kbd>⇧</kbd><kbd>F</kbd></td><td>{t('settings.scProjectSearch')}</td></tr>
                    <tr><td><kbd>⌘</kbd><kbd>⇧</kbd><kbd>P</kbd></td><td>{t('settings.scTogglePreview')}</td></tr>
                    <tr><td><kbd>⌘</kbd><kbd>B</kbd></td><td>{t('settings.scToggleSidebar')}</td></tr>
                    <tr><td><kbd>⌘</kbd><kbd>J</kbd></td><td>{t('settings.scToggleTerminal')}</td></tr>
                    <tr className="sm-shortcuts-group"><td colSpan={2}>{t('settings.scGroupAI')}</td></tr>
                    <tr><td><kbd>⌘</kbd><kbd>K</kbd></td><td>{t('settings.scOpenCopilot')}</td></tr>
                    <tr><td><kbd>⌘</kbd><kbd>K</kbd> <span className="sm-shortcut-note">{t('settings.scWithSelection')}</span></td><td>{t('settings.scAskCopilot')}</td></tr>
                    <tr><td><kbd>Esc</kbd></td><td>{t('settings.scCloseCopilot')}</td></tr>
                    <tr className="sm-shortcuts-group"><td colSpan={2}>{t('settings.scGroupApp')}</td></tr>
                    <tr><td><kbd>⌘</kbd><kbd>,</kbd></td><td>{t('settings.scOpenSettings')}</td></tr>
                    <tr><td><kbd>⌘</kbd><kbd>Click</kbd> <span className="sm-shortcut-note">{t('settings.scMultiSelectNote')}</span></td><td>{t('settings.scMultiSelect')}</td></tr>
                    <tr><td><kbd>Duplo clique</kbd> <span className="sm-shortcut-note">{t('settings.scRenameFileNote')}</span></td><td>{t('settings.scRenameFile')}</td></tr>
                  </tbody>
                </table>
              </section>

            </div>
          )}

          {/* ── Workspace tab ── */}
          {tab === 'workspace' && workspace && (
            <div className="sm-section-list">

              <section className="sm-section">
                <h3 className="sm-section-title">Identificação</h3>

                <div className="sm-row sm-row--col">
                  <label className="sm-label">Nome do workspace</label>
                  <input
                    className="sm-input"
                    value={wsName}
                    onChange={(e) => setWsName(e.target.value)}
                    placeholder="Meu workspace"
                  />
                </div>

                <div className="sm-row sm-row--col">
                  <label className="sm-label">
                    Caminho
                    <span className="sm-row-desc" style={{ marginLeft: 8 }}>(somente leitura)</span>
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
                <h3 className="sm-section-title">AI</h3>

                <div className="sm-row sm-row--col">
                  <label className="sm-label">
                    Modelo preferido
                    <span className="sm-row-desc"> — substitui o padrão global do painel de IA para este workspace</span>
                  </label>
                  <input
                    className="sm-input"
                    value={wsModel}
                    onChange={(e) => setWsModel(e.target.value)}
                    placeholder="ex: claude-sonnet-4-5 (deixe em branco para usar o padrão do painel)"
                  />
                </div>

                <div className="sm-row sm-row--col">
                  <label className="sm-label">
                    Idioma da IA
                    <span className="sm-row-desc"> — idioma padrão nas respostas do assistente neste workspace</span>
                  </label>
                  <select
                    className="sm-select"
                    value={wsLanguage}
                    onChange={(e) => setWsLanguage(e.target.value)}
                  >
                    <option value="pt-BR">Português (Brasil)</option>
                    <option value="en-US">English (US)</option>
                    <option value="es">Español</option>
                    <option value="fr">Français</option>
                    <option value="de">Deutsch</option>
                    <option value="it">Italiano</option>
                    <option value="ja">日本語</option>
                    <option value="zh-CN">中文 (简体)</option>
                  </select>
                </div>

                <div className="sm-row sm-row--col">
                  <label className="sm-label">
                    GitHub OAuth Client ID
                    <span className="sm-row-desc"> — obrigatório para o login do Copilot neste workspace</span>
                  </label>
                  <input
                    className="sm-input"
                    value={wsGitHubClientId}
                    onChange={(e) => setWsGitHubClientId(e.target.value)}
                    placeholder="Iv1.1234567890abcdef"
                  />
                  <p className="sm-section-desc" style={{ marginTop: 8 }}>
                    Crie um OAuth App no GitHub, habilite <strong>Device Flow</strong> e cole aqui apenas o <strong>Client ID</strong>.
                    O Cafezin não usa mais <strong>client secret</strong> no app baixado pelo usuário.
                  </p>
                </div>

                <div className="sm-row sm-row--col">
                  <label className="sm-label">
                    Instruções do agente (AGENT.md)
                    <span className="sm-row-desc"> — prompt de sistema injetado em cada sessão do Copilot</span>
                  </label>
                  <textarea
                    className="sm-textarea"
                    value={wsAgent}
                    onChange={(e) => setWsAgent(e.target.value)}
                    placeholder="Descreva o projeto, estilo de código ou qualquer contexto que a IA deva conhecer…"
                    rows={10}
                  />
                </div>
              </section>

              <section className="sm-section">
                <h3 className="sm-section-title">Capacidades por workspace</h3>

                <div className="sm-row">
                  <div className="sm-row-label">
                    <span>{t('settings.workspaceMarkdownMermaidLabel')}</span>
                    <span className="sm-row-desc">{t('settings.workspaceMarkdownMermaidDesc')}</span>
                  </div>
                  <label className="sm-toggle">
                    <input
                      type="checkbox"
                      checked={wsMarkdownMermaid}
                      onChange={(e) => setWsMarkdownMermaid(e.target.checked)}
                    />
                    <span className="sm-toggle-track" />
                  </label>
                </div>
              </section>

              <section className="sm-section">
                <h3 className="sm-section-title">Atalhos da barra lateral</h3>
                <p className="sm-section-desc">
                  Botões personalizados que aparecem na barra lateral e executam um comando no terminal.
                  Ideal para scripts específicos do workspace como exportação ou sincronização.
                </p>
                {wsSidebarButtons.map((btn) => (
                  <div key={btn.id} className="sm-sidebar-btn-row">
                    <span className="sm-sidebar-btn-label">{btn.label}</span>
                    <code className="sm-sidebar-btn-cmd">{btn.command}</code>
                    <button
                      className="sm-sidebar-btn-delete"
                      onClick={() => setWsSidebarButtons((prev) => prev.filter((b) => b.id !== btn.id))}
                      title="Remover botão"
                    >✕</button>
                  </div>
                ))}
                <div className="sm-sidebar-btn-form">
                  <input
                    className="sm-input"
                    placeholder="Rótulo (ex: ⊡ Exportar)"
                    value={newBtnLabel}
                    onChange={(e) => setNewBtnLabel(e.target.value)}
                  />
                  <input
                    className="sm-input"
                    placeholder="Comando (ex: bash scripts/export_book.sh)"
                    value={newBtnCmd}
                    onChange={(e) => setNewBtnCmd(e.target.value)}
                  />
                  <input
                    className="sm-input"
                    placeholder="Descrição/tooltip (opcional)"
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
                  >+ Adicionar botão</button>
                </div>
              </section>

              <section className="sm-section">
                <h3 className="sm-section-title">Vercel Publish</h3>
                <p className="sm-section-desc">
                  Override do token global e configuração de equipe para este workspace.
                  Deixe em branco para usar o token global das API Keys.
                </p>

                <div className="sm-row sm-row--col">
                  <label className="sm-label">
                    Token override
                    <span className="sm-row-desc"> — sobrescreve o token global</span>
                  </label>
                  <input
                    className="sm-input"
                    type="password"
                    value={wsVercelToken}
                    onChange={(e) => setWsVercelToken(e.target.value)}
                    placeholder="Deixe vazio para usar o token global"
                  />
                </div>

                <div className="sm-row sm-row--col">
                  <label className="sm-label">
                    Team ID
                    <span className="sm-row-desc"> — opcional, para contas de equipe Vercel</span>
                  </label>
                  <input
                    className="sm-input"
                    value={wsVercelTeamId}
                    onChange={(e) => setWsVercelTeamId(e.target.value)}
                    placeholder="team_abc123 (deixe vazio para conta pessoal)"
                  />
                </div>

                <p className="sm-section-desc" style={{ marginTop: 16 }}>
                  <strong>Demo Hub</strong> — publica várias demos HTML como sub-caminhos de um único projeto Vercel.
                  Ex: <code>demos/aula1/</code> fica em <code>projeto.vercel.app/aula1</code>.
                </p>

                <div className="sm-row sm-row--col">
                  <label className="sm-label">
                    Projeto Vercel do Demo Hub
                    <span className="sm-row-desc"> — nome do projeto Vercel (ex: meu-curso)</span>
                  </label>
                  <input
                    className="sm-input"
                    value={wsVercelDemoHubProject}
                    onChange={(e) => setWsVercelDemoHubProject(e.target.value)}
                    placeholder="meu-curso (deixe vazio para desativar)"
                  />
                </div>

                {wsVercelDemoHubProject.trim() && (
                  <div className="sm-row sm-row--col">
                    <label className="sm-label">
                      Pasta das demos
                      <span className="sm-row-desc"> — caminho relativo à raiz do workspace (deixe vazio = raiz)</span>
                    </label>
                    <input
                      className="sm-input"
                      value={wsVercelDemoHubSourceDir}
                      onChange={(e) => setWsVercelDemoHubSourceDir(e.target.value)}
                      placeholder="demos  (ex: demos, projetos/web)"
                    />
                  </div>
                )}
              </section>

              <section className="sm-section">
                <h3 className="sm-section-title">Git sync branch</h3>
                <div className="sm-row sm-row--col">
                  <label className="sm-label">
                    Branch
                    <span className="sm-row-desc"> — branch usada para sync no mobile. Deixe vazio para usar a branch padrão do repositório (main / master).</span>
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
                <h3 className="sm-section-title">Pasta de entrada de voz</h3>
                <div className="sm-row sm-row--col">
                  <label className="sm-label">
                    Caminho do arquivo de entrada
                    <span className="sm-row-desc"> — transcrições de voz são adicionadas aqui (relativo à raiz do workspace)</span>
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
                  onClick={handleWsSave}
                  disabled={wsSaving}
                >
                  {wsSaving ? 'Salvando…' : wsSaved ? '✓ Salvo' : 'Salvar configurações do workspace'}
                </button>
              </div>

            </div>
          )}

          {/* ── Sync tab ── */}
          {tab === 'sync' && (
            <div className="sm-section-list">

              <section className="sm-section">
                <h3 className="sm-section-title">Conta Cafezin</h3>
                <p className="sm-section-desc">
                  Entre com e-mail e senha para sincronizar seus workspaces entre dispositivos.
                  A lista de workspaces fica armazenada de forma segura no Supabase.
                </p>

                {syncStatus === 'checking' && (
                  <div className="sm-sync-status">Conectando…</div>
                )}

                {syncStatus === 'not_connected' && (
                  <div className="sm-sync-pat-form">
                    <div className="sm-sync-auth-tabs">
                      <button
                        className={`sm-sync-auth-tab ${authMode === 'login' ? 'active' : ''}`}
                        onClick={() => { setAuthMode('login'); setSyncError(null) }}
                      >Entrar</button>
                      <button
                        className={`sm-sync-auth-tab ${authMode === 'signup' ? 'active' : ''}`}
                        onClick={() => { setAuthMode('signup'); setSyncError(null) }}
                      >Criar conta</button>
                    </div>
                    <input
                      className="sm-input"
                      type="email"
                      placeholder="seu@email.com"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleAuth() }}
                    />
                    <input
                      className="sm-input"
                      type="password"
                      placeholder="Senha"
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleAuth() }}
                      style={{ marginTop: 6 }}
                    />
                    <button
                      className="sm-sync-btn sm-save-btn"
                      onClick={() => void handleAuth()}
                      disabled={authBusy || !emailInput.trim() || !passwordInput.trim()}
                      style={{ marginTop: 8 }}
                    >
                      {authBusy ? 'Aguarde…' : authMode === 'login' ? 'Entrar' : 'Criar conta'}
                    </button>
                    {syncError && <p className="sm-sync-error">{syncError}</p>}
                  </div>
                )}

                {gitFlowState && (
                  <div className="sm-sync-flow">
                    <p className="sm-sync-flow-text">Abra esta URL no navegador e insira o código:</p>
                    <a
                      className="sm-sync-flow-url"
                      href={gitFlowState.verificationUri}
                      target="_blank" rel="noreferrer"
                    >
                      {gitFlowState.verificationUri}
                    </a>
                    <div className="sm-sync-flow-code">{gitFlowState.userCode}</div>
                    <p className="sm-sync-flow-hint">Aguardando autorização…</p>
                  </div>
                )}

                {syncStatus === 'connected' && (
                  <div className="sm-sync-connected">
                    <div className="sm-sync-connected-info">
                      <span className="sm-sync-dot" />
                      <span>Conectado{syncUser ? ` como ${syncUser}` : ''}</span>
                    </div>
                    <button className="sm-sync-disconnect" onClick={() => void handleSignOut()}>
                      Sair
                    </button>
                  </div>
                )}
              </section>

              {syncStatus === 'connected' && (
                <section className="sm-section">
                  <h3 className="sm-section-title">Workspaces sincronizados</h3>
                  {syncWorkspaces.length === 0 ? (
                    <p className="sm-sync-empty">Nenhum workspace registrado ainda.</p>
                  ) : (
                    <ul className="sm-sync-ws-list">
                      {syncWorkspaces.map((ws) => (
                        <li key={ws.gitUrl} className="sm-sync-ws-item">
                          <div className="sm-sync-ws-info">
                            <span className="sm-sync-ws-name">{ws.name}</span>
                            <span className="sm-sync-ws-url">{ws.gitUrl}</span>
                            <span className="sm-sync-ws-label">account: {ws.gitAccountLabel}</span>
                          </div>
                          <button
                            className="sm-sync-ws-remove"
                            title="Remover do sync"
                            onClick={() => handleUnregister(ws.gitUrl)}
                          >✕</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {syncStatus === 'connected' && workspace && (
                <section className="sm-section">
                  <h3 className="sm-section-title">Registrar este workspace</h3>
                  <p className="sm-section-desc">
                    Indique a qual conta git este workspace pertence (ex: "pessoal" ou "trabalho").
                    O app mobile usa esse rótulo para saber quais credenciais usar ao clonar.
                  </p>
                  <div className="sm-sync-register">
                    <input
                      className="sm-input"
                      value={regLabel}
                      onChange={(e) => setRegLabel(e.target.value)}
                      placeholder='ex: pessoal, trabalho…'
                      list="sm-git-account-labels"
                    />
                    <datalist id="sm-git-account-labels">
                      {gitAccounts.map((l) => <option key={l} value={l} />)}
                    </datalist>
                    <button
                      className={`sm-save-btn ${regState === 'done' ? 'saved' : ''}`}
                      onClick={handleRegister}
                      disabled={regState === 'busy' || !regLabel.trim()}
                    >
                      {regState === 'busy' ? 'Registrando…' : regState === 'done' ? '✓ Registrado' : 'Registrar'}
                    </button>
                  </div>
                  {regState === 'error' && <p className="sm-sync-error" style={{ marginTop: 8 }}>{regError}</p>}
                </section>
              )}

              {syncStatus === 'connected' && (
                <section className="sm-section">
                  <h3 className="sm-section-title">Contas Git</h3>
                  <p className="sm-section-desc">
                    Autentique cada conta git pelo nome para que o mobile possa clonar e sincronizar esses repositórios.
                  </p>
                  {gitAccounts.length > 0 && (
                    <ul className="sm-sync-ws-list" style={{ marginBottom: 12 }}>
                      {gitAccounts.map((l) => (
                        <li key={l} className="sm-sync-ws-item">
                          <span className="sm-sync-dot" />
                          <span className="sm-sync-ws-name" style={{ marginLeft: 8 }}>{l}</span>
                          <span className="sm-sync-ws-label" style={{ marginLeft: 'auto' }}>autenticado</span>
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
                        placeholder="Rótulo da conta (ex: pessoal, trabalho)"
                      />
                      <button
                        className="sm-save-btn"
                        onClick={handleConnectGitAccount}
                        disabled={gitFlowBusy || !gitLabel.trim()}
                      >
                        {gitFlowBusy ? 'Aguardando…' : 'Conectar'}
                      </button>
                    </div>
                  )}
                  {syncError && <p className="sm-sync-error" style={{ marginTop: 8 }}>{syncError}</p>}
                </section>
              )}

            </div>
          )}

          {/* ── Account tab ── */}
          {tab === 'account' && (
            <div className="sm-section-list">

              <section className="sm-section">
                <h3 className="sm-section-title">Plano</h3>

                {accountLoading ? (
                  <p className="sm-section-desc">Verificando plano…</p>
                ) : (
                  <>
                    <div className="sm-row">
                      <div className="sm-row-label">
                        <span>Status atual</span>
                        <span className="sm-row-desc">
                          {account.authenticated ? account.plan === 'premium' ? 'Premium ativo' : 'Plano gratuito' : 'Não autenticado'}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: account.isPremium ? 'rgba(var(--yellow-rgb,212,169,106),0.15)' : 'var(--surface2)',
                          color: account.isPremium ? 'var(--yellow, #d4a96a)' : 'var(--text-muted)',
                          border: `1px solid ${account.isPremium ? 'rgba(var(--yellow-rgb,212,169,106),0.35)' : 'var(--border)'}`,
                        }}
                      >
                        {account.isPremium ? 'Premium' : 'Free'}
                      </span>
                    </div>

                    {account.isPremium && account.currentPeriodEnd && (
                      <div className="sm-row">
                        <div className="sm-row-label">
                          <span>Renova em</span>
                          <span className="sm-row-desc">
                            {new Date(account.currentPeriodEnd).toLocaleDateString('pt-BR')}
                            {account.cancelAtPeriodEnd && ' (cancelamento agendado)'}
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="sm-row">
                      <button
                        className="sm-save-btn"
                        style={{ marginLeft: 'auto' }}
                        onClick={() => void refreshAccount()}
                        disabled={accountLoading}
                      >
                        Atualizar status
                      </button>
                    </div>

                    {account.isPremium ? (
                      <div style={{ marginTop: 12 }}>
                        <button
                          className="sm-save-btn"
                          onClick={() => void handleOpenCustomerPortal()}
                          disabled={billingBusy !== null}
                        >
                          {billingBusy === 'portal' ? 'Abrindo portal…' : 'Gerenciar assinatura ↗'}
                        </button>
                      </div>
                    ) : account.authenticated ? (
                      <div style={{ marginTop: 12 }}>
                        <button
                          className="sm-save-btn"
                          onClick={() => void handleOpenCheckout()}
                          disabled={billingBusy !== null}
                        >
                          {billingBusy === 'checkout' ? 'Abrindo checkout…' : 'Assinar Premium ↗'}
                        </button>
                      </div>
                    ) : null}

                    {!account.isPremium && (
                      <div style={{ marginTop: 12 }}>
                        <a
                          href="https://cafezin.pmatz.com/premium"
                          target="_blank"
                          rel="noreferrer"
                          className="sm-save-btn"
                          style={{ display: 'inline-block', textDecoration: 'none', cursor: 'pointer' }}
                        >
                          Ver planos Premium ↗
                        </a>
                      </div>
                    )}
                  </>
                )}
              </section>

              <section className="sm-section">
                <h3 className="sm-section-title">Suas chaves de API (BYOK)</h3>
                <p className="sm-section-desc">
                  Com o plano Premium, você usa sua própria chave de API.
                  Nenhum custo extra de uso nos pagamentos do Cafezin.
                  Configure sua chave na aba <strong>Geral</strong> → Assistente de IA.
                  Pegue sua chave no provedor:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {[
                    { name: 'GitHub Copilot', url: 'https://github.com/settings/copilot' },
                    { name: 'OpenAI',         url: 'https://platform.openai.com/api-keys' },
                    { name: 'Anthropic',      url: 'https://console.anthropic.com/settings/keys' },
                    { name: 'Groq',           url: 'https://console.groq.com/keys' },
                  ].map((p) => (
                    <a
                      key={p.name}
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--accent)', fontSize: 13 }}
                    >
                      {p.name} ↗
                    </a>
                  ))}
                </div>
              </section>

            </div>
          )}

        </div>
      </div>
    </div>,
    document.body
  );
}
