/** Web shim for @tauri-apps/plugin-process — reload the tab instead of relaunching. */

export async function relaunch(): Promise<void> {
  window.location.reload();
}

export async function exit(_code?: number): Promise<void> {
  window.close();
}
