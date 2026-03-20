import { beforeEach, describe, expect, it } from 'vitest';

import { loadWorkspaceSession, saveWorkspaceSession } from '../services/workspaceSession';

describe('workspaceSession', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns AI tab defaults when no session exists', () => {
    expect(loadWorkspaceSession('/tmp/ws')).toEqual({
      tabs: [],
      activeTabId: null,
      previewTabId: null,
      expandedDirs: [],
      aiTabs: [],
      activeAiTabId: null,
    });
  });

  it('persists and restores AI panel tabs alongside file tabs', () => {
    saveWorkspaceSession('/tmp/ws', {
      tabs: ['README.md'],
      activeTabId: 'README.md',
      aiTabs: [
        { id: 'agent-1', label: 'Pesquisa', model: 'claude-sonnet', createdAt: '2026-03-20T10:00:00.000Z' },
        { id: 'agent-2', label: 'Resumo' },
      ],
      activeAiTabId: 'agent-2',
    });

    expect(loadWorkspaceSession('/tmp/ws')).toEqual({
      tabs: ['README.md'],
      activeTabId: 'README.md',
      previewTabId: null,
      expandedDirs: [],
      aiTabs: [
        { id: 'agent-1', label: 'Pesquisa', model: 'claude-sonnet', createdAt: '2026-03-20T10:00:00.000Z' },
        { id: 'agent-2', label: 'Resumo' },
      ],
      activeAiTabId: 'agent-2',
    });
  });
});