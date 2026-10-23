import { describe, it, expect } from 'vitest';
import { resolveFiles, runExportTarget, listAllFiles } from '../utils/exportWorkspace';
import type { ExportTarget } from '../types';

// ── resolveFiles ──────────────────────────────────────────────────────────────

describe('resolveFiles', () => {
  const allFiles = ['notes/ch1.md', 'notes/ch2.md', 'img.png', 'drafts/scratch.md'];

  it('matches include extensions (case-insensitive)', () => {
    const target = { id: 't', name: 't', include: ['md'], format: 'pdf', outputDir: 'dist', enabled: true };
    expect(resolveFiles(allFiles, target)).toEqual(['notes/ch1.md', 'notes/ch2.md', 'drafts/scratch.md']);
  });

  it('includeFiles (pinned) overrides extensions', () => {
    const target = {
      id: 't', name: 't', include: ['md'], includeFiles: ['img.png'],
      format: 'pdf', outputDir: 'dist', enabled: true,
    };
    expect(resolveFiles(allFiles, target)).toEqual(['img.png']);
  });

  it('excludeFiles filters after matching', () => {
    const target = {
      id: 't', name: 't', include: ['md'], excludeFiles: ['notes/ch2.md'],
      format: 'pdf', outputDir: 'dist', enabled: true,
    };
    expect(resolveFiles(allFiles, target)).toEqual(['notes/ch1.md', 'drafts/scratch.md']);
  });

  it('include: [] with no includeFiles matches all files', () => {
    const target = { id: 't', name: 't', include: [], format: 'pdf', outputDir: 'dist', enabled: true };
    expect(resolveFiles(allFiles, target)).toEqual(allFiles);
  });
});

// ── Legacy shell formats are never executed ──────────────────────────────────

describe('runExportTarget — legacy formats', () => {
  it.each(['custom', 'git-publish', 'canvas-png', 'canvas-pdf'] as const)(
    'returns a clear unsupported error for "%s" without executing anything',
    async (format) => {
      const target = {
        id: 'legacy', name: 'Legacy', include: [], format,
        outputDir: 'dist',
        // Malicious/legacy payloads must NOT be run
        custom: { command: 'rm -rf / && echo pwned' },
        gitPublish: { remote: 'origin', branch: 'main' },
        enabled: true,
      } as unknown as ExportTarget;

      const result = await runExportTarget({ workspacePath: '/tmp/whatever', target });

      expect(result.outputs).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain(`"${format}"`);
      expect(result.errors[0]).toContain('no longer supported');
      // Config must not have been rewritten
      expect(target.custom).toEqual({ command: 'rm -rf / && echo pwned' });
      expect(target.gitPublish).toEqual({ remote: 'origin', branch: 'main' });
    },
  );
});

// ── listAllFiles skips hidden/generated dirs ─────────────────────────────────

describe('listAllFiles', () => {
  it('returns [] for a non-existent path', async () => {
    expect(await listAllFiles('/definitely/not/a/real/path/cafezin-test')).toEqual([]);
  });
});
