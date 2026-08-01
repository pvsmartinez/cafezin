/**
 * Web shim for @tauri-apps/api/core.
 *
 * In the browser build there is no Rust backend: every custom `invoke`
 * command rejects with a clear message, and the few call sites already
 * handle failures gracefully (git → local-only, grep → JS fallback,
 * update check → silent, shell/MCP → disabled).
 */

export async function invoke(cmd: string, _args?: unknown): Promise<never> {
  throw new Error(
    `"${cmd}" is only available in the desktop/mobile app — not in the browser build.`,
  );
}

/**
 * Local file URLs. The browser build keeps the `asset://` prefix so the
 * tldraw asset store's existing resolution logic works over OPFS.
 */
export function convertFileSrc(filePath: string): string {
  return `asset://${encodeURIComponent(filePath)}`;
}

export function transformCallback(_callback?: unknown): number {
  return 0;
}
