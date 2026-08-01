/**
 * Web shim for @tauri-apps/plugin-dialog.
 *
 * Folder picking uses the File System Access API (`showDirectoryPicker`).
 * The chosen directory is imported into the OPFS backend at
 * "/imported/<name>", which the app then treats as a normal workspace
 * folder (its virtual path). "New workspace" flows never touch this shim.
 */

import { _opfsRoot, _importDirectory } from './fs';

interface OpenOptions {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
  defaultPath?: string;
}

export async function open(
  options?: OpenOptions,
): Promise<string | string[] | null> {
  if (options?.directory) {
    const picker = (window as unknown as {
      showDirectoryPicker?: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker;
    if (!picker) {
      throw new Error('Este navegador não suporta abrir pastas (File System Access API). Use Chrome ou Edge.');
    }
    const handle = await picker({ mode: 'readwrite' });
    const root = await _opfsRoot();
    const name = handle.name || 'workspace';
    let dest = `/imported/${name}`;
    let suffix = 1;
    while (await root.getDirectoryHandle(dest.slice('/imported/'.length)).then(() => true).catch(() => false)) {
      dest = `/imported/${name}-${suffix++}`;
    }
    await _importDirectory(handle, dest);
    return dest;
  }
  // File open is only used in desktop flows (export file → saveAs uses download in web)
  return null;
}

export async function save(_options?: {
  title?: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}): Promise<string | null> {
  return null;
}
