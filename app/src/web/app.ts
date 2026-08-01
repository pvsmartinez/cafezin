/** Web shim for @tauri-apps/api/app — static identity in the browser. */

export async function getVersion(): Promise<string> {
  return '0.0.0-web';
}

export async function getName(): Promise<string> {
  return 'Cafezin (web)';
}
