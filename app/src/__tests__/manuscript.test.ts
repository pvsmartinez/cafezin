import { describe, it, expect } from 'vitest';
import type { FileTreeNode } from '../types';
import { buildManuscriptLayout, countWords, extractTitle, isLikelyChapter, nextFreePath } from '../utils/manuscript';

const file = (path: string): FileTreeNode => ({ name: path.split('/').pop()!, path, isDirectory: false });
const dir = (path: string, children: FileTreeNode[]): FileTreeNode => ({ name: path, path, isDirectory: true, children });

const tree: FileTreeNode[] = [
  file('AGENT.md'),
  file('capitulo-10.md'),
  file('capitulo-2.md'),
  file('personagens.md'),
  file('jornal.pdf'),
  file('legado.pptx'),
  dir('exports', [file('exports/livro.pdf')]),
  dir('capitulos', [file('capitulos/abertura.md')]),
];

describe('buildManuscriptLayout', () => {
  it('infers chapters by name or folder, in natural order', () => {
    const layout = buildManuscriptLayout(tree, {});
    expect(layout.chapters).toEqual(['capitulo-2.md', 'capitulo-10.md', 'capitulos/abertura.md']);
    expect(layout.notebook).toEqual(['personagens.md', 'AGENT.md']);
    expect(layout.research).toEqual(['jornal.pdf']);
    expect(layout.other).toEqual(['legado.pptx']);
  });

  it('uses the saved order and drops chapters that no longer exist', () => {
    const layout = buildManuscriptLayout(tree, { manuscript: { chapters: ['personagens.md', 'gone.md', 'capitulo-2.md'] } });
    expect(layout.chapters).toEqual(['personagens.md', 'capitulo-2.md']);
    expect(layout.notebook).toContain('capitulo-10.md');
  });
});

describe('manuscript helpers', () => {
  it('detects chapter names', () => {
    expect(isLikelyChapter('01-inicio.md')).toBe(true);
    expect(isLikelyChapter('Capítulo 3.md')).toBe(true);
    expect(isLikelyChapter('notas.md')).toBe(false);
  });

  it('extracts the first H1 as title', () => {
    expect(extractTitle('intro\n# A biblioteca fechada\n## x')).toBe('A biblioteca fechada');
    expect(extractTitle('sem título')).toBeNull();
  });

  it('counts words ignoring markup and link targets', () => {
    expect(countWords('# Título\n\nLeia [[personagens|as notas]] de **Clara**.')).toBe(6);
  });

  it('finds the next free path', () => {
    expect(nextFreePath('capitulo', 'md', new Set(['capitulo-01.md']), 2)).toBe('capitulo-02.md');
    expect(nextFreePath('Sem título', 'md', new Set(['Sem título.md']))).toBe('Sem título 2.md');
  });
});
