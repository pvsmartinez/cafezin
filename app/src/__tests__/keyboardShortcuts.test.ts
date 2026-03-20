import { describe, expect, it } from 'vitest';
import {
  eventToShortcut,
  formatShortcutTokens,
  getShortcutBindings,
  matchesShortcut,
} from '../keyboardShortcuts';

describe('keyboardShortcuts', () => {
  it('uses Cmd/Ctrl+Backslash as the default sidebar shortcut', () => {
    expect(getShortcutBindings().toggleSidebar).toBe('Mod+\\');
  });

  it('normalizes recorded shortcuts with Mod', () => {
    expect(
      eventToShortcut({ key: '.', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true } as KeyboardEvent),
    ).toBe('Mod+Shift+.');
  });

  it('matches punctuation shortcuts correctly', () => {
    expect(
      matchesShortcut('Mod+\\', { key: '\\', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false } as KeyboardEvent),
    ).toBe(true);
  });

  it('formats shortcuts into display tokens', () => {
    expect(formatShortcutTokens('Mod+Shift+P', true)).toEqual(['⌘', '⇧', 'P']);
  });
});