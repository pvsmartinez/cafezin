import { useState, useEffect, useCallback } from 'react';
import type { McpServerConfig } from '../../types';
import {
  loadMcpServerConfigs,
  saveMcpServerConfigs,
  initMcpServer,
  stopMcpServer,
  getMcpServerStatus,
  getMcpServerError,
  getMcpServerTools,
  type McpServerStatus,
} from '../../services/mcpClient';

// ── Catálogo de servidores populares para escritores e professores ────────────

interface CatalogEntry {
  name: string;
  description: string;
  command: string;
  args: string[];
  envKeys?: { key: string; hint: string }[];
  note?: string;
}

const CATALOG: CatalogEntry[] = [
  {
    name: 'Arquivos Locais',
    description: 'Lê e escreve arquivos locais. Ideal para vaults do Obsidian, projetos e documentos.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/caminho/para/pasta'],
    note: 'Substitua /caminho/para/pasta pelo diretório que deseja expor.',
  },
  {
    name: 'Busca na Web (Brave)',
    description: 'Pesquisa na web em tempo real via Brave Search. Ótimo para pesquisa acadêmica e criação de conteúdo.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    envKeys: [{ key: 'BRAVE_API_KEY', hint: 'Obtenha em brave.com/search/api' }],
  },
  {
    name: 'Notion',
    description: 'Lê, cria e edita páginas e databases do Notion. Perfeito para notas de aula, wikis e base de conhecimento.',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    envKeys: [{ key: 'NOTION_TOKEN', hint: 'Crie uma integração em notion.so/profile/integrations' }],
  },
  {
    name: 'Google Drive',
    description: 'Acessa e pesquisa arquivos no Google Drive, incluindo Docs, Sheets e Slides.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gdrive'],
    note: 'Requer OAuth do Google. Rode uma vez no terminal para autenticar.',
  },
  {
    name: 'Memória / Grafo de Conhecimento',
    description: 'Memória persistente entre conversas. Salva entidades, relações e fatos que o agente pode consultar sempre.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
  },
  {
    name: 'Fetch / Leitura de URLs',
    description: 'Faz requisições HTTP e lê o conteúdo de páginas web. Útil para pesquisar artigos, documentação e referências.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
  },
];

const EMPTY_FORM: Omit<McpServerConfig, 'id'> = {
  name: '',
  command: '',
  args: [],
  env: {},
  enabled: true,
  scope: 'global',
};

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function McpTab() {
  const [servers, setServers] = useState<McpServerConfig[]>(() => loadMcpServerConfigs());
  const [statuses, setStatuses] = useState<Record<string, McpServerStatus>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<McpServerConfig, 'id'>>(EMPTY_FORM);
  // For args + env raw text editing
  const [argsText, setArgsText] = useState('');
  const [envText, setEnvText] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);

  function prefillFromCatalog(entry: CatalogEntry) {
    setEditId(null);
    const initialEnv = entry.envKeys
      ? Object.fromEntries(entry.envKeys.map((e) => [e.key, '']))
      : {};
    setForm({
      name: entry.name,
      command: entry.command,
      args: entry.args,
      env: Object.keys(initialEnv).length > 0 ? initialEnv : undefined,
      enabled: true,
      scope: 'global',
    });
    setArgsText(entry.args.join('\n'));
    setEnvText(entry.envKeys ? entry.envKeys.map((e) => `${e.key}=`).join('\n') : '');
    setAdding(true);
    setShowCatalog(false);
  }

  const refreshStatuses = useCallback(() => {
    setStatuses((prev) => {
      const next = { ...prev };
      servers.forEach((s) => { next[s.id] = getMcpServerStatus(s.id); });
      return next;
    });
  }, [servers]);

  useEffect(() => {
    refreshStatuses();
  }, [refreshStatuses]);

  function persist(updated: McpServerConfig[]) {
    setServers(updated);
    saveMcpServerConfigs(updated);
  }

  function startAdd() {
    setEditId(null);
    setForm({ ...EMPTY_FORM });
    setArgsText('');
    setEnvText('');
    setAdding(true);
  }

  function startEdit(s: McpServerConfig) {
    setAdding(false);
    setEditId(s.id);
    const { id: _id, ...rest } = s;
    setForm(rest);
    setArgsText(s.args.join('\n'));
    setEnvText(Object.entries(s.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'));
  }

  function cancelForm() {
    setAdding(false);
    setEditId(null);
  }

  function parseArgs(text: string): string[] {
    return text.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  function parseEnv(text: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        env[line.slice(0, eq).trim()] = line.slice(eq + 1);
      }
    }
    return env;
  }

  function saveForm() {
    const finalArgs = parseArgs(argsText);
    const finalEnv = parseEnv(envText);
    const cfg: McpServerConfig = {
      ...form,
      args: finalArgs,
      env: Object.keys(finalEnv).length > 0 ? finalEnv : undefined,
      id: editId ?? generateId(),
    };
    if (editId) {
      persist(servers.map((s) => (s.id === editId ? cfg : s)));
    } else {
      persist([...servers, cfg]);
    }
    cancelForm();
  }

  async function testServer(cfg: McpServerConfig) {
    setTestingId(cfg.id);
    setStatuses((prev) => ({ ...prev, [cfg.id]: 'connecting' }));
    try {
      await initMcpServer(cfg);
    } catch {
      // error is stored per-server; we'll read it in refreshStatuses
    }
    refreshStatuses();
    setTestingId(null);
  }

  function toggleEnabled(id: string) {
    const updated = servers.map((s) =>
      s.id === id ? { ...s, enabled: !s.enabled } : s,
    );
    persist(updated);
    if (!updated.find((s) => s.id === id)?.enabled) {
      void stopMcpServer(id).catch(() => {});
      refreshStatuses();
    }
  }

  function removeServer(id: string) {
    void stopMcpServer(id).catch(() => {});
    persist(servers.filter((s) => s.id !== id));
    setStatuses((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }

  function statusDot(status: McpServerStatus | undefined) {
    switch (status) {
      case 'connected': return <span title="Conectado" style={{ color: '#22c55e' }}>●</span>;
      case 'connecting': return <span title="Conectando…" style={{ color: '#f59e0b' }}>●</span>;
      case 'error': return <span title="Erro" style={{ color: '#ef4444' }}>●</span>;
      default: return <span title="Parado" style={{ color: '#71717a' }}>●</span>;
    }
  }

  const isEditing = adding || editId !== null;

  return (
    <div className="sm-section-list">
      <section className="sm-section">
        <h3 className="sm-section-title">Servidores MCP</h3>
        <p className="sm-section-desc">
          Model Context Protocol — conecte ferramentas externas ao agente.
          Cada servidor MCP expõe um conjunto de ferramentas que o agente pode invocar.
        </p>

        {servers.length === 0 && !isEditing && (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            Nenhum servidor configurado.
          </p>
        )}

        {/* Server list */}
        {servers.map((s) => (
          <div key={s.id} className="sm-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.25rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={s.enabled}
                onChange={() => toggleEnabled(s.id)}
                title={s.enabled ? 'Desativar' : 'Ativar'}
              />
              {statusDot(statuses[s.id])}
              <span style={{ flex: 1, fontWeight: 500, fontSize: '0.9rem' }}>{s.name}</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                {[s.command, ...s.args].join(' ').slice(0, 40)}{([s.command, ...s.args].join(' ')).length > 40 ? '…' : ''}
              </span>
              <button
                className="sm-btn sm-btn--small"
                onClick={() => void testServer(s)}
                disabled={testingId === s.id}
                title="Testar conexão"
              >
                {testingId === s.id ? '…' : 'Testar'}
              </button>
              <button
                className="sm-btn sm-btn--small"
                onClick={() => startEdit(s)}
                title="Editar"
              >
                Editar
              </button>
              <button
                className="sm-btn sm-btn--small sm-btn--danger"
                onClick={() => removeServer(s.id)}
                title="Remover"
              >
                ✕
              </button>
            </div>

            {statuses[s.id] === 'error' && (
              <div style={{ fontSize: '0.8rem', color: 'var(--error, #ef4444)', paddingLeft: '1.6rem' }}>
                {getMcpServerError(s.id)}
              </div>
            )}

            {/* Expandable tool list */}
            {statuses[s.id] === 'connected' && (
              <div style={{ paddingLeft: '1.6rem' }}>
                <button
                  className="sm-btn sm-btn--link"
                  onClick={() => setExpanded((p) => ({ ...p, [s.id]: !p[s.id] }))}
                >
                  {expanded[s.id] ? 'Ocultar ferramentas' : `Ver ferramentas (${getMcpServerTools(s.id).length})`}
                </button>
                {expanded[s.id] && (
                  <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {getMcpServerTools(s.id).map((t) => (
                      <li key={t.name} title={t.description}>{t.name}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Add / Edit form */}
        {isEditing && (
          <div className="sm-section" style={{ background: 'var(--bg-subtle, var(--bg-secondary))', borderRadius: '6px', padding: '0.75rem', marginTop: '0.5rem' }}>
            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>
              {editId ? 'Editar servidor' : 'Novo servidor MCP'}
            </h4>

            <div className="sm-row sm-row--col">
              <label className="sm-label">Nome</label>
              <input
                className="sm-input"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Ex: Filesystem"
              />
            </div>

            <div className="sm-row sm-row--col">
              <label className="sm-label">Comando</label>
              <input
                className="sm-input"
                value={form.command}
                onChange={(e) => setForm((p) => ({ ...p, command: e.target.value }))}
                placeholder="Ex: npx ou /usr/local/bin/mcp-server"
              />
            </div>

            <div className="sm-row sm-row--col">
              <label className="sm-label">
                Argumentos
                <span className="sm-row-desc"> — um por linha</span>
              </label>
              <textarea
                className="sm-input"
                rows={3}
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                placeholder={`-y\n@modelcontextprotocol/server-filesystem\n/Users/me/docs`}
                style={{ fontFamily: 'monospace', fontSize: '0.82rem', resize: 'vertical' }}
              />
            </div>

            <div className="sm-row sm-row--col">
              <label className="sm-label">
                Variáveis de ambiente
                <span className="sm-row-desc"> — formato KEY=VALUE, um por linha</span>
              </label>
              <textarea
                className="sm-input"
                rows={2}
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                placeholder={`API_KEY=valor\nOUTRA_VAR=outro`}
                style={{ fontFamily: 'monospace', fontSize: '0.82rem', resize: 'vertical' }}
              />
            </div>

            <div className="sm-row">
              <label className="sm-label">Escopo</label>
              <select
                className="sm-select"
                value={form.scope}
                onChange={(e) => setForm((p) => ({ ...p, scope: e.target.value as 'global' | 'workspace' }))}
              >
                <option value="global">Global (todos os workspaces)</option>
                <option value="workspace">Workspace atual</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button
                className="sm-btn sm-btn--primary"
                onClick={saveForm}
                disabled={!form.name.trim() || !form.command.trim()}
              >
                Salvar
              </button>
              <button className="sm-btn" onClick={cancelForm}>Cancelar</button>
            </div>
          </div>
        )}

        {!isEditing && (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
            <button className="sm-btn" onClick={startAdd}>
              + Adicionar servidor MCP
            </button>
            <button className="sm-btn" onClick={() => setShowCatalog((p) => !p)}>
              {showCatalog ? 'Ocultar catálogo' : '✦ Catálogo de servidores'}
            </button>
          </div>
        )}

        {/* Catálogo */}
        {showCatalog && !isEditing && (
          <div style={{ marginTop: '0.75rem' }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              Clique em <strong>Usar</strong> para pré-preencher o formulário com as configurações do servidor.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {CATALOG.map((entry) => (
                <div
                  key={entry.name}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.75rem',
                    padding: '0.5rem 0.6rem',
                    borderRadius: '5px',
                    background: 'var(--bg-subtle, var(--bg-secondary))',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{entry.name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem', lineHeight: 1.4 }}>
                      {entry.description}
                    </div>
                    {entry.envKeys && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        🔑 Requer: {entry.envKeys.map((e) => e.key).join(', ')}
                      </div>
                    )}
                    {entry.note && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem', fontStyle: 'italic' }}>
                        ℹ {entry.note}
                      </div>
                    )}
                  </div>
                  <button
                    className="sm-btn sm-btn--small"
                    onClick={() => prefillFromCatalog(entry)}
                    style={{ flexShrink: 0, alignSelf: 'center' }}
                  >
                    Usar
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="sm-section">
        <h3 className="sm-section-title">O que é MCP?</h3>
        <p className="sm-row-desc" style={{ lineHeight: 1.5 }}>
          Model Context Protocol é um padrão aberto que permite ao agente do Cafezin
          usar ferramentas fornecidas por servidores externos — acesso a arquivos,
          pesquisa na web, bancos de dados, APIs e muito mais.{' '}
          Servidores MCP são encontrados em{' '}
          <span style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>modelcontextprotocol.io</span>.
        </p>
      </section>
    </div>
  );
}
