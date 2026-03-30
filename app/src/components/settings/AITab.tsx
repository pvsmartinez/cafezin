import { useTranslation } from 'react-i18next';
import {
  PROVIDER_LABELS,
  type CustomEndpointDiagnostic,
  type AIProviderType,
} from '../../services/aiProvider';
import type { ProviderModelInfo } from '../../services/ai/providerModels';
import { setFavoriteModelIds } from '../../services/ai/providerModels';
import type { AccountState, AppSettings } from '../../types';

const MANAGED_TIER_LABELS: Record<AccountState['aiTier'], string> = {
  none: 'Sem plano',
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

  function setApp<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    onAppSettingsChange({ ...appSettings, [key]: value });
  }

  return (
    <div className="sm-section-list">

      <section className="sm-section">
        <h3 className="sm-section-title">Comportamento da IA</h3>

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
        <h3 className="sm-section-title">Providers</h3>
        <p className="sm-section-desc">
          Você pode deixar mais de um provider configurado e trocar qual fica ativo no chat.
        </p>

        <div className="sm-provider-grid">
          {(Object.keys(PROVIDER_LABELS) as AIProviderType[]).map((provider) => (
            <button
              key={provider}
              type="button"
              className={`sm-provider-card ${aiProvider === provider ? 'active' : ''}`}
              onClick={() => onAIProviderChange(provider)}
            >
              <span className="sm-provider-card-title">{PROVIDER_LABELS[provider]}</span>
              <span className={`sm-provider-card-status ${providerConfigured[provider] ? 'is-ready' : ''}`}>
                {provider === 'copilot'
                  ? providerConfigured[provider] ? 'Conectado' : 'Entrar pelo chat'
                  : provider === 'cafezin'
                  ? providerConfigured[provider] ? `${MANAGED_TIER_LABELS[account.aiTier]} ativo` : 'Basic ou superior'
                  : provider === 'custom'
                  ? providerConfigured[provider] ? 'Configurado' : 'Configurar'
                  : providerConfigured[provider] ? 'Chave salva' : 'Sem chave'}
              </span>
              {aiProvider === provider && (
                <span className="sm-provider-card-active">Em uso</span>
              )}
            </button>
          ))}
        </div>

        {/* Standard providers: API key field */}
        {aiProvider === 'cafezin' && (
          <div className="sm-custom-section">
            <div className="sm-custom-notice">
              A <strong>Cafezin IA</strong> usa o proxy gerenciado do app. Para usar qualquer IA no Cafezin,
              sua conta precisa estar no plano <strong>Basic ou superior</strong>.
            </div>

            <div className="sm-row sm-row--col">
              <label className="sm-label">Status da conta</label>
              <span className="sm-row-desc">
                {account.aiTier === 'none'
                  ? 'Sua conta atual ainda não tem acesso a Cafezin IA.'
                  : `Plano ${MANAGED_TIER_LABELS[account.aiTier]} ativo. Os modelos disponíveis abaixo seguem seu tier.`}
              </span>
            </div>

            <div className="sm-row sm-row--col">
              <label className="sm-label">Como funciona</label>
              <div className="sm-custom-limitations">
                O Cafezin autentica pela sua conta, aplica sua cota mensal e libera os modelos compatíveis com o seu plano.
                Se a sua cota acabar, você pode fazer upgrade na web ou trocar para outro provider com BYOK.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              <a
                className="sm-save-btn"
                href={premiumPageUrl}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'inline-block', textDecoration: 'none' }}
              >
                Ver planos na web ↗
              </a>
            </div>
          </div>
        )}

        {aiProvider !== 'copilot' && aiProvider !== 'custom' && aiProvider !== 'cafezin' && (
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
              Compatível com qualquer servidor <strong>OpenAI-compatible</strong>: Ollama, LM Studio, Jan, vLLM, OpenRouter, ou seu próprio proxy.
            </div>

            <div className="sm-row sm-row--col">
              <label className="sm-label">
                URL do servidor <span style={{ color: 'var(--red, #e53e3e)' }}>*</span>
                <span className="sm-row-desc"> — deve apontar para a raiz da API (ex: /v1)</span>
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
                Chave da API
                <span className="sm-row-desc"> — opcional; não obrigatório para Ollama / LM Studio</span>
              </label>
              <input
                className="sm-input"
                type="password"
                value={aiProviderKey}
                onChange={(e) => { setAIProviderKey(e.target.value); onClearCustomDiagnostic(); }}
                placeholder="sk-... (deixe em branco se não houver)"
              />
            </div>

            <div className="sm-row sm-row--col">
              <label className="sm-label">
                ID do modelo <span style={{ color: 'var(--red, #e53e3e)' }}>*</span>
                <span className="sm-row-desc"> — exatamente como listado no servidor (ex: llama3.2, mistral)</span>
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
                {customDiagnosticLoading ? 'Testando…' : 'Testar conexão'}
              </button>
            </div>

            {customDiagnostic && (
              <div className={`sm-custom-diagnostic ${customDiagnostic.ok ? 'ok' : 'error'}`}>
                {customDiagnostic.ok
                  ? `✓ Servidor respondeu em ${customDiagnostic.latencyMs}ms — tudo certo!`
                  : `✗ ${customDiagnostic.error} — ${customDiagnostic.hint}`}
              </div>
            )}

            <div className="sm-custom-limitations">
              <strong>Limitações:</strong> análise de imagens / canvas visual não disponível.
              O modelo precisa suportar a API <code>/v1/chat/completions</code>.
              O endpoint e o ID do modelo ficam salvos apenas neste dispositivo.
            </div>
          </div>
        )}

        {aiProvider === 'copilot' && (
          <div className="sm-row sm-row--col">
            <label className="sm-label">GitHub Copilot</label>
            <span className="sm-row-desc">
              {hasCopilotAuth
                ? 'Conta do Copilot pronta. Se quiser trocar, faça logout e login pelo painel do chat.'
                : t('settings.copilotLoginDesc')}
            </span>
          </div>
        )}
      </section>

      {/* Default model — hidden for custom (model is set in the provider section above) */}
      {aiProvider !== 'custom' && (
      <section className="sm-section">
        <h3 className="sm-section-title">Modelo padrão</h3>
        <p className="sm-section-desc">
          Defina qual modelo este provider usa por padrão no painel de chat.
        </p>

        <div className="sm-row sm-row--col">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="sm-row-desc">
              {aiProvider === 'copilot'
                ? 'A lista do Copilot vem ao vivo da sua conta.'
                : aiProvider === 'cafezin'
                ? 'A lista da Cafezin IA é gerenciada pelo seu plano atual.'
                : 'Atualize a lista direto do provider ativo para evitar catálogo defasado.'}
            </span>
            <button
              className="sm-save-btn"
              onClick={onRefreshProviderModels}
              disabled={!canRefreshProviderModels || aiProviderModelsLoading}
            >
              {aiProviderModelsLoading ? 'Atualizando…' : 'Atualizar lista'}
            </button>
          </div>
          {aiProviderModelsUpdatedAt && (
            <span className="sm-row-desc">
              Última atualização: {new Date(aiProviderModelsUpdatedAt).toLocaleString()}
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
            <span className="sm-row-desc">Carregando modelos do Copilot…</span>
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
                Modelos visíveis no seletor
                <span className="sm-row-desc"> — escolha os que devem aparecer no chat</span>
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
                      {m.supportsVision ? 'Visão' : 'Texto'}
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
                    <span className="sm-model-item-meta">Custom</span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <input
                  className="sm-input"
                  type="text"
                  placeholder="ID do modelo custom"
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
                  + Adicionar
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
