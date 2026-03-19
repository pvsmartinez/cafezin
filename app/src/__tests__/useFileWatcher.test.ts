import { describe, expect, it } from 'vitest';
import { isInternalWatchPath } from '../hooks/useFileWatcher';

describe('isInternalWatchPath', () => {
  const workspacePath = '/Users/pedromartinez/Dev/pmatz';

  it('treats .cafezin files as internal', () => {
    expect(isInternalWatchPath(
      '/Users/pedromartinez/Dev/pmatz/.cafezin/ai-marks.json',
      workspacePath,
    )).toBe(true);
  });

  it('treats .git files as internal', () => {
    expect(isInternalWatchPath(
      '/Users/pedromartinez/Dev/pmatz/.git/index.lock',
      workspacePath,
    )).toBe(true);
  });

  it('does not treat a real cafezin project folder as internal', () => {
    expect(isInternalWatchPath(
      '/Users/pedromartinez/Dev/pmatz/cafezin/app/src/App.tsx',
      workspacePath,
    )).toBe(false);
  });

  it('still ignores known legacy internal files only', () => {
    expect(isInternalWatchPath(
      '/Users/pedromartinez/Dev/pmatz/cafezin/copilot-log.jsonl',
      workspacePath,
    )).toBe(true);

    expect(isInternalWatchPath(
      '/Users/pedromartinez/Dev/pmatz/cafezin/docs/brainstorm.md',
      workspacePath,
    )).toBe(false);
  });
});