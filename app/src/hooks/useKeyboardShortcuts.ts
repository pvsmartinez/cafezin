/**
 * useKeyboardShortcuts
 *
 * Registers a global `keydown` listener for all app-level shortcuts.
 * The listener is recreated whenever the options reference changes, so
 * all callbacks must be stable (useCallback) or wrapped in refs by the
 * caller to avoid excessive re-renders.
 *
 * Shortcuts handled:
 *   Cmd/Ctrl+K           Open AI panel
 *   Cmd/Ctrl+W           Close active tab
 *   Cmd/Ctrl+,           Open settings
 *   Cmd/Ctrl+\           Toggle sidebar
 *   Cmd/Ctrl+S           Save current file immediately
 *   Cmd/Ctrl+Shift+R     Reload / revert file from disk
 *   Cmd/Ctrl+T / N       New file
 *   Ctrl+Tab             Next tab
 *   Ctrl+Shift+Tab       Previous tab
 *   Cmd/Ctrl+F           Toggle inline find/replace
 *   Cmd/Ctrl+Shift+F     Project-wide search
 *   Cmd/Ctrl+Shift+P     Toggle Edit / Preview mode
 *   Cmd/Ctrl+Shift+.     Toggle focus (distraction-free) mode
 *   Escape               Close AI panel (when open)
 *   Cmd/Ctrl+J           Toggle terminal panel
 */
import { useEffect, useRef } from 'react';
import { getShortcutBindings, matchesShortcut, type ShortcutOverrideMap } from '../keyboardShortcuts';

export interface KeyboardShortcutOptions {
  /** Whether the AI panel is currently open (used for Escape key). */
  aiOpen: boolean;
  /** Currently-active tab path. */
  activeTabId: string | null;
  /** All open tab paths (for Ctrl+Tab cycling). */
  tabs: string[];
  /** Metadata about the active file (kind, supportsPreview, language). */
  fileTypeInfo: {
    kind: string;
    supportsPreview?: boolean;
    language?: string;
  } | null;
  shortcutOverrides?: ShortcutOverrideMap;

  // ── Callbacks ─────────────────────────────────────────────────────────────
  onOpenAI:       () => void;
  onCloseAI:      () => void;
  onCloseTab:     (id: string) => void;
  onOpenSettings: () => void;
  onToggleSidebar:() => void;
  /** Called for Cmd+S. The handler itself is responsible for saving and toasting. */
  onSave:         () => void;
  onReload:       () => void;
  onNewFile:      () => void;
  /** Switch to an adjacent tab by path. */
  onSwitchTab:    (id: string) => void;
  onToggleFind:   () => void;
  onGlobalSearch: () => void;
  onTogglePreview:() => void;
  onToggleTerminal:() => void;
  onToggleFocusMode?: () => void;
  focusMode?: boolean;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
}

export function useKeyboardShortcuts(opts: KeyboardShortcutOptions): void {
  // Keep a stable ref so the listener registered once always sees the latest
  // option values without being torn down and re-created on every file switch.
  // Previously the effect depended on `tabs`, `activeTabId`, `fileTypeInfo`,
  // and all 12 callbacks — causing removeEventListener + addEventListener on
  // every tab change.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const {
        aiOpen, activeTabId, tabs, fileTypeInfo,
        shortcutOverrides,
        onOpenAI, onCloseAI, onCloseTab, onOpenSettings,
        onToggleSidebar, onSave, onReload, onNewFile, onSwitchTab,
        onToggleFind, onGlobalSearch, onTogglePreview, onToggleTerminal,
        onToggleFocusMode, focusMode,
      } = optsRef.current;
      const bindings = getShortcutBindings(shortcutOverrides);

      if (matchesShortcut(bindings.openAI, e)) {
        e.preventDefault();
        onOpenAI();
        return;
      }
      if (matchesShortcut(bindings.closeTab, e)) {
        e.preventDefault();
        if (activeTabId) onCloseTab(activeTabId);
        return;
      }
      if (matchesShortcut(bindings.openSettings, e)) {
        e.preventDefault();
        onOpenSettings();
        return;
      }
      if (matchesShortcut(bindings.toggleSidebar, e)) {
        e.preventDefault();
        onToggleSidebar();
        return;
      }
      if (matchesShortcut(bindings.save, e)) {
        e.preventDefault();
        onSave();
        return;
      }
      if (matchesShortcut(bindings.reload, e)) {
        e.preventDefault();
        onReload();
        return;
      }
      if (matchesShortcut(bindings.newFile, e)) {
        e.preventDefault();
        onNewFile();
        return;
      }
      if (matchesShortcut(bindings.nextTab, e)) {
        e.preventDefault();
        if (tabs.length > 1 && activeTabId) {
          const idx = tabs.indexOf(activeTabId);
          onSwitchTab(tabs[(idx + 1) % tabs.length]);
        }
        return;
      }
      if (matchesShortcut(bindings.prevTab, e)) {
        e.preventDefault();
        if (tabs.length > 1 && activeTabId) {
          const idx = tabs.indexOf(activeTabId);
          onSwitchTab(tabs[(idx - 1 + tabs.length) % tabs.length]);
        }
        return;
      }
      if (matchesShortcut(bindings.toggleFind, e)) {
        if (fileTypeInfo?.kind && !['pdf', 'video', 'image'].includes(fileTypeInfo.kind)) {
          e.preventDefault();
          onToggleFind();
        }
        return;
      }
      if (matchesShortcut(bindings.globalSearch, e)) {
        e.preventDefault();
        onGlobalSearch();
        return;
      }
      if (matchesShortcut(bindings.togglePreview, e)) {
        if (fileTypeInfo?.supportsPreview) {
          e.preventDefault();
          onTogglePreview();
        }
        return;
      }
      if (matchesShortcut(bindings.closeAI, e)) {
        if (focusMode) { onToggleFocusMode?.(); return; }
        if (aiOpen) onCloseAI();
        return;
      }
      if (matchesShortcut(bindings.toggleFocusMode, e)) {
        e.preventDefault();
        onToggleFocusMode?.();
        return;
      }
      if (matchesShortcut(bindings.toggleTerminal, e)) {
        e.preventDefault();
        onToggleTerminal();
        return;
      }
      // Zoom: Cmd/Ctrl + = or + (in), - (out), 0 (reset) — standard in every editor
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          optsRef.current.onZoomIn?.();
          return;
        }
        if (e.key === '-') {
          e.preventDefault();
          optsRef.current.onZoomOut?.();
          return;
        }
        if (e.key === '0') {
          e.preventDefault();
          optsRef.current.onZoomReset?.();
          return;
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  // Intentionally empty — opts values are read via optsRef.current so the
  // listener is registered exactly once and never thrashes on file switches.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
