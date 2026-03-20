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
        <h3 className="sm-section-title">Ajuda do agente</h3>

        <div className="sm-row sm-row--col">
          <label className="sm-label">
            Idioma padrão das respostas
            <span className="sm-row-desc"> — usado como preferência neste workspace</span>
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
            Instruções do agente (AGENT.md)
            <span className="sm-row-desc"> — contexto do projeto injetado em cada sessão</span>
          </label>
          <textarea
            className="sm-textarea"
            value={wsAgent}
            onChange={(e) => setWsAgent(e.target.value)}
            placeholder="Descreva o projeto, o tom esperado e o que o agente deve considerar sempre."
            rows={10}
          />
        </div>
      </section>

      <section className="sm-section">
        <h3 className="sm-section-title">Capacidades do workspace</h3>
        <p className="sm-section-desc">
          Defina aqui o que o agente pode usar. No modo automático, o Cafezin libera cada grupo quando encontra arquivos compatíveis neste workspace.
        </p>

        <div className="sm-row">
          <div className="sm-row-label">
            <span>{t('settings.workspaceMarkdownMermaidLabel')}</span>
            <span className="sm-row-desc">{t('settings.workspaceMarkdownMermaidDesc')} {getCapabilityModeDescription(wsMarkdownMermaid, effectiveCapabilityState?.markdownMermaid ?? false, 'ligado', 'desligado')}</span>
          </div>
          <select
            className="sm-select"
            value={wsMarkdownMermaid}
            onChange={(e) => setWsMarkdownMermaid(e.target.value as CapabilityOverrideMode)}
          >
            <option value="auto">Automático</option>
            <option value="on">Ligado</option>
            <option value="off">Desligado</option>
          </select>
        </div>

        <div className="sm-row">
          <div className="sm-row-label">
            <span>Ferramentas de canvas</span>
            <span className="sm-row-desc">Permite o agente inspecionar e editar canvases com `canvas_op`, shapes e screenshots. {getCapabilityModeDescription(wsCanvasAgentTools, effectiveCapabilityState?.canvas ?? false, 'ligado', 'desligado')}</span>
          </div>
          <select
            className="sm-select"
            value={wsCanvasAgentTools}
            onChange={(e) => setWsCanvasAgentTools(e.target.value as CapabilityOverrideMode)}
          >
            <option value="auto">Automático</option>
            <option value="on">Ligado</option>
            <option value="off">Desligado</option>
          </select>
        </div>

        <div className="sm-row">
          <div className="sm-row-label">
            <span>Ferramentas de planilha</span>
            <span className="sm-row-desc">Liga as tools estruturadas de CSV, TSV e XLSX no contexto do agente. {getCapabilityModeDescription(wsSpreadsheetAgentTools, effectiveCapabilityState?.spreadsheet ?? false, 'ligado', 'desligado')}</span>
          </div>
          <select
            className="sm-select"
            value={wsSpreadsheetAgentTools}
            onChange={(e) => setWsSpreadsheetAgentTools(e.target.value as CapabilityOverrideMode)}
          >
            <option value="auto">Automático</option>
            <option value="on">Ligado</option>
            <option value="off">Desligado</option>
          </select>
        </div>

        <div className="sm-row">
          <div className="sm-row-label">
            <span>Ferramentas web</span>
            <span className="sm-row-desc">Controla busca web, leitura de URLs, preview HTML e comandos usados nesse fluxo. {getCapabilityModeDescription(wsWebAgentTools, effectiveCapabilityState?.web ?? false, 'ligado', 'desligado')}</span>
          </div>
          <select
            className="sm-select"
            value={wsWebAgentTools}
            onChange={(e) => setWsWebAgentTools(e.target.value as CapabilityOverrideMode)}
          >
            <option value="auto">Automático</option>
            <option value="on">Ligado</option>
            <option value="off">Desligado</option>
          </select>
        </div>
      </section>

      <section className="sm-section">
        <h3 className="sm-section-title">Copilot neste workspace</h3>

        <div className="sm-row sm-row--col">
          <label className="sm-label">
            GitHub OAuth Client ID
            <span className="sm-row-desc"> — configuração avançada para o login do Copilot neste workspace</span>
          </label>
          <input
            className="sm-input"
            value={wsGitHubClientId}
            onChange={(e) => setWsGitHubClientId(e.target.value)}
            placeholder="Iv1.1234567890abcdef"
          />
          <p className="sm-section-desc" style={{ marginTop: 8 }}>
            Crie um OAuth App no GitHub com <strong>Device Flow</strong> e cole aqui apenas o <strong>Client ID</strong>.
          </p>
        </div>
      </section>

      <div className="sm-footer">
        <button
          className={`sm-save-btn ${wsSaved ? 'saved' : ''}`}
          onClick={onWsSave}
          disabled={wsSaving}
        >
          {wsSaving ? 'Salvando…' : wsSaved ? '✓ Salvo' : 'Salvar configurações do agente'}
        </button>
      </div>

    </div>
  );
}
