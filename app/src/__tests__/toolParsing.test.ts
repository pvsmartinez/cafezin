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

  it('repairs a truncated JSON object when the structure is otherwise recoverable', () => {
    const result = parseToolArguments('{"path":"site/professor/index.html"');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected recovered JSON result');
    expect(result.value).toEqual({ path: 'site/professor/index.html' });
  });

  it('repairs a missing closing brace after a content field', () => {
    const result = parseToolArguments('{"path":"notes.md","content":"linha 1\\nlinha 2"');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected recovered JSON result');
    expect(result.value).toEqual({ path: 'notes.md', content: 'linha 1\nlinha 2' });
  });

  it('still returns an invalid-json error when the payload is too malformed to recover', () => {
    const result = parseToolArguments('{"path": ');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected invalid JSON result');
    expect(result.preview).toContain('{"path":');
  });

  it('rejects non-object JSON payloads', () => {
    const result = parseToolArguments('[]');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected invalid tool args');
    expect(result.error).toContain('JSON object');
  });
});
