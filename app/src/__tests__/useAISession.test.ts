import { beforeEach, describe, expect, it } from 'vitest';

import {
  getScopedSessionKey,
  loadSavedSession,
  markLegacySessionMigrated,
  persistSession,
} from '../hooks/useAISession';
import type { ChatMessage } from '../types';

describe('useAISession persistence helpers', () => {
  const sampleMessages: ChatMessage[] = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'World' },
  ];

  beforeEach(() => {
    localStorage.clear();
  });

  it('builds a scoped key from workspace path and agent id', () => {
    expect(getScopedSessionKey('/tmp/workspace', 'agent-2')).toBe(
      'cafezin:agent-session:/tmp/workspace:agent-2',
    );
  });

  it('falls back to a global workspace bucket when no workspace is open', () => {
    expect(getScopedSessionKey(undefined, 'agent-1')).toBe(
      'cafezin:agent-session:__no-workspace__:agent-1',
    );
  });

  it('persists and restores sessions independently per workspace/tab', () => {
    persistSession(sampleMessages, 'claude-sonnet', 'session-a', '/workspace-a', 'agent-1');
    persistSession([{ role: 'user', content: 'Other' }], 'gpt-4o', 'session-b', '/workspace-b', 'agent-2');

    expect(loadSavedSession('/workspace-a', 'agent-1')).toEqual({
      messages: sampleMessages,
      model: 'claude-sonnet',
      savedAt: expect.any(String),
      sessionId: 'session-a',
    });
    expect(loadSavedSession('/workspace-b', 'agent-2')).toEqual({
      messages: [{ role: 'user', content: 'Other' }],
      model: 'gpt-4o',
      savedAt: expect.any(String),
      sessionId: 'session-b',
    });
    expect(loadSavedSession('/workspace-a', 'agent-2')).toBeNull();
  });

  it('offers the legacy saved session only when explicitly allowed', () => {
    localStorage.setItem('cafezin-last-session', JSON.stringify({
      messages: sampleMessages,
      model: 'legacy-model',
      savedAt: '2026-03-20T00:00:00.000Z',
    }));

    expect(loadSavedSession('/workspace-a', 'agent-1')).toBeNull();
    expect(loadSavedSession('/workspace-a', 'agent-1', true)).toEqual({
      messages: sampleMessages,
      model: 'legacy-model',
      savedAt: '2026-03-20T00:00:00.000Z',
    });
  });

  it('suppresses legacy restore after migration is marked', () => {
    localStorage.setItem('cafezin-last-session', JSON.stringify({
      messages: sampleMessages,
      model: 'legacy-model',
      savedAt: '2026-03-20T00:00:00.000Z',
    }));

    markLegacySessionMigrated();

    expect(loadSavedSession('/workspace-a', 'agent-1', true)).toBeNull();
    expect(localStorage.getItem('cafezin-last-session')).toBeNull();
  });
});
