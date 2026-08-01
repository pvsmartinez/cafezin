/**
 * Web shim for @tauri-apps/api/path.
 *
 * The OPFS backend treats the browser's virtual origin storage as a
 * filesystem rooted at "/". Absolute workspace paths like
 * "/workspace/notes.md" map directly onto it.
 */

export async function documentDir(): Promise<string> {
  return '/';
}

export async function homeDir(): Promise<string> {
  return '/';
}

export async function appDataDir(): Promise<string> {
  return '/';
}

export async function appConfigDir(): Promise<string> {
  return '/';
}

export async function appLocalDataDir(): Promise<string> {
  return '/';
}

export async function join(...paths: string[]): Promise<string> {
  return paths.join('/').replace(/\/+/g, '/');
}
