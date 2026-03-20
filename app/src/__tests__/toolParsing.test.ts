import { describe, expect, it } from 'vitest';

import { parseToolArguments } from '../services/copilot/toolParsing';

describe('parseToolArguments', () => {
  it('treats empty arguments as an empty object', () => {
    expect(parseToolArguments('')).toEqual({
      ok: true,
      value: {},
    });
  });

  it('returns parsed object arguments when JSON is valid', () => {
    expect(parseToolArguments('{"path":"site/professor/index.html"}')).toEqual({
      ok: true,
      value: { path: 'site/professor/index.html' },
    });
  });

  it('returns an invalid-json error instead of silently falling back to empty args', () => {
    const result = parseToolArguments('{"path":"site/professor/index.html"');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected invalid JSON result');
    expect(result.preview).toContain('site/professor/index.html');
  });

  it('rejects non-object JSON payloads', () => {
    const result = parseToolArguments('[]');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected invalid tool args');
    expect(result.error).toContain('JSON object');
  });
});