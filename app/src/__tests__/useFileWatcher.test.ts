import { describe, expect, it } from 'vitest';
import { isInternalWatchPath } from '../hooks/useFileWatcher';

describe('isInternalWatchPath', () => {
  const workspacePath = '/home/user/my-workspace';

  it('treats .cafezin files as internal', () => {
    expect(isInternalWatchPath(
      '/home/user/my-workspace/.cafezin/ai-marks.json',
      workspacePath,
    )).toBe(true);
  });

  it('treats .git files as internal', () => {
    expect(isInternalWatchPath(
      '/home/user/my-workspace/.git/index.lock',
      workspacePath,
    )).toBe(true);
  });

  it('does not treat a real project folder as internal', () => {
    expect(isInternalWatchPath(
      '/home/user/my-workspace/docs/App.tsx',
      workspacePath,
    )).toBe(false);
  });

  it('still ignores known legacy internal files only', () => {
    expect(isInternalWatchPath(
      '/home/user/my-workspace/copilot-log.jsonl',
      workspacePath,
    )).toBe(true);

    expect(isInternalWatchPath(
      '/home/user/my-workspace/docs/brainstorm.md',
      workspacePath,
    )).toBe(false);
  });
});