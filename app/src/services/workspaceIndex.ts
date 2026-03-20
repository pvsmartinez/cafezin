/**
 * Workspace file index — lightweight per-file metadata with cached outlines.
 *
 * Built asynchronously after workspace load; persisted to `.cafezin/workspace-index.json`.
 * Enables fast, index-backed file retrieval for the agent (no live file reads needed).
 *
 * Key exports:
 *   - WorkspaceIndexEntry / WorkspaceIndex  — types
 *   - extractFileOutline()                  — shared outline extractor (also used by outline_workspace tool)
 *   - loadWorkspaceIndex()                  — load cached index from disk
 *   - buildWorkspaceIndex()                 — build / incrementally refresh the index
 *   - rankWorkspaceIndex()                  — score and sort entries against a query
 */

import { readTextFile, writeTextFile, exists, stat } from './fs';
import { CONFIG_DIR } from './config';
import type { FileTreeNode } from '../types';

const INDEX_VERSION = 3;
const INDEX_FILE = 'workspace-index.json';

/** Maximum number of files to include in the index (prevents runaway indexing). */
const MAX_INDEX_FILES = 300;
/** Skip files larger than this when extracting outlines (would be noisy / slow). */
const MAX_OUTLINE_SIZE = 200_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkspaceIndexEntry {
  /** Relative path from workspace root, e.g. "chapters/cap01.md" */
  path: string;
  /** File size in bytes */
  size: number;
  /** Last-modified time as Unix ms timestamp (for staleness detection) */
  mtime: number;
  /** Cached structural outline (headings, exports, keys, etc.) — empty string if none */
  outline: string;
}

export interface WorkspaceIndex {
  /** Schema version — bump when the entry format changes */
  version: number;
  /** ISO 8601 timestamp of when the index was built */
  builtAt: string;
  entries: WorkspaceIndexEntry[];
}

// Extensions to include in the index
const INDEX_EXTS = new Set([
  'md', 'mdx', 'txt',
  'ts', 'tsx', 'js', 'jsx',
  'py', 'sql', 'sh',
  'json', 'toml', 'yaml', 'yml',
  'css', 'html', 'rs', 'env',
]);

// ── Outline extraction ────────────────────────────────────────────────────────

/**
 * Extract a compact structural outline from a file's text content.
 *
 * This function is shared with the `outline_workspace` tool executor — updating it
 * updates both the live (real-time) tool and the cached index simultaneously.
 *
 * Returns a multi-line string (e.g. headings, exports, keys) or an empty string
 * when nothing structured can be extracted.
 */
export function extractFileOutline(relPath: string, text: string): string {
  const ext = relPath.split('.').pop()?.toLowerCase() ?? '';
  const lines: string[] = [];

  if (ext === 'md' || ext === 'mdx') {
    // YAML frontmatter title
    if (text.startsWith('---')) {
      const fmEnd = text.indexOf('\n---', 3);
      if (fmEnd !== -1) {
        const fm = text.slice(3, fmEnd);
        const titleMatch = /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm);
        if (titleMatch) lines.push(`  title: "${titleMatch[1].trim()}"`);
      }
    }
    // H1–H3 headings
    const headingRe = /^(#{1,3})\s+(.+)$/gm;
    let hm: RegExpExecArray | null;
    while ((hm = headingRe.exec(text)) !== null) {
      const indent = '  '.repeat(hm[1].length);
      lines.push(`${indent}${hm[1]} ${hm[2].trim()}`);
    }
    if (/(^|\n)```mermaid(?:\s|\n)/.test(text)) {
      lines.push('  [mermaid]');
    }
    // Word count
    const words = text.replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean).length;
    lines.push(`  (${words} words)`);

  } else if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) {
    const namedRe =
      /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|type|interface|enum)\s+(\w+)/gm;
    const names: string[] = [];
    let nm: RegExpExecArray | null;
    while ((nm = namedRe.exec(text)) !== null) names.push(nm[1]);
    const reRe = /^export\s+\{([^}]+)\}/gm;
    while ((nm = reRe.exec(text)) !== null) {
      nm[1]
        .split(',')
        .map((s) => s.trim().split(/\s+/)[0])
        .filter(Boolean)
        .forEach((n) => names.push(n));
    }
    if (names.length) lines.push(`  exports: ${[...new Set(names)].join(', ')}`);
    else lines.push('  (no exports detected)');

  } else if (ext === 'py') {
    const pyRe = /^(def|class)\s+(\w+)/gm;
    const names: string[] = [];
    let pm: RegExpExecArray | null;
    while ((pm = pyRe.exec(text)) !== null) names.push(`${pm[1]} ${pm[2]}`);
    if (names.length) lines.push(`  ${names.join(', ')}`);

  } else if (ext === 'sql') {
    const sqlRe =
      /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|INDEX|TRIGGER|TYPE|SEQUENCE)\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi;
    const names: string[] = [];
    let sm: RegExpExecArray | null;
    while ((sm = sqlRe.exec(text)) !== null) names.push(sm[1]);
    const altRe = /ALTER\s+TABLE\s+["'`]?(\w+)["'`]?/gi;
    const altered = new Set<string>();
    while ((sm = altRe.exec(text)) !== null) altered.add(sm[1]);
    if (names.length) lines.push(`  creates: ${names.join(', ')}`);
    if (altered.size) lines.push(`  alters: ${[...altered].join(', ')}`);

  } else if (ext === 'sh') {
    const shLines = text.split('\n');
    for (const l of shLines) {
      const m = /^#\s+(.+)/.exec(l);
      if (m && !l.startsWith('#!/')) {
        lines.push(`  # ${m[1].trim()}`);
        break;
      }
    }

  } else if (['json', 'toml', 'yaml', 'yml'].includes(ext)) {
    try {
      if (ext === 'json') {
        const obj = JSON.parse(text) as Record<string, unknown>;
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          const keys = Object.keys(obj).slice(0, 20);
          lines.push(`  keys: ${keys.join(', ')}${Object.keys(obj).length > 20 ? ', …' : ''}`);
        }
      } else {
        const keyRe = /^([a-zA-Z_][\w.-]*)\s*[=:]/gm;
        const keys = new Set<string>();
        let km: RegExpExecArray | null;
        while ((km = keyRe.exec(text)) !== null) keys.add(km[1]);
        if (keys.size) lines.push(`  keys: ${[...keys].slice(0, 20).join(', ')}`);
      }
    } catch { /* ignore parse errors */ }
  }

  return lines.join('\n');
}

// ── Index I/O ─────────────────────────────────────────────────────────────────

/** Load the persisted workspace index from `.cafezin/workspace-index.json`. Returns null if missing or incompatible. */
export async function loadWorkspaceIndex(workspacePath: string): Promise<WorkspaceIndex | null> {
  const indexPath = `${workspacePath}/${CONFIG_DIR}/${INDEX_FILE}`;
  try {
    if (!(await exists(indexPath))) return null;
    const raw = await readTextFile(indexPath);
    const parsed = JSON.parse(raw) as WorkspaceIndex;
    if (!parsed || parsed.version !== INDEX_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveWorkspaceIndex(workspacePath: string, index: WorkspaceIndex): Promise<void> {
  const indexPath = `${workspacePath}/${CONFIG_DIR}/${INDEX_FILE}`;
  await writeTextFile(indexPath, JSON.stringify(index));
}

// ── File collection ───────────────────────────────────────────────────────────

function collectIndexableFiles(nodes: FileTreeNode[]): string[] {
  const paths: string[] = [];
  function walk(node: FileTreeNode) {
    if (node.isDirectory) {
      node.children?.forEach(walk);
      return;
    }
    if (node.path.endsWith('.tldr.json')) return; // binary-ish, skip always
    const ext = node.name.split('.').pop()?.toLowerCase() ?? '';
    if (INDEX_EXTS.has(ext)) paths.push(node.path);
  }
  nodes.forEach(walk);
  return paths;
}

// ── Build / refresh ───────────────────────────────────────────────────────────

/**
 * Build or incrementally refresh the workspace index.
 *
 * Files whose mtime and size match an existing entry are reused without
 * re-reading (cache hit). Only new or modified files incur a disk read.
 *
 * The updated index is saved to `.cafezin/workspace-index.json` and returned.
 */
export async function buildWorkspaceIndex(
  workspacePath: string,
  fileTree: FileTreeNode[],
  existing: WorkspaceIndex | null,
): Promise<WorkspaceIndex> {
  const allFiles = collectIndexableFiles(fileTree).slice(0, MAX_INDEX_FILES);

  const existingMap = new Map<string, WorkspaceIndexEntry>(
    existing?.entries.map((e) => [e.path, e]) ?? [],
  );

  const BATCH = 12;
  const entries: WorkspaceIndexEntry[] = [];

  for (let b = 0; b < allFiles.length; b += BATCH) {
    const batch = allFiles.slice(b, b + BATCH);
    const results = await Promise.all(
      batch.map(async (relPath): Promise<WorkspaceIndexEntry | null> => {
        try {
          const s = await stat(`${workspacePath}/${relPath}`);
          const size = s.size ?? 0;
          // s.mtime is Date | null from Tauri's FileInfo
          const mtime = s.mtime ? (s.mtime as unknown as Date).getTime() : 0;

          const cached = existingMap.get(relPath);
          if (cached && cached.mtime === mtime && cached.size === size) {
            return cached; // cache hit
          }

          if (size > MAX_OUTLINE_SIZE) {
            return { path: relPath, size, mtime, outline: '' };
          }

          const text = await readTextFile(`${workspacePath}/${relPath}`);
          const outline = extractFileOutline(relPath, text);
          return { path: relPath, size, mtime, outline };
        } catch {
          return null;
        }
      }),
    );
    for (const r of results) {
      if (r) entries.push(r);
    }
  }

  const index: WorkspaceIndex = {
    version: INDEX_VERSION,
    builtAt: new Date().toISOString(),
    entries,
  };

  await saveWorkspaceIndex(workspacePath, index);
  return index;
}

// ── Ranking ───────────────────────────────────────────────────────────────────

export interface RankOptions {
  recentFiles?: string[];
  activeFile?: string;
  maxResults?: number;
}

/**
 * Score and sort workspace index entries by relevance to `query`.
 *
 * Scoring factors:
 *   - Active file match:       +200
 *   - Recent file (decaying):  +100 − 15 × rank
 *   - Query token in path:     +15 per token
 *   - Query token in outline:  +10 per token
 *   - Outline richness:        up to +20
 *
 * When `query` is empty, returns entries without query scoring (sorted by
 * recency and active-file boost only).
 */
export function rankWorkspaceIndex(
  index: WorkspaceIndex,
  query: string,
  opts: RankOptions = {},
): WorkspaceIndexEntry[] {
  const { recentFiles = [], activeFile, maxResults = 10 } = opts;

  const queryTokens = query
    .toLowerCase()
    .split(/[\s\-_./\\]+/)
    .filter((t) => t.length > 1);

  const scored = index.entries.map((entry) => {
    let score = 0;
    let hasQueryMatch = false;

    if (activeFile && entry.path === activeFile) score += 200;

    const recIdx = recentFiles.indexOf(entry.path);
    if (recIdx !== -1) score += Math.max(0, 100 - recIdx * 15);

    if (queryTokens.length > 0) {
      const pathLower = entry.path.toLowerCase();
      const outlineLower = entry.outline.toLowerCase();
      for (const token of queryTokens) {
        if (pathLower.includes(token)) { score += 15; hasQueryMatch = true; }
        if (outlineLower.includes(token)) { score += 10; hasQueryMatch = true; }
      }
    }

    // Richer outlines are more informative — slight preference
    const outlineLines = entry.outline.split('\n').filter(Boolean).length;
    score += Math.min(outlineLines * 2, 20);

    return { entry, score, hasQueryMatch };
  });

  return scored
    .filter((s) => queryTokens.length === 0 || s.hasQueryMatch)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((s) => s.entry);
}
