export type AppShortcutGroup = 'files' | 'navigation' | 'ai' | 'app';

export type AppShortcutId =
  | 'openAI'
  | 'closeTab'
  | 'openSettings'
  | 'toggleSidebar'
  | 'save'
  | 'reload'
  | 'newFile'
  | 'nextTab'
  | 'prevTab'
  | 'toggleFind'
  | 'globalSearch'
  | 'togglePreview'
  | 'toggleFocusMode'
  | 'closeAI'
  | 'toggleTerminal';

export type ShortcutOverrideMap = Partial<Record<AppShortcutId, string>>;

export interface AppShortcutDefinition {
  id: AppShortcutId;
  group: AppShortcutGroup;
  defaultBinding: string;
  labelKey: string;
  noteKey?: string;
}

export const APP_SHORTCUTS: AppShortcutDefinition[] = [
  { id: 'save',            group: 'files',      defaultBinding: 'Mod+S',          labelKey: 'settings.scSave' },
  { id: 'closeTab',        group: 'files',      defaultBinding: 'Mod+W',          labelKey: 'settings.scCloseTab' },
  { id: 'reload',          group: 'files',      defaultBinding: 'Mod+Shift+R',    labelKey: 'settings.scReload' },
  { id: 'newFile',         group: 'files',      defaultBinding: 'Mod+N',          labelKey: 'settings.scNewFile' },
  { id: 'nextTab',         group: 'files',      defaultBinding: 'Ctrl+Tab',       labelKey: 'settings.scNextTab' },
  { id: 'prevTab',         group: 'files',      defaultBinding: 'Ctrl+Shift+Tab', labelKey: 'settings.scPrevTab' },
  { id: 'toggleFind',      group: 'navigation', defaultBinding: 'Mod+F',          labelKey: 'settings.scFindReplace' },
  { id: 'globalSearch',    group: 'navigation', defaultBinding: 'Mod+Shift+F',    labelKey: 'settings.scProjectSearch' },
  { id: 'togglePreview',   group: 'navigation', defaultBinding: 'Mod+Shift+P',    labelKey: 'settings.scTogglePreview' },
  { id: 'toggleSidebar',   group: 'navigation', defaultBinding: 'Mod+\\',        labelKey: 'settings.scToggleSidebar' },
  { id: 'openAI',          group: 'ai',         defaultBinding: 'Mod+K',          labelKey: 'settings.scOpenCopilot' },
  { id: 'closeAI',         group: 'ai',         defaultBinding: 'Escape',         labelKey: 'settings.scCloseCopilot' },
  { id: 'openSettings',    group: 'app',        defaultBinding: 'Mod+,',          labelKey: 'settings.scOpenSettings' },
  { id: 'toggleTerminal',  group: 'app',        defaultBinding: 'Mod+J',          labelKey: 'settings.scToggleTerminal' },
  { id: 'toggleFocusMode', group: 'app',        defaultBinding: 'Mod+Shift+.',    labelKey: 'settings.scToggleFocusMode' },
];

const DEFAULT_SHORTCUT_BINDINGS = Object.freeze(
  Object.fromEntries(APP_SHORTCUTS.map((shortcut) => [shortcut.id, shortcut.defaultBinding])) as Record<AppShortcutId, string>,
);

const MODIFIER_ALIASES: Record<string, 'Mod' | 'Ctrl' | 'Meta' | 'Alt' | 'Shift'> = {
  mod: 'Mod',
  cmd: 'Meta',
  command: 'Meta',
  meta: 'Meta',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
};

const SPECIAL_KEY_ALIASES: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  return: 'Enter',
  enter: 'Enter',
  tab: 'Tab',
  space: 'Space',
  spacebar: 'Space',
  comma: ',',
  period: '.',
  dot: '.',
  slash: '/',
  backslash: '\\',
  bracketleft: '[',
  bracketright: ']',
  del: 'Delete',
  delete: 'Delete',
};

interface ParsedShortcut {
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

function normalizeKeyToken(token: string): string | null {
  const value = token.trim().toLowerCase();
  if (!value) return null;
  if (SPECIAL_KEY_ALIASES[value]) return SPECIAL_KEY_ALIASES[value];
  if (value.length === 1) {
    if (/[a-z]/.test(value)) return value.toUpperCase();
    return value;
  }
  if (/^f\d{1,2}$/i.test(value)) return value.toUpperCase();
  return token.trim();
}

function normalizeEventKey(key: string): string | null {
  if (!key) return null;
  if (key === ' ') return 'Space';
  if (key.length === 1) {
    if (/[a-z]/i.test(key)) return key.toUpperCase();
    if (key === 'ƒ') return 'F';
    return key;
  }
  return normalizeKeyToken(key);
}

function parseShortcut(value: string): ParsedShortcut | null {
  const parts = value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const parsed: ParsedShortcut = {
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    key: '',
  };

  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) {
      if (modifier === 'Mod') parsed.mod = true;
      if (modifier === 'Ctrl') parsed.ctrl = true;
      if (modifier === 'Meta') parsed.meta = true;
      if (modifier === 'Alt') parsed.alt = true;
      if (modifier === 'Shift') parsed.shift = true;
      continue;
    }

    const key = normalizeKeyToken(part);
    if (!key || parsed.key) return null;
    parsed.key = key;
  }

  return parsed.key ? parsed : null;
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return true;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform);
}

export function normalizeShortcutValue(value: string): string | null {
  const parsed = parseShortcut(value);
  if (!parsed) return null;

  const parts: string[] = [];
  if (parsed.mod) parts.push('Mod');
  if (parsed.ctrl) parts.push('Ctrl');
  if (parsed.meta) parts.push('Meta');
  if (parsed.alt) parts.push('Alt');
  if (parsed.shift) parts.push('Shift');
  parts.push(parsed.key);
  return parts.join('+');
}

export function getShortcutBindings(overrides?: ShortcutOverrideMap): Record<AppShortcutId, string> {
  const merged = { ...DEFAULT_SHORTCUT_BINDINGS };
  if (!overrides) return merged;
  for (const shortcut of APP_SHORTCUTS) {
    const override = overrides[shortcut.id];
    const normalized = override ? normalizeShortcutValue(override) : null;
    if (normalized) merged[shortcut.id] = normalized;
  }
  return merged;
}

export function pruneShortcutOverrides(overrides: ShortcutOverrideMap): ShortcutOverrideMap | undefined {
  const next: ShortcutOverrideMap = {};
  for (const shortcut of APP_SHORTCUTS) {
    const override = overrides[shortcut.id];
    const normalized = override ? normalizeShortcutValue(override) : null;
    if (normalized && normalized !== DEFAULT_SHORTCUT_BINDINGS[shortcut.id]) {
      next[shortcut.id] = normalized;
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function formatShortcutTokens(value: string, mac = isMacPlatform()): string[] {
  const parsed = parseShortcut(value);
  if (!parsed) return [value];

  const parts: string[] = [];
  if (parsed.mod) parts.push(mac ? '⌘' : 'Ctrl');
  if (parsed.ctrl) parts.push(mac ? '⌃' : 'Ctrl');
  if (parsed.meta) parts.push(mac ? '⌘' : 'Meta');
  if (parsed.alt) parts.push(mac ? '⌥' : 'Alt');
  if (parsed.shift) parts.push(mac ? '⇧' : 'Shift');

  if (parsed.key === 'Escape') parts.push('Esc');
  else if (parsed.key === 'Space') parts.push('Space');
  else parts.push(parsed.key);

  return parts;
}

export function formatShortcutLabel(value: string, mac = isMacPlatform()): string {
  return formatShortcutTokens(value, mac).join(mac ? '' : '+');
}

export function matchesShortcut(value: string, event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): boolean {
  const parsed = parseShortcut(value);
  if (!parsed) return false;

  const normalizedKey = normalizeEventKey(event.key);
  if (!normalizedKey || normalizedKey.toLowerCase() !== parsed.key.toLowerCase()) return false;

  const wantsAnyMod = parsed.mod;
  if (wantsAnyMod !== (event.metaKey || event.ctrlKey)) return false;
  if (!wantsAnyMod && parsed.ctrl !== event.ctrlKey) return false;
  if (!wantsAnyMod && parsed.meta !== event.metaKey) return false;
  if (parsed.alt !== event.altKey) return false;
  if (parsed.shift !== event.shiftKey) return false;
  return true;
}

export function eventToShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string | null {
  const key = normalizeEventKey(event.key);
  if (!key) return null;
  if (key === 'Meta' || key === 'Control' || key === 'Alt' || key === 'Shift') return null;

  const hasPrimaryModifier = event.metaKey || event.ctrlKey || event.altKey;
  const canBePlain = key === 'Escape';
  if (!hasPrimaryModifier && !canBePlain) return null;

  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push('Mod');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return normalizeShortcutValue(parts.join('+'));
}