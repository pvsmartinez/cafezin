/**
 * Web shim for @tauri-apps/api/event — no-op listeners (native menu events,
 * update events, deep-link auth callbacks are desktop-only).
 */

export interface Event<T> {
  event: string;
  id: number;
  payload: T;
}

export type UnlistenFn = () => void;

export async function listen<T>(
  _event: string,
  _handler: (event: Event<T>) => void,
): Promise<UnlistenFn> {
  return () => {};
}

export async function once<T>(
  _event: string,
  _handler: (event: Event<T>) => void,
): Promise<UnlistenFn> {
  return () => {};
}

export async function emit(_event: string, _payload?: unknown): Promise<void> {
  /* no-op */
}

export async function getCurrent(): Promise<string> {
  return 'main';
}
