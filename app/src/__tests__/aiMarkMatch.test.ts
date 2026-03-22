import { describe, expect, it } from 'vitest';
import { findAIMarkOccurrences, findAIMarkRange, hasAIMarkMatch } from '../utils/aiMarkMatch';

describe('aiMarkMatch', () => {
  it('finds the exact edited range using revert context', () => {
    const text = 'Intro\nNovo trecho\nMeio\nNovo trecho\nFim';

    const range = findAIMarkRange(text, {
      text: 'Novo trecho',
      revert: {
        beforeText: 'Trecho antigo',
        afterText: 'Novo trecho',
        contextBefore: 'Meio\n',
        contextAfter: '\nFim',
      },
    });

    expect(range).toEqual({
      from: text.indexOf('Novo trecho', text.indexOf('Meio')),
      to: text.indexOf('Novo trecho', text.indexOf('Meio')) + 'Novo trecho'.length,
    });
  });

  it('falls back to all visible-text occurrences when no revert context exists', () => {
    const text = 'Alpha\nTrecho IA\nBeta\nTrecho IA';

    const ranges = findAIMarkOccurrences(text, {
      text: 'Trecho IA',
    });

    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual({
      from: text.indexOf('Trecho IA'),
      to: text.indexOf('Trecho IA') + 'Trecho IA'.length,
    });
  });

  it('treats afterText as the authoritative current match for cleanup', () => {
    expect(
      hasAIMarkMatch('Antes\n  Novo paragrafo\nDepois', {
        text: 'Novo paragrafo',
        revert: {
          beforeText: 'Velho paragrafo',
          afterText: '  Novo paragrafo',
        },
      }),
    ).toBe(true);
  });
});
