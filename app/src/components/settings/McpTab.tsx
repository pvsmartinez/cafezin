import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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

// ── Catalog of popular servers for writers and teachers ────────────────────

interface CatalogEntry {
  name: string;
  description: string;
  command: string;
  args: string[];
  envKeys?: { key: string; hint: string }[];
  note?: string;
}

function buildCatalog(t: TFunction): CatalogEntry[] {
  return [
    {
      name: t('settings.mcpCatalogFilesystemName'),
      description: t('settings.mcpCatalogFilesystemDesc'),
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', t('settings.mcpCatalogFilesystemPathArg')],
      note: t('settings.mcpCatalogFilesystemNote'),
    },
    {
      name: t('settings.mcpCatalogWebSearchName'),
      description: t('settings.mcpCatalogWebSearchDesc'),
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      envKeys: [{ key: 'BRAVE_API_KEY', hint: t('settings.mcpCatalogWebSearchHint') }],
    },
    {
      name: 'Notion',
      description: t('settings.mcpCatalogNotionDesc'),
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      envKeys: [{ key: 'NOTION_TOKEN', hint: t('settings.mcpCatalogNotionHint') }],
    },
    {
      name: 'Google Drive',
      description: t('settings.mcpCatalogGdriveDesc'),
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-gdrive'],
      note: t('settings.mcpCatalogGdriveNote'),
    },
    {
      name: t('settings.mcpCatalogMemoryName'),
      description: t('settings.mcpCatalogMemoryDesc'),
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    },
    {
      name: t('settings.mcpCatalogFetchName'),
      description: t('settings.mcpCatalogFetchDesc'),
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-fetch'],
    },
  ];
}

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
  const { t } = useTranslation();
  const CATALOG = buildCatalog(t);
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
      case 'connected': return <span title={t('settings.mcpStatusConnected') ?? ''} style={{ color: '#22c55e' }}>●</span>;
      case 'connecting': return <span title={t('settings.connecting') ?? ''} style={{ color: '#f59e0b' }}>●</span>;
      case 'error': return <span title={t('settings.mcpStatusError') ?? ''} style={{ color: '#ef4444' }}>●</span>;
      default: return <span title={t('settings.mcpStatusStopped') ?? ''} style={{ color: '#71717a' }}>●</span>;
    }
  }

  const isEditing = adding || editId !== null;

  return (
    <div className="sm-section-list">
      <section className="sm-section">
        <h3 className="sm-section-title">{t('settings.mcpServersTitle')}</h3>
        <p className="sm-section-desc">
          {t('settings.mcpServersDesc')}
        </p>

        {servers.length === 0 && !isEditing && (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            {t('settings.mcpNoneConfigured')}
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
                title={(s.enabled ? t('settings.mcpDisable') : t('settings.mcpEnable')) ?? ''}
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
                title={t('settings.mcpTestConnection') ?? ''}
              >
                {testingId === s.id ? '…' : t('settings.mcpTest')}
              </button>
              <button
                className="sm-btn sm-btn--small"
                onClick={() => startEdit(s)}
                title={t('settings.mcpEdit') ?? ''}
              >
                {t('settings.mcpEdit')}
              </button>
              <button
                className="sm-btn sm-btn--small sm-btn--danger"
                onClick={() => removeServer(s.id)}
                title={t('settings.mcpRemove') ?? ''}
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
                  {expanded[s.id] ? t('settings.mcpHideTools') : t('settings.mcpViewTools', { count: getMcpServerTools(s.id).length })}
                </button>
                {expanded[s.id] && (
                  <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {getMcpServerTools(s.id).map((tool) => (
                      <li key={tool.name} title={tool.description}>{tool.name}</li>
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
              {editId ? t('settings.mcpEditServerTitle') : t('settings.mcpNewServerTitle')}
            </h4>

            <div className="sm-row sm-row--col">
              <label className="sm-label">{t('settings.mcpNameLabel')}</label>
              <input
                className="sm-input"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder={t('settings.mcpNamePlaceholder') ?? ''}
              />
            </div>

            <div className="sm-row sm-row--col">
              <label className="sm-label">{t('settings.mcpCommandLabel')}</label>
              <input
                className="sm-input"
                value={form.command}
                onChange={(e) => setForm((p) => ({ ...p, command: e.target.value }))}
                placeholder={t('settings.mcpCommandPlaceholder') ?? ''}
              />
            </div>

            <div className="sm-row sm-row--col">
              <label className="sm-label">
                {t('settings.mcpArgsLabel')}
                <span className="sm-row-desc"> {t('settings.mcpArgsHint')}</span>
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
                {t('settings.mcpEnvLabel')}
                <span className="sm-row-desc"> {t('settings.mcpEnvHint')}</span>
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
              <label className="sm-label">{t('settings.mcpScopeLabel')}</label>
              <select
                className="sm-select"
                value={form.scope}
                onChange={(e) => setForm((p) => ({ ...p, scope: e.target.value as 'global' | 'workspace' }))}
              >
                <option value="global">{t('settings.mcpScopeGlobal')}</option>
                <option value="workspace">{t('settings.mcpScopeWorkspace')}</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button
                className="sm-btn sm-btn--primary"
                onClick={saveForm}
                disabled={!form.name.trim() || !form.command.trim()}
              >
                {t('settings.mcpSave')}
              </button>
              <button className="sm-btn" onClick={cancelForm}>{t('settings.mcpCancel')}</button>
            </div>
          </div>
        )}

        {!isEditing && (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
            <button className="sm-btn" onClick={startAdd}>
              {t('settings.mcpAddServerButton')}
            </button>
            <button className="sm-btn" onClick={() => setShowCatalog((p) => !p)}>
              {showCatalog ? t('settings.mcpHideCatalog') : t('settings.mcpShowCatalog')}
            </button>
          </div>
        )}

        {/* Catalog */}
        {showCatalog && !isEditing && (
          <div style={{ marginTop: '0.75rem' }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              {t('settings.mcpCatalogUseHintPre')} <strong>{t('settings.mcpUse')}</strong> {t('settings.mcpCatalogUseHintPost')}
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
                        {t('settings.mcpRequires')} {entry.envKeys.map((e) => e.key).join(', ')}
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
                    {t('settings.mcpUse')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="sm-section">
        <h3 className="sm-section-title">{t('settings.mcpWhatIsTitle')}</h3>
        <p className="sm-row-desc" style={{ lineHeight: 1.5 }}>
          {t('settings.mcpWhatIsDesc')}{' '}
          <span style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>modelcontextprotocol.io</span>.
        </p>
      </section>
    </div>
  );
}
