import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Workspace } from '../types';

const writeFile = vi.fn<(ws: Workspace, file: string, text: string) => Promise<void>>();
vi.mock('../services/workspace', () => ({
  writeFile: (ws: Workspace, file: string, text: string) => writeFile(ws, file, text),
  trackFileEdit: vi.fn(() => Promise.resolve({})),
}));

import { useAutosave } from '../hooks/useAutosave';

const ws = { path: '/book' } as Workspace;

function setup(saved: string) {
  const savedContentRef = { current: new Map([['a.md', saved]]) };
  const setDirtyFiles = vi.fn();
  const { result } = renderHook(() => useAutosave({
    savedContentRef,
    setDirtyFiles,
    setSaveError: vi.fn(),
    setWorkspace: vi.fn(),
    initialDelay: 1000,
  }));
  return { result, savedContentRef };
}

describe('useAutosave', () => {
  beforeEach(() => { vi.useFakeTimers(); writeFile.mockReset().mockResolvedValue(); });
  afterEach(() => { vi.useRealTimers(); });

  it('writes an edit to disk after the delay', async () => {
    const { result, savedContentRef } = setup('old');
    act(() => { result.current.scheduleAutosave(ws, 'a.md', 'new'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(writeFile).toHaveBeenCalledWith(ws, 'a.md', 'new');
    expect(savedContentRef.current.get('a.md')).toBe('new');
  });

  it('skips the write when another writer saved a newer version meanwhile', async () => {
    const { result, savedContentRef } = setup('old');
    act(() => { result.current.scheduleAutosave(ws, 'a.md', 'stale edit'); });
    savedContentRef.current.set('a.md', 'agent version');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(writeFile).not.toHaveBeenCalled();
  });
});
