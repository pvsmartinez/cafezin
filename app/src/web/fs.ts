/**
 * Web shim for @tauri-apps/plugin-fs backed by the Origin Private File
 * System (OPFS). Drop-in replacement so `services/fs.ts` needs no changes:
 *
 * - The browser build's `documentDir()` returns "/", so the wrapper passes
 *   absolute virtual paths like "/workspace/notes.md" — we map each segment
 *   to an OPFS directory/file handle.
 * - Data lives in the origin's persistent storage (no network, cleared only
 *   if the user wipes site data or storage is evicted under pressure).
 *
 * Commands that make no sense in a browser (watch, truncate is fine via
 * writable) stay unimplemented and throw.
 */

export enum BaseDirectory {
  App = 0,
  Audio = 1,
  Cache = 2,
  Config = 3,
  Data = 4,
  LocalData = 5,
  Desktop = 6,
  Document = 7,
  Download = 8,
  Executable = 9,
  Font = 10,
  Home = 11,
  Picture = 12,
  Public = 13,
  Resource = 14,
  Runtime = 15,
  Temp = 16,
  Template = 17,
  Video = 18,
  Log = 19,
}

export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

export interface FileInfo {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtime: Date | null;
  atime: Date | null;
  birthtime: Date | null;
  dev: number;
  ino: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev: number;
  blksize: number;
  blocks: number;
}

export interface MkdirOptions {
  baseDir?: BaseDirectory;
  recursive?: boolean;
}

export interface RemoveOptions {
  baseDir?: BaseDirectory;
  recursive?: boolean;
}

export interface WriteFileOptions {
  baseDir?: BaseDirectory;
  append?: boolean;
  create?: boolean;
}

export interface ReadDirOptions {
  baseDir?: BaseDirectory;
  recursive?: boolean;
}

type OPFSHandle = FileSystemDirectoryHandle | FileSystemFileHandle;

// ── Root access ──────────────────────────────────────────────────────────────

let _rootPromise: Promise<FileSystemDirectoryHandle> | null = null;

export function _opfsRoot(): Promise<FileSystemDirectoryHandle> {
  if (!_rootPromise) {
    _rootPromise = (async () => {
      const storage = navigator.storage?.getDirectory;
      if (!storage) throw new Error('OPFS is not available in this browser');
      return navigator.storage.getDirectory();
    })();
  }
  return _rootPromise;
}

// ── Path resolution ──────────────────────────────────────────────────────────

function segmentsOf(path: string, baseDir?: BaseDirectory): string[] {
  if (baseDir !== undefined) {
    // The wrapper only sends baseDir for paths inside the virtual root.
    if (path === '.' || path === '') return [];
    return path.split('/').filter(Boolean);
  }
  return path.split('/').filter(Boolean);
}

async function resolve(
  path: string,
  baseDir: BaseDirectory | undefined,
  opts: { createDirs?: boolean; targetKind?: 'file' | 'directory' } = {},
): Promise<OPFSHandle> {
  const root = await _opfsRoot();
  const parts = segmentsOf(path, baseDir);
  if (parts.length === 0) return root;
  let current: OPFSHandle = root;
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    const kind = isLast && opts.targetKind === 'file' ? 'file' : 'directory';
    try {
      current = kind === 'file'
        ? await (current as FileSystemDirectoryHandle).getFileHandle(parts[i], { create: !!opts.createDirs })
        : await (current as FileSystemDirectoryHandle).getDirectoryHandle(parts[i], { create: !!opts.createDirs });
    } catch (err) {
      if (opts.createDirs && kind === 'directory') throw err;
      throw new Error(`web-fs: "${path}" not found`);
    }
  }
  return current;
}

async function readBytes(handle: OPFSHandle): Promise<Uint8Array> {
  if (handle.kind !== 'file') throw new Error(`web-fs: expected file, got directory`);
  const file = await (handle as FileSystemFileHandle).getFile();
  return new Uint8Array(await file.arrayBuffer());
}

async function writeBytes(
  handle: OPFSHandle,
  data: Uint8Array,
  append: boolean,
): Promise<void> {
  if (handle.kind !== 'file') throw new Error('web-fs: expected file, got directory');
  const writable = await (handle as FileSystemFileHandle).createWritable({
    keepExistingData: append,
  });
  await writable.write(data);
  await writable.close();
}

// ── Public API (mirrors @tauri-apps/plugin-fs) ──────────────────────────────

export async function readTextFile(
  path: string,
  options?: { baseDir?: BaseDirectory },
): Promise<string> {
  const handle = await resolve(path, options?.baseDir, { targetKind: 'file' });
  return new TextDecoder('utf-8').decode(await readBytes(handle));
}

export async function readFile(
  path: string,
  options?: { baseDir?: BaseDirectory },
): Promise<Uint8Array> {
  const handle = await resolve(path, options?.baseDir, { targetKind: 'file' });
  return readBytes(handle);
}

export async function writeTextFile(
  path: string,
  data: string,
  options?: WriteFileOptions,
): Promise<void> {
  const handle = await resolve(path, options?.baseDir, {
    targetKind: 'file',
    createDirs: true,
  });
  await writeBytes(handle, new TextEncoder().encode(data), options?.append ?? false);
}

export async function writeFile(
  path: string,
  data: Uint8Array,
  options?: WriteFileOptions,
): Promise<void> {
  const handle = await resolve(path, options?.baseDir, {
    targetKind: 'file',
    createDirs: true,
  });
  await writeBytes(handle, data, options?.append ?? false);
}

export async function readDir(
  path: string,
  options?: ReadDirOptions,
): Promise<DirEntry[]> {
  const handle = await resolve(path, options?.baseDir);
  if (handle.kind !== 'directory') throw new Error('web-fs: expected directory');
  const entries: DirEntry[] = [];
  for await (const [name, entry] of (handle as FileSystemDirectoryHandle).entries()) {
    entries.push({
      name,
      isFile: entry.kind === 'file',
      isDirectory: entry.kind === 'directory',
      isSymlink: false,
    });
  }
  return entries;
}

export async function mkdir(
  path: string,
  options?: MkdirOptions,
): Promise<void> {
  if (path === '/' || path === '.') return;
  await resolve(path, options?.baseDir, { createDirs: true });
}

export async function exists(
  path: string,
  options?: { baseDir?: BaseDirectory },
): Promise<boolean> {
  const root = await _opfsRoot();
  const parts = segmentsOf(path, options?.baseDir);
  let current: OPFSHandle = root;
  for (const part of parts) {
    try {
      const parent = current as FileSystemDirectoryHandle;
      current = await parent.getDirectoryHandle(part).catch(() =>
        parent.getFileHandle(part),
      );
    } catch {
      return false;
    }
  }
  return true;
}

export async function remove(
  path: string,
  options?: RemoveOptions,
): Promise<void> {
  const parts = segmentsOf(path, options?.baseDir);
  if (parts.length === 0) throw new Error('web-fs: cannot remove root');
  const name = parts[parts.length - 1];
  const parent = await resolve(
    '/' + parts.slice(0, -1).join('/'),
    undefined,
    { targetKind: 'directory', createDirs: true },
  );
  if (parent.kind !== 'directory') throw new Error('web-fs: expected directory');
  const dir = parent as FileSystemDirectoryHandle;
  try {
    const file = await dir.getFileHandle(name);
    await file.remove();
    return;
  } catch {
    /* fall through to directory */
  }
  try {
    const sub = await dir.getDirectoryHandle(name);
    await sub.remove({ recursive: options?.recursive ?? false });
  } catch (err) {
    if ((err as DOMException)?.name === 'InvalidModificationError') {
      throw new Error(`web-fs: directory not empty: "${path}"`);
    }
    throw new Error(`web-fs: "${path}" not found`);
  }
}

export async function copyFile(
  src: string,
  dest: string,
  options?: { fromPathBaseDir?: BaseDirectory; toPathBaseDir?: BaseDirectory },
): Promise<void> {
  const srcHandle = await resolve(src, options?.fromPathBaseDir, { targetKind: 'file' });
  const bytes = await readBytes(srcHandle);
  const destHandle = await resolve(dest, options?.toPathBaseDir, {
    targetKind: 'file',
    createDirs: true,
  });
  await writeBytes(destHandle, bytes, false);
}

export async function rename(
  oldPath: string,
  newPath: string,
  options?: { oldPathBaseDir?: BaseDirectory; newPathBaseDir?: BaseDirectory },
): Promise<void> {
  const srcHandle = await resolve(oldPath, options?.oldPathBaseDir, { targetKind: 'file' });
  const bytes = await readBytes(srcHandle);
  const destHandle = await resolve(newPath, options?.newPathBaseDir, {
    targetKind: 'file',
    createDirs: true,
  });
  await writeBytes(destHandle, bytes, false);
  await (srcHandle as FileSystemFileHandle).remove();
}

export async function stat(
  path: string,
  options?: { baseDir?: BaseDirectory },
): Promise<FileInfo> {
  const handle = await resolve(path, options?.baseDir);
  const base: FileInfo = {
    isFile: handle.kind === 'file',
    isDirectory: handle.kind === 'directory',
    isSymlink: false,
    size: 0,
    mtime: null,
    atime: null,
    birthtime: null,
    dev: 0,
    ino: 0,
    mode: 0,
    nlink: 1,
    uid: 0,
    gid: 0,
    rdev: 0,
    blksize: 0,
    blocks: 0,
  };
  if (handle.kind === 'file') {
    const file = await (handle as FileSystemFileHandle).getFile();
    base.size = file.size;
    base.mtime = new Date(file.lastModified);
    base.atime = base.mtime;
    base.birthtime = base.mtime;
  }
  return base;
}

// ── Import a real user-picked directory into OPFS (used by dialog shim) ─────

export async function _importDirectory(
  source: FileSystemDirectoryHandle,
  destPath: string,
): Promise<void> {
  const root = await _opfsRoot();
  const parts = segmentsOf(destPath);
  let current = root;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  const copyEntry = async (entry: FileSystemDirectoryHandle | FileSystemFileHandle, target: FileSystemDirectoryHandle) => {
    if (entry.kind === 'directory') {
      const sub = await target.getDirectoryHandle(entry.name, { create: true });
      for await (const [, child] of entry.entries()) {
        await copyEntry(child, sub);
      }
      return;
    }
    const file = await (entry as FileSystemFileHandle).getFile();
    const out = await target.getFileHandle(entry.name, { create: true });
    const writable = await out.createWritable();
    await writable.write(file);
    await writable.close();
  };
  for await (const [, child] of source.entries()) {
    await copyEntry(child, current);
  }
}
