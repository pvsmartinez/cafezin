import { describe, expect, it } from 'vitest';

import {
  buildAgentGuidanceDigest,
  summarizeWorkspaceFiles,
  truncateDocumentContext,
} from '../utils/agentPromptContext';
import type { AgentInstructionSource, FileTreeNode } from '../types';

function makeTree(paths: string[]): FileTreeNode[] {
  return paths.map((path) => ({
    name: path.split('/').pop() ?? path,
    path,
    isDirectory: false,
  }));
}

describe('buildAgentGuidanceDigest', () => {
  it('prioritizes product and workspace guidance over build/deploy sections', () => {
    const sources: AgentInstructionSource[] = [
      {
        path: 'AGENT.md',
        content: [
          '# Build Commands',
          'Run npm run build and deploy to vercel.',
          '',
          '# What This App Does',
          '- Helps writers structure long-form documents',
          '- Focus on small, guided edits',
          '',
          '# Workspace Behaviour',
          '- Read files before answering',
          '- Prefer concise guidance',
        ].join('\n'),
      },
    ];

    const digest = buildAgentGuidanceDigest(sources, 500);
    expect(digest).toContain('What This App Does');
    expect(digest).toContain('Workspace Behaviour');
    expect(digest).not.toContain('Build Commands');
  });

  it('includes named sections from multiple instruction sources', () => {
    const sources: AgentInstructionSource[] = [
      {
        path: 'AGENT.md',
        content: '# Core Philosophy\nWork in small increments.',
      },
      {
        path: '.github/copilot-instructions.md',
        content: '# Critical Rules\nAlways read files first.',
      },
    ];

    const digest = buildAgentGuidanceDigest(sources, 500);
    expect(digest).toContain('Core Philosophy');
    expect(digest).toContain('Critical Rules (.github/copilot-instructions.md)');
  });
});

describe('summarizeWorkspaceFiles', () => {
  it('returns a compact ranked snapshot instead of dumping all files', () => {
    const summary = summarizeWorkspaceFiles(makeTree([
      'README.md',
      'docs/plan.md',
      'docs/chapter-01.md',
      'assets/logo.png',
      'slides/Aula-01.tldr.json',
      'data/grades.csv',
      'src/index.ts',
    ]), {
      activeFile: 'docs/chapter-01.md',
      recentFiles: ['docs/chapter-01.md', 'docs/plan.md'],
      maxFiles: 4,
    });

    expect(summary).toContain('Workspace snapshot: 7 file(s) total');
    expect(summary).toContain('Likely relevant now:');
    expect(summary).toContain('docs/chapter-01.md [active, recent]');
    expect(summary).toContain('docs/plan.md [recent, key]');
    expect(summary).toContain('README.md [key]');
    expect(summary).not.toContain('assets/logo.png');
  });
});

describe('truncateDocumentContext', () => {
  it('truncates markdown on natural boundaries', () => {
    const input = [
      '# Intro',
      'A'.repeat(120),
      '',
      '## Next',
      'B'.repeat(120),
    ].join('\n');

    const out = truncateDocumentContext(input, 'book/chapter-01.md', 160);
    expect(out.endsWith('…')).toBe(true);
    expect(out).toContain('# Intro');
  });

  it('leaves short content untouched', () => {
    expect(truncateDocumentContext('short text', 'notes.md', 100)).toBe('short text');
  });

  it('drops placeholder context when no real file is active', () => {
    expect(truncateDocumentContext('# Untitled Document\n\nStart writing here…', undefined, 100)).toBe('');
  });
});
