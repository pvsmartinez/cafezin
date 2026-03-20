import React from 'react';
import type { Workspace, SidebarButton } from '../../types';

export interface WorkspaceTabProps {
  workspace: Workspace;
  wsName: string;
  setWsName: (v: string) => void;
  wsVercelToken: string;
  setWsVercelToken: (v: string) => void;
  wsVercelTeamId: string;
  setWsVercelTeamId: (v: string) => void;
  wsVercelDemoHubProject: string;
  setWsVercelDemoHubProject: (v: string) => void;
  wsVercelDemoHubSourceDir: string;
  setWsVercelDemoHubSourceDir: (v: string) => void;
  wsSidebarButtons: SidebarButton[];
  setWsSidebarButtons: React.Dispatch<React.SetStateAction<SidebarButton[]>>;
  wsInboxFile: string;
  setWsInboxFile: (v: string) => void;
  wsGitBranch: string;
  setWsGitBranch: (v: string) => void;
  newBtnLabel: string;
  setNewBtnLabel: (v: string) => void;
  newBtnCmd: string;
  setNewBtnCmd: (v: string) => void;
  newBtnDesc: string;
  setNewBtnDesc: (v: string) => void;
  wsSaving: boolean;
  wsSaved: boolean;
  onWsSave: () => void;
}

export function WorkspaceTab({
  workspace,
  wsName,
  setWsName,
  wsVercelToken,
  setWsVercelToken,
  wsVercelTeamId,
  setWsVercelTeamId,
  wsVercelDemoHubProject,
  setWsVercelDemoHubProject,
  wsVercelDemoHubSourceDir,
  setWsVercelDemoHubSourceDir,
  wsSidebarButtons,
  setWsSidebarButtons,
  wsInboxFile,
  setWsInboxFile,
  wsGitBranch,
  setWsGitBranch,
  newBtnLabel,
  setNewBtnLabel,
  newBtnCmd,
  setNewBtnCmd,
  newBtnDesc,
  setNewBtnDesc,
  wsSaving,
  wsSaved,
  onWsSave,
}: WorkspaceTabProps) {
  return (
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
          onClick={onWsSave}
          disabled={wsSaving}
        >
          {wsSaving ? 'Salvando…' : wsSaved ? '✓ Salvo' : 'Salvar configurações do workspace'}
        </button>
      </div>

    </div>
  );
}
