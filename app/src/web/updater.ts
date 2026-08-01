/**
 * Web shim for @tauri-apps/plugin-updater — no auto-update in the browser;
 * the deployed site is updated by redeploying it.
 */

export async function check(): Promise<null> {
  return null;
}

export async function downloadAndInstall(): Promise<void> {
  /* nothing to do */
}
