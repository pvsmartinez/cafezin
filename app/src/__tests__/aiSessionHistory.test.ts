import { describe, expect, it } from 'vitest';

import { parseHistoricalSessions } from '../services/aiSessionHistory';

describe('parseHistoricalSessions', () => {
  it('groups exchange lines by session and sorts newest first', () => {
    const log = [
      JSON.stringify({
        sessionId: 's_old',
        sessionStartedAt: '2026-03-20T10:00:00.000Z',
        timestamp: '2026-03-20T10:01:00.000Z',
        model: 'gpt-4.1',
        userMessage: 'Primeira sessão',
        aiResponse: 'Resposta 1',
        toolCalls: 1,
      }),
      JSON.stringify({
        sessionId: 's_new',
        sessionStartedAt: '2026-03-20T12:00:00.000Z',
        timestamp: '2026-03-20T12:01:00.000Z',
        model: 'claude-sonnet-4',
        userMessage: 'Sessão mais nova',
        aiResponse: 'Resposta nova',
      }),
      JSON.stringify({
        sessionId: 's_old',
        sessionStartedAt: '2026-03-20T10:00:00.000Z',
        timestamp: '2026-03-20T10:02:00.000Z',
        model: 'gpt-4.1',
        userMessage: 'Segunda pergunta',
        aiResponse: 'Resposta 2',
        toolCalls: 2,
      }),
    ].join('\n');

    const sessions = parseHistoricalSessions(log);

    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({
      sessionId: 's_new',
      model: 'claude-sonnet-4',
      userMessageCount: 1,
      toolCalls: 0,
      preview: 'Sessão mais nova',
    });
    expect(sessions[1]).toMatchObject({
      sessionId: 's_old',
      startedAt: '2026-03-20T10:00:00.000Z',
      savedAt: '2026-03-20T10:02:00.000Z',
      model: 'gpt-4.1',
      userMessageCount: 2,
      toolCalls: 3,
      preview: 'Primeira sessão',
    });
    expect(sessions[1].messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
  });

  it('attaches archive summaries to the grouped session', () => {
    const log = [
      JSON.stringify({
        sessionId: 's_archive',
        sessionStartedAt: '2026-03-20T08:00:00.000Z',
        timestamp: '2026-03-20T08:03:00.000Z',
        model: 'gpt-5-mini',
        userMessage: 'Resumo longo',
        aiResponse: 'Resposta longa',
      }),
      JSON.stringify({
        entryType: 'archive',
        sessionId: 's_archive',
        archivedAt: '2026-03-20T08:04:00.000Z',
        summary: 'Sessão condensada para continuar depois.',
      }),
    ].join('\n');

    const sessions = parseHistoricalSessions(log);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: 's_archive',
      archiveCount: 1,
      archiveSummary: 'Sessão condensada para continuar depois.',
      savedAt: '2026-03-20T08:04:00.000Z',
    });
  });
});