import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readTextFile } from '../services/fs';
import { useBacklinks } from '../hooks/useBacklinks';
import type { Workspace } from '../types';

vi.mock('../services/fs', () => ({ readTextFile: vi.fn() }));
vi.mock('../services/workspace', () => ({ WORKSPACE_MUTATED_EVENT: 'cafezin:workspace-mutated' }));

const workspace: Workspace = {
  path: '/book', name: 'Book', config: {}, hasGit: false,
  files: ['capitulo.md', 'personagens.md'],
  fileTree: [
    { name: 'capitulo.md', path: 'capitulo.md', isDirectory: false },
    { name: 'personagens.md', path: 'personagens.md', isDirectory: false },
  ],
};

let chapter = 'Leia [[personagens|os personagens]].';
beforeEach(() => {
  chapter = 'Leia [[personagens|os personagens]].';
  vi.mocked(readTextFile).mockImplementation(async (path) =>
    String(path).endsWith('capitulo.md') ? chapter : '# Personagens');
});

describe('useBacklinks', () => {
  it('connects wiki references to the actual workspace files', async () => {
    const { result } = renderHook(() => useBacklinks('personagens.md', workspace));
    await waitFor(() => expect(result.current.backlinks).toEqual([
      { path: 'capitulo.md', label: 'capitulo' },
    ]));
  });

  it('updates links after an existing document is saved without a file-list change', async () => {
    const { result } = renderHook(() => useBacklinks('personagens.md', workspace));
    await waitFor(() => expect(result.current.backlinks).toHaveLength(1));
    chapter = '# Capítulo\n\nAgora sem referência.';
    act(() => window.dispatchEvent(new CustomEvent('cafezin:workspace-mutated', {
      detail: { workspacePath: '/book', reason: 'write' },
    })));
    await waitFor(() => expect(result.current.backlinks).toEqual([]));
  });

  it('does not rebuild the link index for mutations in another workspace', async () => {
    const { result } = renderHook(() => useBacklinks('personagens.md', workspace));
    await waitFor(() => expect(result.current.backlinks).toHaveLength(1));
    const count = vi.mocked(readTextFile).mock.calls.length;
    act(() => window.dispatchEvent(new CustomEvent('cafezin:workspace-mutated', {
      detail: { workspacePath: '/another-book', reason: 'write' },
    })));
    expect(vi.mocked(readTextFile).mock.calls).toHaveLength(count);
  });
});
