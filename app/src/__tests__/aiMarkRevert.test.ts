import { describe, expect, it } from 'vitest';
import { applyTextMarkRevert } from '../utils/aiMarkRevert';

describe('applyTextMarkRevert', () => {
  it('reverts a unique marked snippet directly', () => {
    const result = applyTextMarkRevert(
      'A\nAI paragraph\nB',
      {
        beforeText: 'Original paragraph',
        afterText: 'AI paragraph',
      },
    );

    expect(result).toBe('A\nOriginal paragraph\nB');
  });

  it('uses surrounding context when the changed text is repeated', () => {
    const result = applyTextMarkRevert(
      'Intro\nAI bit\nMiddle\nAI bit\nOutro',
      {
        beforeText: 'Human bit',
        afterText: 'AI bit',
        contextBefore: 'Middle\n',
        contextAfter: '\nOutro',
      },
    );

    expect(result).toBe('Intro\nAI bit\nMiddle\nHuman bit\nOutro');
  });

  it('returns null when the current document no longer matches safely', () => {
    const result = applyTextMarkRevert(
      'Intro\nAI bit changed by user\nOutro',
      {
        beforeText: 'Human bit',
        afterText: 'AI bit',
        contextBefore: 'Intro\n',
        contextAfter: '\nOutro',
      },
    );

    expect(result).toBeNull();
  });
});