import { describe, expect, it } from 'vitest';

import {
  pruneTabList,
  remapTabList,
  remapTabPath,
  resolvePrunedActiveTab,
} from '../hooks/useTabManager';

describe('useTabManager path helpers', () => {
  it('remaps exact file paths and nested descendants only', () => {
    expect(remapTabPath('notes/ch1.md', 'notes/ch1.md', 'drafts/ch1.md')).toBe('drafts/ch1.md');
    expect(remapTabPath('notes/part/ch1.md', 'notes', 'drafts')).toBe('drafts/part/ch1.md');
    expect(remapTabPath('notebook/ch1.md', 'notes', 'drafts')).toBe('notebook/ch1.md');
  });

  it('remaps a whole tab list when a folder is renamed', () => {
    expect(remapTabList(
      ['book/part1/ch1.md', 'book/part1/ch2.md', 'notes.md'],
      'book/part1',
      'book/part-1-renamed',
    )).toEqual([
      'book/part-1-renamed/ch1.md',
      'book/part-1-renamed/ch2.md',
      'notes.md',
    ]);
  });

  it('prunes tabs that disappeared from disk', () => {
    const nextTabs = pruneTabList(['a.md', 'b.md', 'c.md'], new Set(['a.md', 'c.md']));
    expect(nextTabs).toEqual(['a.md', 'c.md']);
  });

  it('selects the adjacent surviving tab after the active tab disappears', () => {
    const currentTabs = ['a.md', 'b.md', 'c.md'];
    const nextTabs = ['a.md', 'c.md'];
    expect(resolvePrunedActiveTab(currentTabs, 'b.md', nextTabs)).toBe('c.md');
    expect(resolvePrunedActiveTab(currentTabs, 'c.md', nextTabs)).toBe('c.md');
    expect(resolvePrunedActiveTab(currentTabs, 'missing.md', nextTabs)).toBe(null);
  });
});
