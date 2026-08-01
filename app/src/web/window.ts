/**
 * Web shim for @tauri-apps/api/window and webviewWindow — no-op window
 * management (multi-window, drag-and-drop, focus events are desktop-only).
 */

type UnlistenFn = () => void;

export function getCurrentWindow(): {
  onDragDropEvent: (cb: (event: { payload: string[] }) => void) => Promise<UnlistenFn>;
  onFocusChanged: (cb: (event: { payload: boolean }) => void) => Promise<UnlistenFn>;
  requestUserAttention: () => void;
  setTitle: (_title: string) => void;
  close: () => void;
} {
  return {
    onDragDropEvent: async () => () => {},
    onFocusChanged: async () => () => {},
    requestUserAttention: () => {},
    setTitle: () => {},
    close: () => {},
  };
}

export class WebviewWindow {
  constructor(
    _label: string,
    _options?: { url?: string; width?: number; height?: number },
  ) {}

  static getAll(): never[] {
    return [];
  }
}

export type DragDropEvent = { type: string; payload: unknown };

export const UserAttentionType = {
  Critical: 1,
  Informational: 2,
} as const;
