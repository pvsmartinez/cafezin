/**
 * Augments the DOM File System Access API types available in this project's
 * TypeScript lib version with the newer OPFS members used by src/web/fs.ts
 * (async iteration over directory entries, handle removal, keepExistingData
 * writes). These are part of the standard; the bundled lib.dom is just older.
 */

export {};

declare global {
  interface FileSystemFileHandle {
    remove(): Promise<void>;
  }
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<
      [string, FileSystemDirectoryHandle | FileSystemFileHandle]
    >;
    remove(options?: { recursive?: boolean }): Promise<void>;
  }
}
