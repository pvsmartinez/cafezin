import { exists, mkdir, readTextFile, stat, writeTextFile } from './fs';
import { safeResolvePath } from '../utils/tools/shared';

export type MemoryEntryKind = 'durable' | 'derived';
export type MemoryEntryStatus = 'fresh' | 'needs_review' | 'verified' | 'archived';

export interface MemorySourceRef {
  path: string;
  mtimeMs: number | null;
  size: number | null;
}

export interface MemoryMetadataEntry {
  id: string;
  heading: string;
  content: string;
  kind: MemoryEntryKind;
  status: MemoryEntryStatus;
  sourceRefs: MemorySourceRef[];
  createdAt: string;
  updatedAt: string;
  staleReason?: string;
}

interface MemoryMetadataFile {
  version: 1;
  updatedAt: string;
  entries: MemoryMetadataEntry[];
}

interface ParsedMemoryEntry {
  heading: string;
  content: string;
}

interface MemoryPaths {
  markdownPath: string;
  metadataPath: string;
}

const MEMORY_META_VERSION = 1;
const REVIEW_PREVIEW_LIMIT = 4;
const DEFAULT_WORKSPACE_HEADING = 'Notes';

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function normalizeWorkspaceRelativePath(workspacePath: string, filePath: string): string | null {
  const normalizedWorkspace = normalizePath(workspacePath);
  let normalized = normalizePath(filePath.trim());
  if (!normalized) return null;
  if (normalized === normalizedWorkspace) return null;
  if (normalized.startsWith('/') && !normalized.startsWith(`${normalizedWorkspace}/`)) return null;
  if (normalized.startsWith(`${normalizedWorkspace}/`)) {
    normalized = normalized.slice(normalizedWorkspace.length + 1);
  }
  normalized = normalized.replace(/^\.?\//, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../')) return null;
  return normalized;
}

function isTrackableWorkspaceSource(path: string): boolean {
  if (!path) return false;
  const [topLevel] = normalizePath(path).split('/');
  return topLevel !== '.cafezin' && topLevel !== '.git';
}

function buildEntryKey(heading: string, content: string): string {
  return `${heading}\u0000${content}`;
}

function createEntryId(): string {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function truncate(value: string, max = 140): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function emptyMetadata(): MemoryMetadataFile {
  return {
    version: MEMORY_META_VERSION,
    updatedAt: new Date().toISOString(),
    entries: [],
  };
}

function parseMemoryMarkdown(markdown: string): ParsedMemoryEntry[] {
  const entries: ParsedMemoryEntry[] = [];
  let currentHeading = DEFAULT_WORKSPACE_HEADING;

  for (const rawLine of markdown.split('\n')) {
    const headingMatch = rawLine.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      currentHeading = headingMatch[1].trim() || DEFAULT_WORKSPACE_HEADING;
      continue;
    }

    const bulletMatch = rawLine.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (bulletMatch) {
      const content = bulletMatch[1].trim();
      if (!content) continue;
      entries.push({ heading: currentHeading, content });
    }
  }

  return entries;
}

async function ensureParentDir(path: string): Promise<void> {
  const dir = path.split('/').slice(0, -1).join('/');
  if (!dir) return;
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }
}

async function readMetadata(metadataPath: string): Promise<MemoryMetadataFile> {
  if (!(await exists(metadataPath))) return emptyMetadata();

  try {
    const raw = await readTextFile(metadataPath);
    const parsed = JSON.parse(raw) as Partial<MemoryMetadataFile> | null;
    if (!parsed || !Array.isArray(parsed.entries)) return emptyMetadata();
    return {
      version: MEMORY_META_VERSION,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      entries: parsed.entries
        .filter((entry): entry is MemoryMetadataEntry => !!entry && typeof entry.content === 'string' && typeof entry.heading === 'string')
        .map((entry) => ({
          id: typeof entry.id === 'string' ? entry.id : createEntryId(),
          heading: entry.heading,
          content: entry.content,
          kind: entry.kind === 'derived' ? 'derived' : 'durable',
          status: entry.status === 'needs_review' || entry.status === 'verified' || entry.status === 'archived'
            ? entry.status
            : 'fresh',
          sourceRefs: Array.isArray(entry.sourceRefs)
            ? entry.sourceRefs
              .filter((ref): ref is MemorySourceRef => !!ref && typeof ref.path === 'string')
              .map((ref) => ({
                path: normalizePath(ref.path),
                mtimeMs: typeof ref.mtimeMs === 'number' ? ref.mtimeMs : null,
                size: typeof ref.size === 'number' ? ref.size : null,
              }))
              .filter((ref) => isTrackableWorkspaceSource(ref.path))
            : [],
          createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
          updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString(),
          ...(typeof entry.staleReason === 'string' && entry.staleReason.trim() ? { staleReason: entry.staleReason.trim() } : {}),
        })),
    };
  } catch {
    return emptyMetadata();
  }
}

async function writeMetadata(metadataPath: string, metadata: MemoryMetadataFile): Promise<void> {
  await ensureParentDir(metadataPath);
  await writeTextFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
}

async function syncMetadataToMarkdown(
  metadataPath: string,
  markdown: string,
): Promise<MemoryMetadataFile> {
  const parsedEntries = parseMemoryMarkdown(markdown);
  const existing = await readMetadata(metadataPath);
  const now = new Date().toISOString();
  const buckets = new Map<string, MemoryMetadataEntry[]>();

  for (const entry of existing.entries) {
    const key = buildEntryKey(entry.heading, entry.content);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry);
    else buckets.set(key, [entry]);
  }

  const nextEntries = parsedEntries.map((entry) => {
    const key = buildEntryKey(entry.heading, entry.content);
    const bucket = buckets.get(key);
    const reused = bucket?.shift();
    if (reused) {
      return {
        ...reused,
        heading: entry.heading,
        content: entry.content,
      };
    }
    return {
      id: createEntryId(),
      heading: entry.heading,
      content: entry.content,
      kind: 'durable' as const,
      status: 'fresh' as const,
      sourceRefs: [],
      createdAt: now,
      updatedAt: now,
    };
  });

  const nextMetadata: MemoryMetadataFile = {
    version: MEMORY_META_VERSION,
    updatedAt: now,
    entries: nextEntries,
  };

  const previousSerialized = JSON.stringify(existing);
  const nextSerialized = JSON.stringify(nextMetadata);
  if (previousSerialized !== nextSerialized) {
    await writeMetadata(metadataPath, nextMetadata);
  }

  return nextMetadata;
}

async function captureWorkspaceSourceRefs(
  workspacePath: string,
  sourceFiles: string[],
): Promise<MemorySourceRef[]> {
  const refs = await Promise.all(sourceFiles.map(async (filePath) => {
    const relPath = normalizeWorkspaceRelativePath(workspacePath, filePath);
    if (!relPath || !isTrackableWorkspaceSource(relPath)) return null;

    try {
      const absPath = safeResolvePath(workspacePath, relPath);
      const info = await stat(absPath);
      return {
        path: relPath,
        mtimeMs: info.mtime ? (info.mtime as unknown as Date).getTime() : null,
        size: info.size ?? null,
      } satisfies MemorySourceRef;
    } catch {
      return {
        path: relPath,
        mtimeMs: null,
        size: null,
      } satisfies MemorySourceRef;
    }
  }));

  const deduped = new Map<string, MemorySourceRef>();
  for (const ref of refs) {
    if (!ref) continue;
    deduped.set(ref.path, ref);
  }
  return Array.from(deduped.values());
}

function buildStatusSummary(entries: MemoryMetadataEntry[]): string {
  const staleEntries = entries.filter((entry) => entry.status === 'needs_review');
  if (staleEntries.length === 0) return '';

  const lines = [
    `Memory review status: ${staleEntries.length} entr${staleEntries.length === 1 ? 'y needs' : 'ies need'} review because linked source files changed.`,
    ...staleEntries.slice(0, REVIEW_PREVIEW_LIMIT).map((entry) => {
      const sourceLabel = entry.sourceRefs.length > 0
        ? ` (${entry.sourceRefs.map((ref) => ref.path).join(', ')})`
        : '';
      return `- [${entry.heading}] ${truncate(entry.content)}${sourceLabel}`;
    }),
  ];

  if (staleEntries.length > REVIEW_PREVIEW_LIMIT) {
    lines.push(`- +${staleEntries.length - REVIEW_PREVIEW_LIMIT} more entries are marked needs_review.`);
  }

  lines.push('Treat those entries as suspect until the source files are re-read and the memory is updated.');
  return lines.join('\n');
}

function getWorkspaceMemoryPaths(workspacePath: string): MemoryPaths {
  return {
    markdownPath: `${workspacePath}/.cafezin/memory.md`,
    metadataPath: `${workspacePath}/.cafezin/memory.meta.json`,
  };
}

export function getUserProfileMemoryPaths(homePath: string): MemoryPaths {
  const base = homePath.replace(/\/$/, '');
  return {
    markdownPath: `${base}/.cafezin/user-profile.md`,
    metadataPath: `${base}/.cafezin/user-profile.meta.json`,
  };
}

export async function buildWorkspaceMemoryPromptText(
  workspacePath: string,
  markdownOverride?: string,
): Promise<string> {
  const { markdownPath } = getWorkspaceMemoryPaths(workspacePath);
  const markdown = typeof markdownOverride === 'string'
    ? markdownOverride
    : await readTextFile(markdownPath).catch(() => '');
  if (!markdown.trim()) return '';

  const refreshed = await refreshWorkspaceMemoryMetadata(workspacePath, markdown);
  const summary = buildStatusSummary(refreshed.entries);
  return summary ? `${summary}\n\n${markdown}` : markdown;
}

export async function syncMemoryMetadataWithMarkdown(
  metadataPath: string,
  markdown: string,
): Promise<MemoryMetadataFile> {
  return syncMetadataToMarkdown(metadataPath, markdown);
}

export async function updateMemoryMetadataEntry(params: {
  metadataPath: string;
  markdown: string;
  heading: string;
  content: string;
  kind: MemoryEntryKind;
  sourceRefs?: MemorySourceRef[];
}): Promise<void> {
  const metadata = await syncMetadataToMarkdown(params.metadataPath, params.markdown);
  const target = [...metadata.entries].reverse().find((entry) =>
    entry.heading === params.heading && entry.content === params.content,
  );
  if (!target) return;

  target.kind = params.kind;
  target.status = 'fresh';
  target.updatedAt = new Date().toISOString();
  delete target.staleReason;
  target.sourceRefs = (params.sourceRefs ?? []).filter((ref) => isTrackableWorkspaceSource(ref.path));
  metadata.updatedAt = target.updatedAt;
  await writeMetadata(params.metadataPath, metadata);
}

export async function buildWorkspaceSourceRefs(
  workspacePath: string,
  sourceFiles: string[],
): Promise<MemorySourceRef[]> {
  return captureWorkspaceSourceRefs(workspacePath, sourceFiles);
}

export async function refreshWorkspaceMemoryMetadata(
  workspacePath: string,
  markdownOverride?: string,
): Promise<MemoryMetadataFile> {
  const { markdownPath, metadataPath } = getWorkspaceMemoryPaths(workspacePath);
  const markdown = typeof markdownOverride === 'string'
    ? markdownOverride
    : await readTextFile(markdownPath).catch(() => '');

  const metadata = await syncMetadataToMarkdown(metadataPath, markdown);
  let changed = false;
  const now = new Date().toISOString();

  await Promise.all(metadata.entries.map(async (entry) => {
    if (entry.status === 'needs_review' || entry.sourceRefs.length === 0) return;

    for (const ref of entry.sourceRefs) {
      if (!isTrackableWorkspaceSource(ref.path)) continue;
      try {
        const absPath = safeResolvePath(workspacePath, ref.path);
        const info = await stat(absPath);
        const currentMtime = info.mtime ? (info.mtime as unknown as Date).getTime() : null;
        const currentSize = info.size ?? null;
        if (currentMtime !== ref.mtimeMs || currentSize !== ref.size) {
          entry.status = 'needs_review';
          entry.staleReason = `Source file changed: ${ref.path}`;
          entry.updatedAt = now;
          changed = true;
          break;
        }
      } catch {
        entry.status = 'needs_review';
        entry.staleReason = `Source file changed: ${ref.path}`;
        entry.updatedAt = now;
        changed = true;
        break;
      }
    }
  }));

  if (changed) {
    metadata.updatedAt = now;
    await writeMetadata(metadataPath, metadata);
  }

  return metadata;
}

export async function markWorkspaceMemoryEntriesStale(
  workspacePath: string,
  changedPaths: string[],
): Promise<number> {
  const normalizedChanges = new Set(
    changedPaths
      .map((path) => normalizeWorkspaceRelativePath(workspacePath, path))
      .filter((path): path is string => !!path && isTrackableWorkspaceSource(path)),
  );

  if (normalizedChanges.size === 0) return 0;

  const { markdownPath, metadataPath } = getWorkspaceMemoryPaths(workspacePath);
  const markdown = await readTextFile(markdownPath).catch(() => '');
  if (!markdown.trim()) return 0;

  const metadata = await syncMetadataToMarkdown(metadataPath, markdown);
  let markedCount = 0;
  const now = new Date().toISOString();

  for (const entry of metadata.entries) {
    const hit = entry.sourceRefs.some((ref) =>
      Array.from(normalizedChanges).some((changedPath) =>
        ref.path === changedPath || ref.path.startsWith(`${changedPath}/`),
      ),
    );
    if (!hit || entry.status === 'needs_review') continue;
    entry.status = 'needs_review';
    entry.staleReason = 'Source file changed since this memory was recorded.';
    entry.updatedAt = now;
    markedCount += 1;
  }

  if (markedCount > 0) {
    metadata.updatedAt = now;
    await writeMetadata(metadataPath, metadata);
  }

  return markedCount;
}
