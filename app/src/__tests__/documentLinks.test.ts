import { describe, it, expect } from 'vitest';
import {
  parseDocumentLinks,
  resolveDocumentLink,
  labelFromPath,
  normalizePath,
  flattenFileTree,
  preprocessWikiLinksToHtml,
  escapeHtml,
  restoreProseWikiLinks,
} from '../utils/documentLinks';
import type { FileTreeNode } from '../types';

describe('documentLinks — parseDocumentLinks', () => {
  it('parses wiki links without label', () => {
    const links = parseDocumentLinks('See [[notes]] for details.');
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({ rawTarget: 'notes', label: 'notes', isWiki: true });
  });

  it('parses wiki links with custom label', () => {
    const links = parseDocumentLinks('See [[folder/file|My Note]] here.');
    expect(links[0]).toEqual({ rawTarget: 'folder/file', label: 'My Note', isWiki: true });
  });

  it('parses markdown relative links', () => {
    const links = parseDocumentLinks('Read [my note](./other.md) or [deep](../a/b.md).');
    expect(links).toHaveLength(2);
    expect(links[0].rawTarget).toBe('./other.md');
    expect(links[0].label).toBe('my note');
    expect(links[1].rawTarget).toBe('../a/b.md');
  });

  it('skips external and anchor links', () => {
    const links = parseDocumentLinks('[x](https://a.com) [y](http://b.com) [z](#anchor) [w](mailto:x@y.com)');
    expect(links).toHaveLength(0);
  });

  it('ignores wiki links inside fenced code blocks', () => {
    const links = parseDocumentLinks('```\n[[not-a-link]]\n```\n[[real]]');
    expect(links).toHaveLength(1);
    expect(links[0].rawTarget).toBe('real');
  });

  it('ignores wiki links inside inline code', () => {
    const links = parseDocumentLinks('Use `[[code]]` syntax, then [[real]] works.');
    expect(links).toHaveLength(1);
    expect(links[0].rawTarget).toBe('real');
  });

  it('keeps links after an unmatched inline backtick', () => {
    expect(parseDocumentLinks('A lone ` precedes [[real]].')).toEqual([
      { rawTarget: 'real', label: 'real', isWiki: true },
    ]);
    expect(preprocessWikiLinksToHtml('A lone ` precedes [[real]].')).toContain('class="wiki-link"');
  });

  it('handles empty content', () => {
    expect(parseDocumentLinks('')).toHaveLength(0);
  });
});

describe('documentLinks — resolveDocumentLink', () => {
  it('resolves relative to the document dir when no tree is given', () => {
    expect(resolveDocumentLink('./other.md', 'docs')).toBe('docs/other.md');
    expect(resolveDocumentLink('other.md', 'docs')).toBe('docs/other.md');
    expect(resolveDocumentLink('../other.md', 'docs/sub')).toBe('docs/other.md');
  });

  it('falls back to root when tree is provided', () => {
    const tree = ['folder/notes.md', 'root.md'];
    // From docs/, "./folder/notes.md" doesn't exist, but root "folder/notes.md" does.
    expect(resolveDocumentLink('folder/notes.md', 'docs', tree)).toBe('folder/notes.md');
    expect(resolveDocumentLink('root.md', 'docs', tree)).toBe('root.md');
  });

  it('appends .md extension for wiki links', () => {
    const tree = ['docs/notes.md'];
    expect(resolveDocumentLink('notes', 'docs', tree)).toBe('docs/notes.md');
    expect(resolveDocumentLink('notes.md', 'docs', tree)).toBe('docs/notes.md');
  });

  it.each(['file:///etc/passwd', '//evil.com/x', '/etc/passwd', 'C:\\book.md',
    'vbscript:evil', '%2e%2e/%2e%2e/etc/passwd', '../../book.md', '%252e%252e/book.md'])(
    'rejects unsafe target %s', (target) => {
      expect(resolveDocumentLink(target, 'docs')).toBeNull();
    },
  );

  it('keeps the actual filename case and prefers a local .md over a root fallback', () => {
    expect(resolveDocumentLink('notes', 'docs', ['notes.md', 'docs/Notes.md']))
      .toBe('docs/Notes.md');
    expect(resolveDocumentLink('notes', 'docs', [])).toBeNull();
    expect(resolveDocumentLink('notes', 'docs')).toBe('docs/notes.md');
  });

  it('returns null for non-existent targets when tree is known', () => {
    expect(resolveDocumentLink('missing', 'docs', ['docs/other.md'])).toBeNull();
  });

  it('returns null for unsafe/external targets', () => {
    expect(resolveDocumentLink('https://evil.com', 'docs')).toBeNull();
    expect(resolveDocumentLink('javascript:alert(1)', 'docs')).toBeNull();
    expect(resolveDocumentLink('', 'docs')).toBeNull();
  });

  it('handles path traversal that escapes the root', () => {
    // Traversal outside the root must fail, even when a same-name file exists.
    const tree = ['docs/a.md'];
    expect(resolveDocumentLink('../../etc/passwd.md', 'docs', tree)).toBeNull();
  });
});

describe('documentLinks — helpers', () => {
  it('normalizes paths', () => {
    expect(normalizePath('./a/b.md')).toBe('a/b.md');
    expect(normalizePath('/root/a.md')).toBe('root/a.md');
    expect(normalizePath('a\\b.md')).toBe('a/b.md');
  });

  it('extracts label from path', () => {
    expect(labelFromPath('docs/notes.md')).toBe('notes');
    expect(labelFromPath('notes')).toBe('notes');
    expect(labelFromPath('a/b/c.txt')).toBe('c');
  });

  it('escapes HTML in text and attributes', () => {
    expect(escapeHtml('<img src=x>')).toBe('&lt;img src=x&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
    expect(escapeHtml('&')).toBe('&amp;');
  });

  it('flattens file tree', () => {
    const tree: FileTreeNode[] = [
      { name: 'a.md', path: 'a.md', isDirectory: false },
      {
        name: 'sub',
        path: 'sub',
        isDirectory: true,
        children: [{ name: 'b.md', path: 'sub/b.md', isDirectory: false }],
      },
    ];
    expect(flattenFileTree(tree)).toEqual(['a.md', 'sub/b.md']);
  });
});

describe('documentLinks — Prose persistence', () => {
  it('retains wiki syntax after a Prose edit or AI revert', () => {
    expect(restoreProseWikiLinks('Leia \\[\\[pessoas|as pessoas\\]\\].', 'Leia [[pessoas|as pessoas]].'))
      .toBe('Leia [[pessoas|as pessoas]].');
  });

  it('also supports newly typed wiki references', () => {
    expect(restoreProseWikiLinks('\\[\\[nova nota\\]\\]', '# Antes'))
      .toBe('[[nova nota]]');
  });

  it('preserves an explicitly escaped reference as literal text', () => {
    const serialized = '\\[\\[literal\\]\\]';
    expect(restoreProseWikiLinks(serialized, '\\[[literal]]')).toBe(serialized);
  });

  it('preserves real and escaped references to the same target in either order', () => {
    const escaped = '\\[\\[same\\]\\]';
    expect(restoreProseWikiLinks(`${escaped} and ${escaped}`, '\\[[same]] and [[same]]'))
      .toBe(`${escaped} and [[same]]`);
    expect(restoreProseWikiLinks(`${escaped} and ${escaped}`, '[[same]] and \\[[same]]'))
      .toBe(`[[same]] and ${escaped}`);
  });

  it('does not change bracket escapes within code blocks', () => {
    const code = '```md\n\\[\\[literal\\]\\]\n```';
    expect(restoreProseWikiLinks(code, '')).toBe(code);
  });
});

describe('documentLinks — preprocessWikiLinksToHtml', () => {
  it('converts wiki links to safe anchors', () => {
    const html = preprocessWikiLinksToHtml('See [[notes]] here.');
    expect(html).toContain('<a class="wiki-link" href="notes">notes</a>');
  });

  it('uses the custom label', () => {
    const html = preprocessWikiLinksToHtml('See [[folder/file|My Note]] here.');
    expect(html).toContain('href="folder/file"');
    expect(html).toContain('>My Note</a>');
  });

  it('escapes HTML in the target and label', () => {
    const html = preprocessWikiLinksToHtml('[[<script>alert(1)</script>]]');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('leaves code blocks untouched', () => {
    const html = preprocessWikiLinksToHtml('```\n[[raw]]\n```\n[[cooked]]');
    expect(html).toContain('[[raw]]');
    expect(html).toContain('<a class="wiki-link" href="cooked">cooked</a>');
  });

  it('leaves inline code untouched', () => {
    const html = preprocessWikiLinksToHtml('`[[inline]]` and [[cooked]]');
    expect(html).toContain('`[[inline]]`');
    expect(html).toContain('<a class="wiki-link" href="cooked">cooked</a>');
  });

  it('preserves escapes, multi-backtick spans, unclosed fences and indented code', () => {
    for (const content of ['\\[[escaped]]', '`` [[raw]] ` ``', '```md\n[[raw]]',
      '    [[indented]]']) {
      expect(preprocessWikiLinksToHtml(content)).toBe(content);
      expect(parseDocumentLinks(content)).toEqual([]);
    }
  });

  it('does not inject wiki anchors into raw HTML attributes or existing links', () => {
    const content = '<a href="[[not-an-attribute-link]]">[[also-not-nested]]</a>';
    expect(preprocessWikiLinksToHtml(content)).toBe(content);
  });

  it('ignores Markdown image references when scanning document backlinks', () => {
    expect(parseDocumentLinks('![Imagem](photo.png) [[nota]]')).toEqual([
      { rawTarget: 'nota', label: 'nota', isWiki: true },
    ]);
  });

  it('keeps normal markdown links untouched', () => {
    const html = preprocessWikiLinksToHtml('[text](file.md)');
    expect(html).toBe('[text](file.md)');
  });
});
