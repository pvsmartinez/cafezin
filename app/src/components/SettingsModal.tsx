import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { GearSix, X } from '@phosphor-icons/react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import {
  getActiveProvider, setActiveProvider, getActiveModel, setActiveModel,
  getProviderKey,
  getCustomEndpoint, setCustomEndpoint, getCustomModelId,
  testCustomEndpoint, type CustomEndpointDiagnostic,
  type AIProviderType,
} from '../services/aiProvider';
import {
  PROVIDER_CATALOG, getFavoriteModelIds, setFavoriteModelIds,
} from '../services/ai/providerModels';
import { fetchCopilotModels, getStoredOAuthToken, resolveCopilotModelForChatCompletions } from '../services/copilot';
import { writeTextFile } from '../services/fs';
import { saveWorkspaceConfig } from '../services/workspace';
import {
  signIn, signUp, signOut, getUser,
  startGitAccountFlow, createGitHubRepo, getGitAccountToken,
  listSyncedWorkspaces, registerWorkspace, registerWorkspaceByUrl, unregisterWorkspace,
  listGitAccountLabels,
  type SyncDeviceFlowState, type SyncedWorkspace,
} from '../services/syncConfig'
import { FALLBACK_MODELS } from '../types';
import type { Workspace, AppSettings, SidebarButton, VercelWorkspaceConfig, WorkspaceFeatureConfig } from '../types';
import { saveApiSecret } from '../services/apiSecrets';
import { createCheckoutUrl, createCustomerPortalUrl } from '../services/accountService';
import { useAccountState } from '../hooks/useAccountState';
import { getAgentCapabilityState } from '../utils/agentCapabilities';
import { SK } from '../services/storageKeys';
import { GeneralTab } from './settings/GeneralTab';
import { AITab } from './settings/AITab';
import { WorkspaceTab } from './settings/WorkspaceTab';
import { AgentTab } from './settings/AgentTab';
import type { CapabilityOverrideMode } from './settings/AgentTab';
import { SyncTab } from './settings/SyncTab';
import { AccountTab } from './settings/AccountTab';
import './SettingsModal.css';

interface SettingsModalProps {
  open: boolean;
  appSettings: AppSettings;
  workspace: Workspace | null;
  onAppSettingsChange: (s: AppSettings) => void;
  onWorkspaceChange: (ws: Workspace) => void;
  onOpenHelp: () => void;
  onContactUs: () => void;
  onClose: () => void;
  /** Open directly on a specific tab. Defaults to 'general'. */
  initialTab?: Tab;
}

type Tab = 'general' | 'ai' | 'workspace' | 'agent' | 'sync' | 'account';

export default function SettingsModal({
  open,
  appSettings,
  workspace,
  onAppSettingsChange,
  onWorkspaceChange,
  onOpenHelp,
  onContactUs,
  onClose,
  initialTab,
}: SettingsModalProps) {
  function getCapabilityOverrideMode(flag: boolean | undefined): CapabilityOverrideMode {
    if (flag === true) return 'on';
    if (flag === false) return 'off';
    return 'auto';
  }

  function applyCapabilityOverride(
    existing: Record<string, unknown> | undefined,
    mode: CapabilityOverrideMode,
  ): Record<string, unknown> | undefined {
    if (mode === 'auto') {
      if (!existing) return undefined;
      const next = Object.fromEntries(
        Object.entries(existing).filter(([key]) => key !== 'agentTools'),
      );
      return Object.keys(next).length > 0 ? next : undefined;
    }
    return { ...(existing ?? {}), agentTools: mode === 'on' };
  }

  function getCapabilityModeDescription(
    mode: CapabilityOverrideMode,
    effective: boolean,
    enabledLabel: string,
    disabledLabel: string,
  ) {
    if (mode === 'auto') {
      return `Automático: ${effective ? enabledLabel : disabledLabel} neste workspace agora.`;
    }
    return mode === 'on' ? 'Ligado manualmente.' : 'Desligado manualmente.';
  }

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
  const [currentWorkspaceGitUrl, setCurrentWorkspaceGitUrl] = useState<string | null>(null)

  const billingLocale = appSettings.locale ?? 'en'
  const premiumPageUrl = billingLocale === 'pt-BR'
    ? 'https://cafezin.pmatz.com/br/premium'
    : 'https://cafezin.pmatz.com/premium'

  const openBillingUrl = useCallback((url: string) => {
    openUrl(url).catch(() => window.open(url, '_blank'))
  }, [])

  const openPremiumPage = useCallback(() => {
    openBillingUrl(premiumPageUrl)
  }, [openBillingUrl, premiumPageUrl])

  const handleOpenCheckout = useCallback(async () => {
    setBillingBusy('checkout')
    try {
      const url = await createCheckoutUrl(billingLocale)
      openBillingUrl(url)
    } catch {
      openPremiumPage()
    } finally {
      setBillingBusy(null)
    }
  }, [billingLocale, openBillingUrl, openPremiumPage])

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

  // ── Activate sync (connect local workspace to GitHub) ────────────────────
  const [activateSyncBusy, setActivateSyncBusy] = useState(false)
  const [activateSyncFlowState, setActivateSyncFlowState] = useState<SyncDeviceFlowState | null>(null)
  const [showSyncAdvanced, setShowSyncAdvanced] = useState(false)
  const [showGitDetails, setShowGitDetails] = useState(false)
  const [syncAdvancedMode, setSyncAdvancedMode] = useState<'create' | 'existing'>('create')
  const [syncAdvancedRepoName, setSyncAdvancedRepoName] = useState('')
  const [syncAdvancedPrivate, setSyncAdvancedPrivate] = useState(true)
  const [syncAdvancedUrl, setSyncAdvancedUrl] = useState('')

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
    if (open && (tab === 'sync' || tab === 'account') && syncStatus === 'idle') loadSyncState();
  }, [open, tab, syncStatus, loadSyncState]);

  useEffect(() => {
    if (!open || !workspace?.hasGit) {
      setCurrentWorkspaceGitUrl(null)
      return
    }
    invoke<string>('git_get_remote', { path: workspace.path })
      .then((url) => {
        const trimmed = url?.trim()
        setCurrentWorkspaceGitUrl(trimmed || null)
      })
      .catch(() => setCurrentWorkspaceGitUrl(null))
  }, [open, workspace])

  useEffect(() => {
    if (gitAccounts.length === 0) return
    if (!gitAccounts.includes(regLabel)) {
      setRegLabel(gitAccounts.includes('personal') ? 'personal' : gitAccounts[0])
    }
  }, [gitAccounts, regLabel])

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

  function sanitizeRepoName(name: string): string {
    return name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  }

  async function handleActivateSync() {
    if (!workspace) return;
    const label = regLabel.trim() || 'personal';
    setActivateSyncBusy(true);
    setSyncError(null);
    try {
      let gitUrl: string;
      if (showSyncAdvanced && syncAdvancedMode === 'existing') {
        gitUrl = syncAdvancedUrl.trim();
        if (!gitUrl) throw new Error('Informe a URL do repositório');
      } else {
        let token = getGitAccountToken(label);
        if (!token) {
          setGitFlowBusy(true);
          try {
            token = await startGitAccountFlow(label, (s) => setActivateSyncFlowState(s));
            setActivateSyncFlowState(null);
            setGitAccounts((prev) => prev.includes(label) ? prev : [...prev, label]);
          } finally {
            setGitFlowBusy(false);
          }
        }
        const repoName = showSyncAdvanced
          ? sanitizeRepoName(syncAdvancedRepoName || workspace.name)
          : sanitizeRepoName(workspace.name);
        const isPrivate = showSyncAdvanced ? syncAdvancedPrivate : true;
        const repo = await createGitHubRepo(repoName, isPrivate, token!);
        gitUrl = repo.cloneUrl;
      }
      const authToken = getGitAccountToken(label) ?? undefined;
      await invoke('git_set_remote', { path: workspace.path, url: gitUrl });
      if (authToken) {
        await invoke('git_sync', {
          path: workspace.path,
          message: 'Initial commit from Cafezin',
          token: authToken,
        });
      }
      await registerWorkspaceByUrl(workspace.name, gitUrl, label).catch(() => null);
      const entry = await registerWorkspace(workspace.path, workspace.name, label).catch(() => null);
      if (entry) setSyncWorkspaces((prev) => [...prev.filter((w) => w.gitUrl !== entry.gitUrl), entry]);
      onWorkspaceChange({ ...workspace, hasGit: true });
      setShowSyncAdvanced(false);
    } catch (e) {
      setSyncError(String(e));
    } finally {
      setActivateSyncBusy(false);
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
  const [wsCanvasAgentTools, setWsCanvasAgentTools] = useState<CapabilityOverrideMode>('auto');
  const [wsSpreadsheetAgentTools, setWsSpreadsheetAgentTools] = useState<CapabilityOverrideMode>('auto');
  const [wsWebAgentTools, setWsWebAgentTools] = useState<CapabilityOverrideMode>('auto');
  const [wsGitHubClientId, setWsGitHubClientId] = useState('');
  const [wsVercelToken, setWsVercelToken] = useState('');
  const [wsVercelTeamId, setWsVercelTeamId] = useState('');
  const [wsVercelDemoHubProject, setWsVercelDemoHubProject] = useState('');
  const [wsVercelDemoHubSourceDir, setWsVercelDemoHubSourceDir] = useState('');
  const [wsSaving, setWsSaving] = useState(false);
  const [wsSaved, setWsSaved] = useState(false);

  // Global Vercel token (localStorage)
  const [globalVercelToken, setGlobalVercelToken] = useState(
    () => localStorage.getItem(SK.VERCEL_TOKEN) ?? '',
  );
  const [vercelTokenSaved, setVercelTokenSaved] = useState(false);

  function handleSaveVercelToken() {
    void saveApiSecret(SK.VERCEL_TOKEN, globalVercelToken.trim());
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
  // Favorites for non-Copilot providers (shown in the chat model picker)
  const [aiFavoriteIds, setAIFavoriteIds] = useState<string[]>(() => {
    const p = getActiveProvider();
    return p !== 'copilot' && p !== 'custom' ? getFavoriteModelIds(p as Exclude<AIProviderType, 'copilot'>) : [];
  });
  const [customModelInput, setCustomModelInput] = useState('');
  const [aiCopilotModels, setAICopilotModels] = useState(FALLBACK_MODELS);
  const [aiCopilotModelsLoading, setAICopilotModelsLoading] = useState(false);
  // Custom / Local provider state
  const [customEndpointDraft, setCustomEndpointDraft] = useState(() => getCustomEndpoint());
  const [customDiagnostic, setCustomDiagnostic] = useState<CustomEndpointDiagnostic | null>(null);
  const [customDiagnosticLoading, setCustomDiagnosticLoading] = useState(false);

  function handleAIProviderChange(p: AIProviderType) {
    setAIProviderLocal(p);
    setActiveProvider(p);
    void saveApiSecret('cafezin-ai-provider', p);
    setAIProviderKey(p !== 'copilot' ? getProviderKey(p) : '');
    setAIModel(getActiveModel());
    setAIFavoriteIds(p !== 'copilot' && p !== 'custom' ? getFavoriteModelIds(p as Exclude<AIProviderType, 'copilot'>) : []);
    setCustomModelInput('');
    setCustomEndpointDraft(getCustomEndpoint());
    setCustomDiagnostic(null);
  }

  async function handleTestCustomEndpoint() {
    setCustomDiagnostic(null);
    setCustomDiagnosticLoading(true);
    try {
      const result = await testCustomEndpoint(
        customEndpointDraft.trim(),
        aiProviderKey.trim(),
        aiModel.trim(),
      );
      setCustomDiagnostic(result);
    } finally {
      setCustomDiagnosticLoading(false);
    }
  }

  function handleSaveCustomConfig() {
    // Save endpoint URL (localStorage only — not synced to Supabase for privacy)
    setCustomEndpoint(customEndpointDraft.trim());
    // Save model ID via the standard per-provider key
    const mid = aiModel.trim();
    if (mid) setActiveModel(mid);
    // Save API key (optional, encrypted + synced like other providers)
    void saveApiSecret('cafezin-custom-key', aiProviderKey.trim());
    setAIKeySaved(true);
    setTimeout(() => setAIKeySaved(false), 2000);
  }

  function addCustomModel() {
    if (aiProvider === 'copilot' || aiProvider === 'custom') return;
    const id = customModelInput.trim();
    if (!id || aiFavoriteIds.includes(id)) { setCustomModelInput(''); return; }
    const next = [...aiFavoriteIds, id];
    setAIFavoriteIds(next);
    setFavoriteModelIds(aiProvider as Exclude<AIProviderType, 'copilot' | 'custom'>, next);
    setCustomModelInput('');
  }

  function handleSaveAIKey() {
    if (aiProvider === 'copilot' || aiProvider === 'custom') return;
    const keyMap: Record<Exclude<AIProviderType, 'copilot' | 'custom'>, string> = {
      openai: 'cafezin-openai-key',
      anthropic: 'cafezin-anthropic-key',
      groq: 'cafezin-groq-key',
      google: 'cafezin-google-key',
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
    setWsCanvasAgentTools(getCapabilityOverrideMode(workspace.config.features?.canvas?.agentTools));
    setWsSpreadsheetAgentTools(getCapabilityOverrideMode(workspace.config.features?.spreadsheet?.agentTools));
    setWsWebAgentTools(getCapabilityOverrideMode(workspace.config.features?.web?.agentTools));
    setWsGitHubClientId(workspace.config.githubOAuth?.clientId ?? '');
    setWsVercelToken(workspace.config.vercelConfig?.token ?? '');
    setWsVercelTeamId(workspace.config.vercelConfig?.teamId ?? '');
    setWsVercelDemoHubProject(workspace.config.vercelConfig?.demoHub?.projectName ?? '');
    setWsVercelDemoHubSourceDir(workspace.config.vercelConfig?.demoHub?.sourceDir ?? '');
    setWsSaved(false);
  }, [open, workspace]);

  useEffect(() => {
    const hasCopilotAccess =
      !!getStoredOAuthToken(workspace?.config.githubOAuth?.clientId?.trim() || undefined) ||
      !!getStoredOAuthToken();
    if (!open || tab !== 'ai' || aiProvider !== 'copilot' || !hasCopilotAccess) return;
    let cancelled = false;
    setAICopilotModelsLoading(true);
    fetchCopilotModels(workspace?.config.githubOAuth?.clientId?.trim() || undefined)
      .then((models) => {
        if (!cancelled && models.length > 0) setAICopilotModels(models);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setAICopilotModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab, aiProvider, workspace?.config.githubOAuth?.clientId]);

  function buildWorkspaceFeatures(existing?: WorkspaceFeatureConfig): WorkspaceFeatureConfig | undefined {
    const nextCanvas = applyCapabilityOverride(existing?.canvas, wsCanvasAgentTools) as WorkspaceFeatureConfig['canvas'];
    const nextSpreadsheet = applyCapabilityOverride(existing?.spreadsheet, wsSpreadsheetAgentTools) as WorkspaceFeatureConfig['spreadsheet'];
    const nextWeb = applyCapabilityOverride(existing?.web, wsWebAgentTools) as WorkspaceFeatureConfig['web'];

    const nextFeatures: WorkspaceFeatureConfig = {
      ...existing,
      markdown: wsMarkdownMermaid
        ? { ...existing?.markdown, mermaid: true }
        : existing?.markdown
          ? Object.fromEntries(
              Object.entries(existing.markdown).filter(([key]) => key !== 'mermaid'),
            ) as WorkspaceFeatureConfig['markdown']
          : undefined,
      canvas: nextCanvas,
      spreadsheet: nextSpreadsheet,
      web: nextWeb,
    };

    if (nextFeatures.markdown && Object.keys(nextFeatures.markdown).length === 0) {
      delete nextFeatures.markdown;
    }
    if (nextFeatures.canvas && Object.keys(nextFeatures.canvas).length === 0) {
      delete nextFeatures.canvas;
    }
    if (nextFeatures.spreadsheet && Object.keys(nextFeatures.spreadsheet).length === 0) {
      delete nextFeatures.spreadsheet;
    }
    if (nextFeatures.web && Object.keys(nextFeatures.web).length === 0) {
      delete nextFeatures.web;
    }
    if (nextFeatures.code && Object.keys(nextFeatures.code).length === 0) {
      delete nextFeatures.code;
    }

    return Object.keys(nextFeatures).length > 0 ? nextFeatures : undefined;
  }

  const { t } = useTranslation();

  // ── Account state (premium entitlement) ──────────────────────────────────
  const { account, loading: accountLoading, refresh: refreshAccount } = useAccountState();
  const hasCopilotAuth = !!getStoredOAuthToken(wsGitHubClientId.trim() || undefined) || !!getStoredOAuthToken();
  const effectiveCapabilityState = workspace ? getAgentCapabilityState(workspace) : null;
  const currentSyncEntry = currentWorkspaceGitUrl
    ? syncWorkspaces.find((entry) => entry.gitUrl === currentWorkspaceGitUrl) ?? null
    : null;
  const providerConfigured: Record<AIProviderType, boolean> = {
    copilot: hasCopilotAuth,
    openai: !!getProviderKey('openai'),
    anthropic: !!getProviderKey('anthropic'),
    groq: !!getProviderKey('groq'),
    google: !!getProviderKey('google'),
    custom: !!getCustomEndpoint() && !!getCustomModelId(),
  };
  const copilotModelOptions = Array.from(
    new Map((aiCopilotModels.length > 0 ? aiCopilotModels : FALLBACK_MODELS).map((model) => [model.id, model])).values(),
  );
  const providerModelOptions = aiProvider === 'copilot'
    ? copilotModelOptions.map((model) => ({ id: model.id, label: model.name }))
    : aiProvider === 'custom'
    ? [] // custom model is a text input, not a dropdown
    : PROVIDER_CATALOG[aiProvider as Exclude<AIProviderType, 'copilot' | 'custom'>].map((model) => ({
        id: model.id,
        label: model.name,
      }));
  const resolvedProviderModelOptions = providerModelOptions.some((model) => model.id === aiModel)
    ? providerModelOptions
    : [...providerModelOptions, { id: aiModel, label: aiModel || 'Modelo atual' }].filter((model) => model.id);

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
            className={`sm-tab ${tab === 'ai' ? 'active' : ''}`}
            onClick={() => setTab('ai')}
          >IA</button>
          <button
            className={`sm-tab ${tab === 'workspace' ? 'active' : ''}`}
            onClick={() => setTab('workspace')}
            disabled={!workspace}
          >{t('settings.tabWorkspace')}</button>
          <button
            className={`sm-tab ${tab === 'agent' ? 'active' : ''}`}
            onClick={() => setTab('agent')}
            disabled={!workspace}
          >Agente</button>
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
            <GeneralTab
              appSettings={appSettings}
              onAppSettingsChange={onAppSettingsChange}
              globalVercelToken={globalVercelToken}
              onGlobalVercelTokenChange={setGlobalVercelToken}
              vercelTokenSaved={vercelTokenSaved}
              onSaveVercelToken={handleSaveVercelToken}
              onOpenHelp={onOpenHelp}
              onContactUs={onContactUs}
            />
          )}

          {/* ── AI tab ── */}
          {tab === 'ai' && (
            <AITab
              appSettings={appSettings}
              onAppSettingsChange={onAppSettingsChange}
              aiProvider={aiProvider}
              onAIProviderChange={handleAIProviderChange}
              aiProviderKey={aiProviderKey}
              setAIProviderKey={setAIProviderKey}
              aiModel={aiModel}
              setAIModel={setAIModel}
              aiKeySaved={aiKeySaved}
              onSaveAIKey={handleSaveAIKey}
              aiModelSaved={aiModelSaved}
              onSaveAIModel={handleSaveAIModel}
              aiFavoriteIds={aiFavoriteIds}
              setAIFavoriteIds={setAIFavoriteIds}
              customModelInput={customModelInput}
              setCustomModelInput={setCustomModelInput}
              onAddCustomModel={addCustomModel}
              customEndpointDraft={customEndpointDraft}
              setCustomEndpointDraft={setCustomEndpointDraft}
              customDiagnostic={customDiagnostic}
              customDiagnosticLoading={customDiagnosticLoading}
              onClearCustomDiagnostic={() => setCustomDiagnostic(null)}
              onTestCustomEndpoint={() => void handleTestCustomEndpoint()}
              onSaveCustomConfig={handleSaveCustomConfig}
              hasCopilotAuth={hasCopilotAuth}
              aiCopilotModelsLoading={aiCopilotModelsLoading}
              providerConfigured={providerConfigured}
              resolvedProviderModelOptions={resolvedProviderModelOptions}
            />
          )}

          {/* ── Workspace tab ── */}
          {tab === 'workspace' && workspace && (
            <WorkspaceTab
              workspace={workspace}
              wsName={wsName}
              setWsName={setWsName}
              wsVercelToken={wsVercelToken}
              setWsVercelToken={setWsVercelToken}
              wsVercelTeamId={wsVercelTeamId}
              setWsVercelTeamId={setWsVercelTeamId}
              wsVercelDemoHubProject={wsVercelDemoHubProject}
              setWsVercelDemoHubProject={setWsVercelDemoHubProject}
              wsVercelDemoHubSourceDir={wsVercelDemoHubSourceDir}
              setWsVercelDemoHubSourceDir={setWsVercelDemoHubSourceDir}
              wsSidebarButtons={wsSidebarButtons}
              setWsSidebarButtons={setWsSidebarButtons}
              wsInboxFile={wsInboxFile}
              setWsInboxFile={setWsInboxFile}
              wsGitBranch={wsGitBranch}
              setWsGitBranch={setWsGitBranch}
              newBtnLabel={newBtnLabel}
              setNewBtnLabel={setNewBtnLabel}
              newBtnCmd={newBtnCmd}
              setNewBtnCmd={setNewBtnCmd}
              newBtnDesc={newBtnDesc}
              setNewBtnDesc={setNewBtnDesc}
              wsSaving={wsSaving}
              wsSaved={wsSaved}
              onWsSave={handleWsSave}
            />
          )}
          {/* ── Agent tab ── */}
          {tab === 'agent' && workspace && (
            <AgentTab
              workspace={workspace}
              wsLanguage={wsLanguage}
              setWsLanguage={setWsLanguage}
              wsAgent={wsAgent}
              setWsAgent={setWsAgent}
              wsMarkdownMermaid={wsMarkdownMermaid}
              setWsMarkdownMermaid={setWsMarkdownMermaid}
              wsCanvasAgentTools={wsCanvasAgentTools}
              setWsCanvasAgentTools={setWsCanvasAgentTools}
              wsSpreadsheetAgentTools={wsSpreadsheetAgentTools}
              setWsSpreadsheetAgentTools={setWsSpreadsheetAgentTools}
              wsWebAgentTools={wsWebAgentTools}
              setWsWebAgentTools={setWsWebAgentTools}
              wsGitHubClientId={wsGitHubClientId}
              setWsGitHubClientId={setWsGitHubClientId}
              effectiveCapabilityState={effectiveCapabilityState}
              getCapabilityModeDescription={getCapabilityModeDescription}
              wsSaving={wsSaving}
              wsSaved={wsSaved}
              onWsSave={handleWsSave}
            />
          )}

          {/* ── Sync tab ── */}
          {tab === 'sync' && (
            <SyncTab
              workspace={workspace}
              syncStatus={syncStatus}
              syncUser={syncUser}
              syncWorkspaces={syncWorkspaces}
              onSignOut={handleSignOut}
              showGitDetails={showGitDetails}
              setShowGitDetails={setShowGitDetails}
              currentSyncEntry={currentSyncEntry}
              regLabel={regLabel}
              setRegLabel={setRegLabel}
              regState={regState}
              regError={regError}
              onRegister={handleRegister}
              gitAccounts={gitAccounts}
              activateSyncBusy={activateSyncBusy}
              activateSyncFlowState={activateSyncFlowState}
              gitFlowBusy={gitFlowBusy}
              gitFlowState={gitFlowState}
              showSyncAdvanced={showSyncAdvanced}
              setShowSyncAdvanced={setShowSyncAdvanced}
              syncAdvancedMode={syncAdvancedMode}
              setSyncAdvancedMode={setSyncAdvancedMode}
              syncAdvancedRepoName={syncAdvancedRepoName}
              setSyncAdvancedRepoName={setSyncAdvancedRepoName}
              syncAdvancedPrivate={syncAdvancedPrivate}
              setSyncAdvancedPrivate={setSyncAdvancedPrivate}
              syncAdvancedUrl={syncAdvancedUrl}
              setSyncAdvancedUrl={setSyncAdvancedUrl}
              onActivateSync={handleActivateSync}
              gitLabel={gitLabel}
              setGitLabel={setGitLabel}
              onConnectGitAccount={handleConnectGitAccount}
              onUnregister={handleUnregister}
              syncError={syncError}
              onNavigateToAccount={() => setTab('account')}
            />
          )}

          {/* ── Account tab ── */}
          {tab === 'account' && (
            <AccountTab
              syncStatus={syncStatus}
              syncUser={syncUser}
              onSignOut={handleSignOut}
              emailInput={emailInput}
              setEmailInput={setEmailInput}
              passwordInput={passwordInput}
              setPasswordInput={setPasswordInput}
              authMode={authMode}
              setAuthMode={setAuthMode}
              authBusy={authBusy}
              onAuth={handleAuth}
              syncError={syncError}
              setSyncError={setSyncError}
              account={account}
              accountLoading={accountLoading}
              onRefreshAccount={refreshAccount}
              billingLocale={billingLocale}
              premiumPageUrl={premiumPageUrl}
              billingBusy={billingBusy}
              onOpenCheckout={handleOpenCheckout}
              onOpenCustomerPortal={handleOpenCustomerPortal}
            />
          )}

        </div>
      </div>
    </div>,
    document.body
  );
}
