import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PROVIDER_LABELS,
  type CustomEndpointDiagnostic,
  type AIProviderType,
} from '../../services/aiProvider';
import type { ProviderModelInfo } from '../../services/ai/providerModels';
import { setFavoriteModelIds } from '../../services/ai/providerModels';
import type { AccountState, AppSettings } from '../../types';

const MANAGED_TIER_NAMES: Record<Exclude<AccountState['aiTier'], 'none'>, string> = {
  basic: 'Basic',
  standard: 'Standard',
  pro: 'Pro',
};

export interface AITabProps {
  appSettings: AppSettings;
  onAppSettingsChange: (s: AppSettings) => void;
  aiProvider: AIProviderType;
  onAIProviderChange: (p: AIProviderType) => void;
  aiProviderKey: string;
  setAIProviderKey: (v: string) => void;
  aiModel: string;
  setAIModel: (v: string) => void;
  aiKeySaved: boolean;
  onSaveAIKey: () => void;
  aiModelSaved: boolean;
  onSaveAIModel: () => void;
  aiFavoriteIds: string[];
  setAIFavoriteIds: (ids: string[]) => void;
  customModelInput: string;
  setCustomModelInput: (v: string) => void;
  onAddCustomModel: () => void;
  customEndpointDraft: string;
  setCustomEndpointDraft: (v: string) => void;
  customDiagnostic: CustomEndpointDiagnostic | null;
  customDiagnosticLoading: boolean;
  onClearCustomDiagnostic: () => void;
  onTestCustomEndpoint: () => void;
  onSaveCustomConfig: () => void;
  hasCopilotAuth: boolean;
  aiCopilotModelsLoading: boolean;
  aiProviderModelsLoading: boolean;
  aiProviderModelsError: string | null;
  aiProviderModelsUpdatedAt: string | null;
  canRefreshProviderModels: boolean;
  onRefreshProviderModels: () => void;
  providerConfigured: Record<AIProviderType, boolean>;
  providerModelCatalog: ProviderModelInfo[];
  resolvedProviderModelOptions: { id: string; label: string }[];
  account: AccountState;
  premiumPageUrl: string;
}

export function AITab({
  appSettings,
  onAppSettingsChange,
  aiProvider,
  onAIProviderChange,
  aiProviderKey,
  setAIProviderKey,
  aiModel,
  setAIModel,
  aiKeySaved,
  onSaveAIKey,
  aiModelSaved,
  onSaveAIModel,
  aiFavoriteIds,
  setAIFavoriteIds,
  customModelInput,
  setCustomModelInput,
  onAddCustomModel,
  customEndpointDraft,
  setCustomEndpointDraft,
  customDiagnostic,
  customDiagnosticLoading,
  onClearCustomDiagnostic,
  onTestCustomEndpoint,
  onSaveCustomConfig,
  hasCopilotAuth,
  aiCopilotModelsLoading,
  aiProviderModelsLoading,
  aiProviderModelsError,
  aiProviderModelsUpdatedAt,
  canRefreshProviderModels,
  onRefreshProviderModels,
  providerConfigured,
  providerModelCatalog,
  resolvedProviderModelOptions,
  account,
  premiumPageUrl,
}: AITabProps) {
  const { t } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(aiProvider !== 'cafezin');

  function setApp<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    onAppSettingsChange({ ...appSettings, [key]: value });
  }

  const tierLabel = account.aiTier === 'none' ? t('settings.aiTierNone') : MANAGED_TIER_NAMES[account.aiTier];

  return (
    <div className="sm-section-list">

      <section className="sm-section">
        <h3 className="sm-section-title">{t('settings.aiBehaviorSectionTitle')}</h3>

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
        <h3 className="sm-section-title">{t('settings.aiProviderSectionTitle')}</h3>

        {/* ── Cafezin IA — primary option ── */}
        <div className={`sm-cafezin-ia-card${aiProvider === 'cafezin' ? ' active' : ''}`}>
          <div className="sm-cafezin-ia-card-header">
            <div className="sm-cafezin-ia-card-info">
              <span className="sm-cafezin-ia-card-name">Cafezin IA</span>
              <span className="sm-cafezin-ia-card-tag">
                {account.aiTier === 'none' ? t('settings.aiFreeResponses') : t('settings.aiPlanActive', { plan: tierLabel })}
              </span>
            </div>
            <button
              type="button"
              className={`sm-save-btn${aiProvider === 'cafezin' ? ' saved' : ''}`}
              onClick={() => { onAIProviderChange('cafezin'); setShowAdvanced(false); }}
            >
              {aiProvider === 'cafezin' ? `${t('settings.inUse')} ✓` : t('settings.useProvider')}
            </button>
          </div>
          {aiProvider === 'cafezin' && (
            <div className="sm-cafezin-ia-card-body">
              <p className="sm-row-desc">
                {account.aiTier === 'none'
                  ? t('settings.aiCafezinFreeDesc')
                  : t('settings.aiCafezinPlanDesc', { plan: tierLabel })}
              </p>
              {account.aiTier === 'none' && (
                <a
                  className="sm-save-btn"
                  href={premiumPageUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: 'inline-block', textDecoration: 'none', marginTop: 8 }}
                >
                  {t('settings.viewPlans')}
                </a>
              )}
            </div>
          )}
        </div>

        {/* ── Advanced: BYOK providers ── */}
        <button
          type="button"
          className="sm-advanced-toggle"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          <span className="sm-advanced-toggle-arrow">{showAdvanced ? '▾' : '▸'}</span>
          {t('settings.useOwnApiKey')}
          {aiProvider !== 'cafezin' && (
            <span className="sm-advanced-toggle-badge">{t('settings.inUseWith', { provider: PROVIDER_LABELS[aiProvider] })}</span>
          )}
        </button>

        {showAdvanced && (
          <>
            <p className="sm-section-desc" style={{ marginTop: 4 }}>
              {t('settings.advancedProviderDesc')}
            </p>

            <div className="sm-provider-grid">
              {(Object.keys(PROVIDER_LABELS) as AIProviderType[]).filter((p) => p !== 'cafezin').map((provider) => (
                <button
                  key={provider}
                  type="button"
                  className={`sm-provider-card ${aiProvider === provider ? 'active' : ''}`}
                  onClick={() => onAIProviderChange(provider)}
                >
                  <span className="sm-provider-card-title">{PROVIDER_LABELS[provider]}</span>
                  <span className={`sm-provider-card-status ${providerConfigured[provider] ? 'is-ready' : ''}`}>
                    {provider === 'copilot'
                      ? providerConfigured[provider] ? t('settings.connected') : t('settings.copilotLoginViaChat')
                      : provider === 'custom'
                      ? providerConfigured[provider] ? t('settings.configured') : t('settings.configureAction')
                      : providerConfigured[provider] ? t('settings.keySaved') : t('settings.noKey')}
                  </span>
                  {aiProvider === provider && (
                    <span className="sm-provider-card-active">{t('settings.inUse')}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Key config for selected BYOK provider */}
            {aiProvider !== 'cafezin' && aiProvider !== 'copilot' && aiProvider !== 'custom' && (
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
                  {aiProvider === 'google' && (
                    <span className="sm-row-desc"> —{' '}
                      <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">aistudio.google.com</a>
                    </span>
                  )}
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="sm-input"
                    type="password"
                    value={aiProviderKey}
                    onChange={(e) => setAIProviderKey(e.target.value)}
                    placeholder={aiProvider === 'openai' ? 'sk-...' : aiProvider === 'anthropic' ? 'sk-ant-...' : aiProvider === 'google' ? 'AIza...' : 'gsk_...'}
                    style={{ flex: 1 }}
                  />
                  <button
                    className={`sm-save-btn ${aiKeySaved ? 'saved' : ''}`}
                    onClick={onSaveAIKey}
                  >
                    {aiKeySaved ? t('settings.saved') : t('settings.save')}
                  </button>
                </div>
              </div>
            )}

            {/* Custom / Local provider: endpoint + model ID + diagnostic */}
            {aiProvider === 'custom' && (
              <div className="sm-custom-section">
                <div className="sm-custom-notice">
                  {t('settings.customCompatiblePrefix')} <strong>OpenAI-compatible</strong> {t('settings.customCompatibleSuffix')}
                </div>

                <div className="sm-row sm-row--col">
                  <label className="sm-label">
                    {t('settings.serverUrlLabel')} <span style={{ color: 'var(--red, #e53e3e)' }}>*</span>
                    <span className="sm-row-desc"> — {t('settings.serverUrlHint')}</span>
                  </label>
                  <input
                    className="sm-input"
                    type="text"
                    value={customEndpointDraft}
                    onChange={(e) => { setCustomEndpointDraft(e.target.value); onClearCustomDiagnostic(); }}
                    placeholder="http://localhost:11434/v1"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>

                <div className="sm-row sm-row--col">
                  <label className="sm-label">
                    {t('settings.customApiKeyLabel')}
                    <span className="sm-row-desc"> — {t('settings.customApiKeyHint')}</span>
                  </label>
                  <input
                    className="sm-input"
                    type="password"
                    value={aiProviderKey}
                    onChange={(e) => { setAIProviderKey(e.target.value); onClearCustomDiagnostic(); }}
                    placeholder={t('settings.customApiKeyPlaceholder') ?? ''}
                  />
                </div>

                <div className="sm-row sm-row--col">
                  <label className="sm-label">
                    {t('settings.modelIdLabel')} <span style={{ color: 'var(--red, #e53e3e)' }}>*</span>
                    <span className="sm-row-desc"> — {t('settings.modelIdHint')}</span>
                  </label>
                  <input
                    className="sm-input"
                    type="text"
                    value={aiModel}
                    onChange={(e) => { setAIModel(e.target.value); onClearCustomDiagnostic(); }}
                    placeholder="llama3.2"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button
                    className={`sm-save-btn ${aiKeySaved ? 'saved' : ''}`}
                    onClick={onSaveCustomConfig}
                    disabled={!customEndpointDraft.trim() || !aiModel.trim()}
                  >
                    {aiKeySaved ? t('settings.saved') : t('settings.save')}
                  </button>
                  <button
                    className="sm-custom-test-btn"
                    onClick={() => onTestCustomEndpoint()}
                    disabled={!customEndpointDraft.trim() || !aiModel.trim() || customDiagnosticLoading}
                  >
                    {customDiagnosticLoading ? t('settings.testingConnection') : t('settings.testConnection')}
                  </button>
                </div>

                {customDiagnostic && (
                  <div className={`sm-custom-diagnostic ${customDiagnostic.ok ? 'ok' : 'error'}`}>
                    {customDiagnostic.ok
                      ? t('settings.customDiagnosticOk', { ms: customDiagnostic.latencyMs })
                      : t('settings.customDiagnosticError', { error: customDiagnostic.error, hint: customDiagnostic.hint })}
                  </div>
                )}

                <div className="sm-custom-limitations">
                  <strong>{t('settings.limitationsLabel')}</strong> {t('settings.limitationNoVision')}
                  {t('settings.limitationApiSupportPrefix')} <code>/v1/chat/completions</code>{t('settings.limitationApiSupportSuffix')}
                  {t('settings.limitationLocalOnly')}
                </div>
              </div>
            )}

            {aiProvider === 'copilot' && (
              <div className="sm-row sm-row--col">
                <label className="sm-label">GitHub Copilot</label>
                <span className="sm-row-desc">
                  {hasCopilotAuth
                    ? t('settings.copilotReadyDesc')
                    : t('settings.copilotLoginDesc')}
                </span>
              </div>
            )}
          </>
        )}
      </section>

      {/* Default model — hidden for custom (model is set in the provider section above) */}
      {aiProvider !== 'custom' && (
      <section className="sm-section">
        <h3 className="sm-section-title">{t('settings.defaultModelSectionTitle')}</h3>
        <p className="sm-section-desc">
          {t('settings.defaultModelSectionDesc')}
        </p>

        <div className="sm-row sm-row--col">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="sm-row-desc">
              {aiProvider === 'copilot'
                ? t('settings.modelListCopilotDesc')
                : aiProvider === 'cafezin'
                ? t('settings.modelListCafezinDesc')
                : t('settings.modelListRefreshDesc')}
            </span>
            <button
              className="sm-save-btn"
              onClick={onRefreshProviderModels}
              disabled={!canRefreshProviderModels || aiProviderModelsLoading}
            >
              {aiProviderModelsLoading ? t('settings.updatingList') : t('settings.refreshList')}
            </button>
          </div>
          {aiProviderModelsUpdatedAt && (
            <span className="sm-row-desc">
              {t('settings.lastUpdatedPrefix')} {new Date(aiProviderModelsUpdatedAt).toLocaleString()}
            </span>
          )}
          {aiProviderModelsError && (
            <span className="sm-row-desc" style={{ color: 'var(--red, #e53e3e)' }}>
              {aiProviderModelsError}
            </span>
          )}
        </div>

        <div className="sm-row sm-row--col">
          <label className="sm-label">{t('settings.defaultModelLabel')}</label>
          {aiProvider === 'copilot' && aiCopilotModelsLoading && (
            <span className="sm-row-desc">{t('settings.loadingCopilotModels')}</span>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              className="sm-input"
              value={aiModel}
              onChange={(e) => setAIModel(e.target.value)}
              style={{ flex: 1 }}
            >
              {resolvedProviderModelOptions.map((model) => (
                <option key={model.id} value={model.id}>{model.label}</option>
              ))}
            </select>
            <button
              className={`sm-save-btn ${aiModelSaved ? 'saved' : ''}`}
              onClick={onSaveAIModel}
            >
              {aiModelSaved ? t('settings.saved') : t('settings.save')}
            </button>
          </div>
        </div>

        {aiProvider !== 'copilot' && aiProvider !== 'cafezin' && (() => {
          const catalog = providerModelCatalog;
          const catalogIds = new Set(catalog.map((m) => m.id));
          const customFavIds = aiFavoriteIds.filter((id) => !catalogIds.has(id));
          return (
            <div className="sm-row sm-row--col">
              <label className="sm-label">
                {t('settings.visibleModelsLabel')}
                <span className="sm-row-desc"> — {t('settings.visibleModelsHint')}</span>
              </label>
              <div className="sm-model-list">
                {catalog.map((m) => (
                  <label key={m.id} className="sm-model-item">
                    <input
                      type="checkbox"
                      checked={aiFavoriteIds.includes(m.id)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...aiFavoriteIds, m.id]
                          : aiFavoriteIds.filter((id) => id !== m.id);
                        setAIFavoriteIds(next);
                        setFavoriteModelIds(aiProvider as Exclude<AIProviderType, 'copilot' | 'custom' | 'cafezin'>, next);
                      }}
                    />
                    <span>{m.name}</span>
                    <span className="sm-model-item-meta">
                      {m.supportsVision ? t('settings.visionShort') : t('settings.textShort')}
                    </span>
                  </label>
                ))}
                {customFavIds.map((id) => (
                  <label key={id} className="sm-model-item">
                    <input
                      type="checkbox"
                      checked
                      onChange={() => {
                        const next = aiFavoriteIds.filter((i) => i !== id);
                        setAIFavoriteIds(next);
                        setFavoriteModelIds(aiProvider as Exclude<AIProviderType, 'copilot' | 'custom' | 'cafezin'>, next);
                      }}
                    />
                    <span>{id}</span>
                    <span className="sm-model-item-meta">{t('settings.customLabel')}</span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <input
                  className="sm-input"
                  type="text"
                  placeholder={t('settings.customModelIdPlaceholder') ?? ''}
                  value={customModelInput}
                  onChange={(e) => setCustomModelInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onAddCustomModel(); }}
                  style={{ flex: 1 }}
                />
                <button
                  className="sm-save-btn"
                  onClick={onAddCustomModel}
                  disabled={!customModelInput.trim()}
                >
                  + {t('settings.addModel')}
                </button>
              </div>
            </div>
          );
        })()}
      </section>

      )} {/* end aiProvider !== 'custom' */}

    </div>
  );
}
