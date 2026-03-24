import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { SettingsTab } from './useModals';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

interface UseTauriMenuListenersOptions {
  onUpdate: () => void;
  openSettings: (tab?: SettingsTab) => void;
  onNewWindow: () => void;
  onSwitchWorkspace: () => void;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  newFileRef: MutableRefObject<(() => void) | null>;
  onExportPDF: () => void;
  setExportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setImgSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setAiOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setViewMode: (mode: 'edit' | 'preview') => void;
  tabViewModeRef: MutableRefObject<Map<string, string>>;
  onFormat: () => void;
  fileTypeKind: string | null | undefined;
  viewMode: string;
  activeTabId: string | null;
}

export function useTauriMenuListeners({
  onUpdate,
  openSettings,
  onNewWindow,
  onSwitchWorkspace,
  setSidebarOpen,
  newFileRef,
  onExportPDF,
  setExportModalOpen,
  setImgSearchOpen,
  setAiOpen,
  setViewMode,
  tabViewModeRef,
  onFormat,
  fileTypeKind,
  viewMode,
  activeTabId,
}: UseTauriMenuListenersOptions) {
  // Listen for the native menu "Update Cafezin…" event
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen('menu-update-app', () => onUpdate());
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for the native menu "Settings…" event (⌘,)
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen('menu-settings', () => openSettings());
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
  // openSettings is stable — safe to omit from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for cafezin:open-settings events dispatched by PremiumGate and other components
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent<string>).detail;
      openSettings(tab as SettingsTab);
    };
    window.addEventListener('cafezin:open-settings', handler);
    return () => window.removeEventListener('cafezin:open-settings', handler);
  // openSettings is stable — safe to omit from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for native File / View menu events
  useEffect(() => {
    if (!isTauri) return;
    const uns = [
      listen('menu-new-window',       () => { void onNewWindow(); }),
      listen('menu-new-file',         () => { setSidebarOpen(true); setTimeout(() => newFileRef.current?.(), 80); }),
      listen('menu-export-pdf',       () => { if (fileTypeKind === 'markdown') onExportPDF(); }),
      listen('menu-export-modal',     () => setExportModalOpen(true)),
      listen('menu-switch-workspace', () => onSwitchWorkspace()),
      listen('menu-toggle-sidebar',   () => setSidebarOpen((v) => !v)),
      listen('menu-image-search',     () => setImgSearchOpen(true)),
      listen('menu-toggle-copilot',   () => setAiOpen((v) => !v)),
      listen('menu-view-edit',        () => { setViewMode('edit');    if (activeTabId) tabViewModeRef.current.set(activeTabId, 'edit'); }),
      listen('menu-view-preview',     () => { setViewMode('preview'); if (activeTabId) tabViewModeRef.current.set(activeTabId, 'preview'); }),
      listen('menu-format-file',      () => { if (fileTypeKind === 'code' && viewMode === 'edit') onFormat(); }),
    ];
    return () => { uns.forEach((p) => p.then((fn) => fn()).catch(() => {})); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileTypeKind, viewMode, activeTabId]);
}
