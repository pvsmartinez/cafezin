import { describe, expect, it } from 'vitest';
import { extractFileOutline, rankWorkspaceIndex } from '../services/workspaceIndex';
import type { WorkspaceIndex } from '../types';

// ── extractFileOutline ─────────────────────────────────────────────────────────

describe('extractFileOutline', () => {
  it('returns headings and word count for markdown', () => {
    const text = [
      '---',
      'title: "My Book"',
      '---',
      '# Introduction',
      '',
      'Hello world. This is the intro.',
      '',
      '## Background',
      '',
      'Some context here.',
    ].join('\n');

    const outline = extractFileOutline('chapter1.md', text);
    expect(outline).toContain('title: "My Book"');
    expect(outline).toContain('# Introduction');
    expect(outline).toContain('## Background');
    expect(outline).toMatch(/\d+ words/);
  });

  it('marks markdown files that contain Mermaid blocks', () => {
    const text = [
      '# Diagram',
      '',
      '```mermaid',
      'flowchart TD',
      'A --> B',
      '```',
    ].join('\n');

    const outline = extractFileOutline('diagram.md', text);
    expect(outline).toContain('[mermaid]');
  });

  it('returns named exports for TypeScript files', () => {
    const text = [
      'export function greet(name: string) { return `Hello ${name}`; }',
      'export const MAX = 100;',
      'export interface User { id: string; name: string; }',
      'export type Role = "admin" | "user";',
    ].join('\n');

    const outline = extractFileOutline('utils/helpers.ts', text);
    expect(outline).toContain('exports:');
    expect(outline).toContain('greet');
    expect(outline).toContain('MAX');
    expect(outline).toContain('User');
    expect(outline).toContain('Role');
  });

  it('returns top-level keys for JSON files', () => {
    const text = JSON.stringify({ name: 'cafezin', version: '1.0.0', scripts: {}, dependencies: {} });
    const outline = extractFileOutline('package.json', text);
    expect(outline).toContain('keys:');
    expect(outline).toContain('name');
    expect(outline).toContain('version');
  });

  it('returns an empty string for unsupported file types', () => {
    const outline = extractFileOutline('image.png', 'binary data');
    expect(outline).toBe('');
  });

  it('extracts SQL CREATE statements', () => {
    const text = [
      'CREATE TABLE users (id uuid primary key);',
      'CREATE FUNCTION get_user(uid uuid) RETURNS users AS $$ $$ LANGUAGE sql;',
    ].join('\n');

    const outline = extractFileOutline('schema.sql', text);
    expect(outline).toContain('creates: users, get_user');
  });
});

// ── rankWorkspaceIndex ────────────────────────────────────────────────────────

describe('rankWorkspaceIndex', () => {
  function makeIndex(entries: Array<{ path: string; outline?: string }>): WorkspaceIndex {
    return {
      version: 2,
      builtAt: new Date().toISOString(),
      entries: entries.map((e) => ({
        path: e.path,
        size: 1024,
        mtime: Date.now(),
        outline: e.outline ?? '',
      })),
    };
  }

  it('ranks active file first regardless of query', () => {
    const index = makeIndex([
      { path: 'notes.md' },
      { path: 'active.md' },
      { path: 'other.md' },
    ]);

    const result = rankWorkspaceIndex(index, '', { activeFile: 'active.md' });
    expect(result[0].path).toBe('active.md');
  });

  it('ranks recent files above unreferenced files', () => {
    const index = makeIndex([
      { path: 'old.md' },
      { path: 'recent.md' },
      { path: 'very-recent.md' },
    ]);

    const result = rankWorkspaceIndex(index, '', {
      recentFiles: ['very-recent.md', 'recent.md'],
    });

    expect(result[0].path).toBe('very-recent.md');
    expect(result[1].path).toBe('recent.md');
    // old.md has no recency boost
    expect(result[2].path).toBe('old.md');
  });

  it('boosts files whose path matches query tokens', () => {
    const index = makeIndex([
      { path: 'chapters/introduction.md', outline: '  # Welcome' },
      { path: 'assets/logo.png', outline: '' },
      { path: 'notes/research.md', outline: '' },
    ]);

    const result = rankWorkspaceIndex(index, 'introduction', {});
    expect(result[0].path).toBe('chapters/introduction.md');
  });

  it('boosts files whose outline matches query tokens', () => {
    const index = makeIndex([
      { path: 'chapter-01.md', outline: '  # Authentication\n  ## OAuth flow' },
      { path: 'chapter-02.md', outline: '  # Introduction\n  ## Hello' },
    ]);

    const result = rankWorkspaceIndex(index, 'authentication', {});
    expect(result[0].path).toBe('chapter-01.md');
  });

  it('respects maxResults cap', () => {
    const index = makeIndex(
      Array.from({ length: 20 }, (_, i) => ({ path: `file${i}.md` })),
    );

    const result = rankWorkspaceIndex(index, '', { maxResults: 5 });
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('returns nothing when query has no matches', () => {
    const index = makeIndex([
      { path: 'unrelated.md', outline: '  # Random content' },
    ]);

    const result = rankWorkspaceIndex(index, 'xyzzy');
    expect(result).toHaveLength(0);
  });
});
