/**
 * Web shim for @tauri-apps/plugin-opener — open URLs in a new tab.
 */

export async function openUrl(url: string): Promise<void> {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function openPath(_path: string): Promise<void> {
  /* OPFS files have no real path — nothing to reveal */
}

export async function revealItemInDir(_path: string): Promise<void> {
  /* OPFS files have no real path — nothing to reveal */
}
