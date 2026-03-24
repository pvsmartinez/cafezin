/**
 * Pure utility functions and constants used by App.tsx and related modules.
 * No React imports, no side effects.
 */
import type { Workspace } from '../types';

/** Returns negative if a < b, 0 if equal, positive if a > b */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export const FALLBACK_CONTENT = `# Untitled Document\n\nStart writing here…\n`;

export const EDITOR_FONT_SIZE_MIN = 10;
export const EDITOR_FONT_SIZE_MAX = 28;
export const DEFAULT_EDITOR_FONT_SIZE = 14;

export function collectWorkspaceFilePaths(nodes: Workspace['fileTree']): Set<string> {
  const paths = new Set<string>();
  for (const node of nodes) {
    if (node.isDirectory) {
      for (const child of collectWorkspaceFilePaths(node.children ?? [])) paths.add(child);
      continue;
    }
    paths.add(node.path);
  }
  return paths;
}

export function sameStringArray(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function sameFileTree(a: Workspace['fileTree'], b: Workspace['fileTree']): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];

    if (
      left.name !== right.name ||
      left.path !== right.path ||
      left.isDirectory !== right.isDirectory
    ) {
      return false;
    }

    if (left.isDirectory) {
      if (!sameFileTree(left.children ?? [], right.children ?? [])) return false;
    }
  }

  return true;
}

export function remapPathSet(paths: Set<string>, fromPath: string, toPath: string): Set<string> {
  const next = new Set<string>();
  for (const path of paths) {
    if (path === fromPath) next.add(toPath);
    else if (path.startsWith(`${fromPath}/`)) next.add(`${toPath}${path.slice(fromPath.length)}`);
    else next.add(path);
  }
  return next;
}

export function diffWorkspacePaths(
  previousTree: Workspace['fileTree'] | undefined,
  nextTree: Workspace['fileTree'] | undefined,
): { added: string[]; removed: string[] } {
  const previous = previousTree ? collectWorkspaceFilePaths(previousTree) : new Set<string>();
  const next = nextTree ? collectWorkspaceFilePaths(nextTree) : new Set<string>();
  const added = Array.from(next).filter((path) => !previous.has(path)).sort();
  const removed = Array.from(previous).filter((path) => !next.has(path)).sort();
  return { added, removed };
}
