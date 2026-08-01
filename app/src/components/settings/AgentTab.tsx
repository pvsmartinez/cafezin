import { useTranslation } from 'react-i18next';
import type { Workspace } from '../../types';

export type CapabilityOverrideMode = 'auto' | 'on' | 'off';

export interface AgentTabProps {
  workspace: Workspace;
  wsLanguage: string;
  setWsLanguage: (v: string) => void;
  wsAgent: string;
  setWsAgent: (v: string) => void;
  wsMarkdownMermaid: CapabilityOverrideMode;
  setWsMarkdownMermaid: (v: CapabilityOverrideMode) => void;
  wsCanvasAgentTools: CapabilityOverrideMode;
  setWsCanvasAgentTools: (v: CapabilityOverrideMode) => void;
  wsSpreadsheetAgentTools: CapabilityOverrideMode;
  setWsSpreadsheetAgentTools: (v: CapabilityOverrideMode) => void;
  wsWebAgentTools: CapabilityOverrideMode;
  setWsWebAgentTools: (v: CapabilityOverrideMode) => void;
  wsGitHubClientId: string;
  setWsGitHubClientId: (v: string) => void;
  effectiveCapabilityState: { markdownMermaid: boolean; canvas: boolean; spreadsheet: boolean; web: boolean } | null;
  getCapabilityModeDescription: (
    mode: CapabilityOverrideMode,
    effective: boolean,
    enabledLabel: string,
    disabledLabel: string,
  ) => string;
  wsSaving: boolean;
  wsSaved: boolean;
  onWsSave: () => void;
}

export function AgentTab({
  wsLanguage,
  setWsLanguage,
  wsAgent,
  setWsAgent,
  wsMarkdownMermaid,
  setWsMarkdownMermaid,
  wsCanvasAgentTools,
  setWsCanvasAgentTools,
  wsSpreadsheetAgentTools,
  setWsSpreadsheetAgentTools,
  wsWebAgentTools,
  setWsWebAgentTools,
  wsGitHubClientId,
  setWsGitHubClientId,
  effectiveCapabilityState,
  getCapabilityModeDescription,
  wsSaving,
  wsSaved,
  onWsSave,
}: AgentTabProps) {
  const { t } = useTranslation();

  return (
    <div className="sm-section-list">

      <section className="sm-section">
        <h3 className="sm-section-title">{t('settings.agentHelpTitle')}</h3>

        <div className="sm-row sm-row--col">
          <label className="sm-label">
            {t('settings.defaultResponseLanguageLabel')}
            <span className="sm-row-desc"> {t('settings.defaultResponseLanguageHint')}</span>
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
            {t('settings.agentInstructionsLabel')}
            <span className="sm-row-desc"> {t('settings.agentInstructionsHint')}</span>
          </label>
          <textarea
            className="sm-textarea"
            value={wsAgent}
            onChange={(e) => setWsAgent(e.target.value)}
            placeholder={t('settings.agentInstructionsPlaceholder') ?? ''}
            rows={10}
          />
        </div>
      </section>

      <section className="sm-section">
        <h3 className="sm-section-title">{t('settings.workspaceCapabilitiesTitle')}</h3>
        <p className="sm-section-desc">
          {t('settings.workspaceCapabilitiesDesc')}
        </p>

        <div className="sm-row">
          <div className="sm-row-label">
            <span>{t('settings.workspaceMarkdownMermaidLabel')}</span>
            <span className="sm-row-desc">{t('settings.workspaceMarkdownMermaidDesc')} {getCapabilityModeDescription(wsMarkdownMermaid, effectiveCapabilityState?.markdownMermaid ?? false, t('settings.enabledShort'), t('settings.disabledShort'))}</span>
          </div>
          <select
            className="sm-select"
            value={wsMarkdownMermaid}
            onChange={(e) => setWsMarkdownMermaid(e.target.value as CapabilityOverrideMode)}
          >
            <option value="auto">{t('settings.modeAuto')}</option>
            <option value="on">{t('settings.modeOn')}</option>
            <option value="off">{t('settings.modeOff')}</option>
          </select>
        </div>

        <div className="sm-row">
          <div className="sm-row-label">
            <span>{t('settings.canvasToolsLabel')}</span>
            <span className="sm-row-desc">{t('settings.canvasToolsDesc')} {getCapabilityModeDescription(wsCanvasAgentTools, effectiveCapabilityState?.canvas ?? false, t('settings.enabledShort'), t('settings.disabledShort'))}</span>
          </div>
          <select
            className="sm-select"
            value={wsCanvasAgentTools}
            onChange={(e) => setWsCanvasAgentTools(e.target.value as CapabilityOverrideMode)}
          >
            <option value="auto">{t('settings.modeAuto')}</option>
            <option value="on">{t('settings.modeOn')}</option>
            <option value="off">{t('settings.modeOff')}</option>
          </select>
        </div>

        <div className="sm-row">
          <div className="sm-row-label">
            <span>{t('settings.spreadsheetToolsLabel')}</span>
            <span className="sm-row-desc">{t('settings.spreadsheetToolsDesc')} {getCapabilityModeDescription(wsSpreadsheetAgentTools, effectiveCapabilityState?.spreadsheet ?? false, t('settings.enabledShort'), t('settings.disabledShort'))}</span>
          </div>
          <select
            className="sm-select"
            value={wsSpreadsheetAgentTools}
            onChange={(e) => setWsSpreadsheetAgentTools(e.target.value as CapabilityOverrideMode)}
          >
            <option value="auto">{t('settings.modeAuto')}</option>
            <option value="on">{t('settings.modeOn')}</option>
            <option value="off">{t('settings.modeOff')}</option>
          </select>
        </div>

        <div className="sm-row">
          <div className="sm-row-label">
            <span>{t('settings.webToolsLabel')}</span>
            <span className="sm-row-desc">{t('settings.webToolsDesc')} {getCapabilityModeDescription(wsWebAgentTools, effectiveCapabilityState?.web ?? false, t('settings.enabledShort'), t('settings.disabledShort'))}</span>
          </div>
          <select
            className="sm-select"
            value={wsWebAgentTools}
            onChange={(e) => setWsWebAgentTools(e.target.value as CapabilityOverrideMode)}
          >
            <option value="auto">{t('settings.modeAuto')}</option>
            <option value="on">{t('settings.modeOn')}</option>
            <option value="off">{t('settings.modeOff')}</option>
          </select>
        </div>
      </section>

      <section className="sm-section">
        <h3 className="sm-section-title">{t('settings.workspaceCopilotTitle')}</h3>

        <div className="sm-row sm-row--col">
          <label className="sm-label">
            GitHub OAuth Client ID
            <span className="sm-row-desc"> {t('settings.githubOAuthClientIdHint')}</span>
          </label>
          <input
            className="sm-input"
            value={wsGitHubClientId}
            onChange={(e) => setWsGitHubClientId(e.target.value)}
            placeholder="Iv1.1234567890abcdef"
          />
          <p className="sm-section-desc" style={{ marginTop: 8 }}>
            {t('settings.githubOAuthClientIdDescPrefix')} <strong>Device Flow</strong> {t('settings.githubOAuthClientIdDescMid')} <strong>Client ID</strong>.
          </p>
        </div>
      </section>

      <div className="sm-footer">
        <button
          className={`sm-save-btn ${wsSaved ? 'saved' : ''}`}
          onClick={onWsSave}
          disabled={wsSaving}
        >
          {wsSaving ? t('settings.wsSaving') : wsSaved ? t('settings.wsSavedDone') : t('settings.agentSaveButton')}
        </button>
      </div>

    </div>
  );
}
