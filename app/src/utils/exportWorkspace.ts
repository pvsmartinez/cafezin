/**
 * exportWorkspace — core engine for workspace Build/Export targets.
 *
 * Supports 2 formats without system dependencies (pure JS):
 *   pdf         → markdown → PDF  (jsPDF + html2canvas, via exportMarkdownToPDF)
 *                 With merge:true → all matched files become one PDF
 *   zip         → bundle matching files into a .zip  (JSZip, includes binary files)
 *
 * Legacy formats ('custom' shell command, 'git-publish', canvas exports) are
 * no longer executed — they return a clear unsupported error without running
 * any command or rewriting the stored target config.
 *
 * File selection: includeFiles (pinned list) > include extensions, minus excludeFiles.
 */

import { readTextFile, writeFile, mkdir, exists, readDir, readFile as readBinaryFile } from '../services/fs';
// NOTE: jsPDF / JSZip / exportPDF are intentionally NOT imported at module
// level — they are loaded lazily inside the targets that use them so the
// ~700 kB export stack never blocks app startup. Type-only imports are free.
import type {
  ExportTarget,
  WorkspaceConfig,
} from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExportResult {
  targetId: string;
  /** Relative paths of files that were produced */
  outputs: string[];
  errors: string[];
  /** Optional success summary for targets that do not produce files, e.g. git publish. */
  summary?: string;
  /** ms elapsed */
  elapsed: number;
}

export interface ExportProgressInfo {
  done: number;
  total: number;
  label: string;
  phase: string;
  detail?: string;
}

export class ExportCancelledError extends Error {
  constructor(message = 'Export canceled by user.') {
    super(message);
    this.name = 'ExportCancelledError';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function basename(relPath: string): string {
  return relPath.split('/').pop() ?? relPath;
}

function stripExt(filename: string): string {
  const dotIdx = filename.lastIndexOf('.');
  return dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
}

function throwIfCancelled(opts?: Pick<RunExportOptions, 'shouldCancel'>): void {
  if (opts?.shouldCancel?.()) {
    throw new ExportCancelledError();
  }
}

async function yieldToUI(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}

function reportProgress(
  opts: Pick<RunExportOptions, 'onProgress'> | undefined,
  progress: ExportProgressInfo,
): void {
  opts?.onProgress?.(progress);
}

/** List all workspace files (flat), skipping hidden/generated dirs */
export async function listAllFiles(wsPath: string, rel = ''): Promise<string[]> {
  const SKIP = new Set(['.git', '.cafezin', 'node_modules', '.DS_Store']);
  let entries;
  try { entries = await readDir(`${wsPath}${rel ? `/${rel}` : ''}`); } catch { return []; }
  if (!Array.isArray(entries)) return [];
  const files: string[] = [];
  for (const e of entries) {
    if (!e.name || SKIP.has(e.name)) continue;
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory) files.push(...await listAllFiles(wsPath, relPath));
    else files.push(relPath);
  }
  return files;
}
/**
 * Resolve which workspace files a target should act on.
 * Priority: includeFiles (explicit pinned list) > include extensions
 * Always applies excludeFiles filter afterward.
 */
export function resolveFiles(allFiles: string[], target: ExportTarget): string[] {
  let pool: string[];

  if (target.includeFiles && target.includeFiles.length > 0) {
    const ws = new Set(allFiles);
    pool = target.includeFiles.filter((f) => ws.has(f));
  } else if (target.include.length > 0) {
    pool = allFiles.filter((f) => {
      const lower = f.toLowerCase();
      return target.include.some((ext) => lower.endsWith(`.${ext.toLowerCase()}`));
    });
  } else {
    pool = [...allFiles];
  }

  if (target.excludeFiles && target.excludeFiles.length > 0) {
    const excl = new Set(target.excludeFiles);
    pool = pool.filter((f) => !excl.has(f));
  }
  return pool;
}

/** Ensure output directory exists */
async function ensureDir(absDir: string) {
  if (!(await exists(absDir))) await mkdir(absDir, { recursive: true });
}

/** Strip trailing `.json` from `.tldr.json` → `.tldr` then strip that too */
function preProcessMarkdown(
  content: string,
  opts: ExportTarget['preProcess'],
): string {
  if (!opts) return content;
  let out = content;

  if (opts.stripFrontmatter) {
    // Must be at the very start of the file (no `m` flag so ^ = start of string).
    // Handles \r\n and plain \n line endings.
    out = out.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  }

  if (opts.stripDetails) {
    // Remove <details>…</details> HTML blocks (greedy across newlines)
    out = out.replace(/<details[\s\S]*?<\/details>/gi, '');
  }

  if (opts.stripDraftSections) {
    // Line-by-line approach — reliable, avoids \Z (not valid in JS)
    const lines = out.split('\n');
    const kept: string[] = [];
    let inDraft = false;
    for (const line of lines) {
      if (/^### Draft\b/.test(line)) { inDraft = true; continue; }
      // Any heading at the same or higher level ends the draft section
      if (inDraft && /^#{1,3}\s/.test(line)) inDraft = false;
      if (!inDraft) kept.push(line);
    }
    out = kept.join('\n');
  }

  return out.trim();
}

/** Build a styled HTML title page string. */
function buildTitlePageHtml(tp: NonNullable<ExportTarget['titlePage']>): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts: string[] = ['<div class="title-page">'];
  if (tp.title)    parts.push(`<div class="tp-title">${escape(tp.title)}</div>`);
  if (tp.subtitle) parts.push(`<div class="tp-subtitle">${escape(tp.subtitle)}</div>`);
  if (tp.author)   parts.push(`<div class="tp-author">${escape(tp.author)}</div>`);
  if (tp.version)  parts.push(`<div class="tp-version">${escape(tp.version)}</div>`);
  parts.push('</div>');
  return parts.join('\n');
}

/** Extract headings from markdown and build an HTML TOC.
 *  Skips headings that appear inside fenced code blocks (``` or ~~~). */
function buildTocHtml(content: string): string {
  const lines = content.split('\n');
  const items: string[] = [];
  let inFence = false;
  for (const line of lines) {
    // Toggle fence state on opening/closing ``` or ~~~
    if (/^\s*(`{3,}|~{3,})/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h1 = line.match(/^# (.+)/);
    const h2 = line.match(/^## (.+)/);
    const heading = h1 ?? h2;
    if (!heading) continue;
    const level = h1 ? 'h1' : 'h2';
    // Strip inline markdown (bold, italic, code, links) from heading text
    const raw = heading[1]
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .trim();
    const text = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    items.push(`<li class="toc-${level}">${text}</li>`);
  }
  if (items.length === 0) return '';
  return [
    '<div class="toc-page">',
    '<h2 class="toc-heading">Table of Contents</h2>',
    '<ul class="toc-list">',
    ...items,
    '</ul>',
    '</div>',
  ].join('\n');
}

/**
 * Return the output path, applying versioning when requested.
 * - 'timestamp' → appends _YYYY-MM-DD before the extension
 * - 'counter'   → appends _v1, _v2 … scanning existing files
 */
async function versionedPath(
  wsPath: string,
  outputDir: string,
  baseName: string,
  ext: string,
  mode: ExportTarget['versionOutput'],
): Promise<string> {
  if (!mode) return `${outputDir}/${baseName}.${ext}`;

  if (mode === 'timestamp') {
    const today = new Date().toISOString().slice(0, 10);
    return `${outputDir}/${baseName}_${today}.${ext}`;
  }

  // counter mode: find the first unused _vN
  let n = 1;
  while (await exists(`${wsPath}/${outputDir}/${baseName}_v${n}.${ext}`)) n++;
  return `${outputDir}/${baseName}_v${n}.${ext}`;
}

async function exportPDF(
  wsPath: string,
  files: string[],
  target: ExportTarget,
  workspaceConfig?: WorkspaceConfig,
  opts?: RunExportOptions,
): Promise<ExportResult> {
  const t0 = Date.now();
  const outputs: string[] = [];
  const errors: string[] = [];
  const absOutDir = `${wsPath}/${target.outputDir}`;
  await ensureDir(absOutDir);
  throwIfCancelled(opts);

  if (files.length === 0) {
    return { targetId: target.id, outputs: [], errors: ['No files matched this target. Check the include extensions or pinned file list.'], elapsed: Date.now() - t0 };
  }

  // Lazy — keeps jspdf/html2canvas out of the startup bundle.
  const { exportMarkdownToPDF } = await import('./exportPDF');

  // ── Load optional custom CSS ──────────────────────────────────────────────
  let customCss: string | undefined;
  if (target.pdfCssFile?.trim()) {
    try { customCss = await readTextFile(`${wsPath}/${target.pdfCssFile.trim()}`); }
    catch (e) { errors.push(`CSS file "${target.pdfCssFile}" not found — using default styles. (${e})`); }
  }

  // ── Build optional prepend HTML (title page + TOC) ───────────────────────
  // toc is supported for both merged and single-file exports.
  function buildPrependHtml(markdown: string): string {
    let html = '';
    if (target.titlePage && Object.values(target.titlePage).some(Boolean)) {
      html += buildTitlePageHtml(target.titlePage);
    }
    if (target.toc) {
      const tocHtml = buildTocHtml(markdown);
      if (tocHtml) html += '\n' + tocHtml;
    }
    return html;
  }

  if (target.merge && files.length >= 1) {
    // ── Merge: concatenate all markdown into one PDF ──────────────────────
    const parts: string[] = [];
    for (let index = 0; index < files.length; index++) {
      throwIfCancelled(opts);
      const rel = files[index];
      reportProgress(opts, {
        done: index,
        total: files.length,
        label: rel,
        phase: 'read-source',
        detail: `Loading ${rel}…`,
      });
      try {
        const raw = await readTextFile(`${wsPath}/${rel}`);
        parts.push(preProcessMarkdown(raw, target.preProcess));
      } catch (e) { errors.push(`${rel}: ${e}`); }
      await yieldToUI();
    }
    if (parts.length > 0) {
      // Join chapters with double newlines. Chapter-level headings (# H1)
      // provide natural visual separation in the rendered PDF.
      const merged = parts.join('\n\n');
      const name = target.mergeName?.trim() || 'merged';
      const outRel = await versionedPath(wsPath, target.outputDir, name, 'pdf', target.versionOutput);
      try {
        reportProgress(opts, {
          done: files.length,
          total: files.length,
          label: outRel,
          phase: 'render-pdf',
          detail: `Rendering merged PDF (${files.length} file${files.length === 1 ? '' : 's'})…`,
        });
        await exportMarkdownToPDF(merged, `${wsPath}/${outRel}`, wsPath, {
          customCss,
          features: workspaceConfig?.features,
          prependHtml: buildPrependHtml(merged),
          hooks: {
            shouldCancel: opts?.shouldCancel,
            onProgress: (phase, detail) => {
              reportProgress(opts, {
                done: files.length,
                total: files.length,
                label: outRel,
                phase,
                detail,
              });
            },
          },
        });
        outputs.push(outRel);
      } catch (e) { errors.push(`merge: ${e}`); }
    }
  } else {
    // ── One PDF per file ──────────────────────────────────────────────────
    for (let index = 0; index < files.length; index++) {
      throwIfCancelled(opts);
      const rel = files[index];
      const baseName = stripExt(basename(rel));
      const outRel = await versionedPath(wsPath, target.outputDir, baseName, 'pdf', target.versionOutput);
      try {
        reportProgress(opts, {
          done: index,
          total: files.length,
          label: rel,
          phase: 'read-source',
          detail: `Loading ${rel}…`,
        });
        const raw = await readTextFile(`${wsPath}/${rel}`);
        const content = preProcessMarkdown(raw, target.preProcess);
        reportProgress(opts, {
          done: index,
          total: files.length,
          label: rel,
          phase: 'render-pdf',
          detail: `Rendering ${rel}…`,
        });
        await exportMarkdownToPDF(content, `${wsPath}/${outRel}`, wsPath, {
          customCss,
          features: workspaceConfig?.features,
          prependHtml: buildPrependHtml(content),
          hooks: {
            shouldCancel: opts?.shouldCancel,
            onProgress: (phase, detail) => {
              reportProgress(opts, {
                done: index,
                total: files.length,
                label: rel,
                phase,
                detail,
              });
            },
          },
        });
        outputs.push(outRel);
      } catch (e) { errors.push(`${rel}: ${e}`); }
      reportProgress(opts, {
        done: index + 1,
        total: files.length,
        label: rel,
        phase: 'done-file',
        detail: `${rel} finished.`,
      });
      await yieldToUI();
    }
  }
  return { targetId: target.id, outputs, errors, elapsed: Date.now() - t0 };
}

async function exportZip(
  wsPath: string,
  files: string[],
  target: ExportTarget,
  opts?: RunExportOptions,
): Promise<ExportResult> {
  const t0 = Date.now();
  const errors: string[] = [];
  const absOutDir = `${wsPath}/${target.outputDir}`;
  await ensureDir(absOutDir);
  throwIfCancelled(opts);

  if (files.length === 0) {
    return { targetId: target.id, outputs: [], errors: ['No files matched this target. Check the include extensions or pinned file list.'], elapsed: Date.now() - t0 };
  }

  // Lazy — JSZip only loads when a zip target actually runs.
  const { default: JSZip } = await import('jszip');

  const zip = new JSZip();
  let addedCount = 0;
  for (let index = 0; index < files.length; index++) {
    throwIfCancelled(opts);
    const rel = files[index];
    reportProgress(opts, {
      done: index,
      total: files.length,
      label: rel,
      phase: 'zip-add',
      detail: `Adding ${rel} to zip…`,
    });
    try {
      // Binary read so images/fonts/PDFs are included correctly
      const bytes = await readBinaryFile(`${wsPath}/${rel}`);
      zip.file(rel, bytes);
      addedCount++;
    } catch (e) {
      errors.push(`${rel}: ${e}`);
    }
    await yieldToUI();
  }

  if (addedCount === 0) {
    return { targetId: target.id, outputs: [], errors, elapsed: Date.now() - t0 };
  }

  const zipName = target.mergeName?.trim() || 'export';
  const outRel = `${target.outputDir}/${zipName}.zip`;
  reportProgress(opts, {
    done: files.length,
    total: files.length,
    label: outRel,
    phase: 'zip-generate',
    detail: 'Compressing zip…',
  });
  const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  throwIfCancelled(opts);
  reportProgress(opts, {
    done: files.length,
    total: files.length,
    label: outRel,
    phase: 'write-file',
    detail: `Writing ${outRel}…`,
  });
  await writeFile(`${wsPath}/${outRel}`, zipBytes);
  return { targetId: target.id, outputs: [outRel], errors, elapsed: Date.now() - t0 };
}

// ── Public entry point ────────────────────────────────────────────────────────

export interface RunExportOptions {
  workspacePath: string;
  target: ExportTarget;
  workspaceConfig?: WorkspaceConfig;
  /**
   * Progress callback fired throughout the export pipeline.
   */
  onProgress?: (progress: ExportProgressInfo) => void;
  /** Cooperative cancellation hook checked between expensive steps. */
  shouldCancel?: () => boolean;
}

export async function runExportTarget(opts: RunExportOptions): Promise<ExportResult> {
  const { workspacePath, target, workspaceConfig } = opts;
  throwIfCancelled(opts);
  reportProgress(opts, {
    done: 0,
    total: 1,
    label: target.name,
    phase: 'scan-files',
    detail: 'Scanning workspace files…',
  });
  const allFiles = await listAllFiles(workspacePath);
  const matched  = resolveFiles(allFiles, target);
  reportProgress(opts, {
    done: 0,
    total: Math.max(1, matched.length),
    label: target.name,
    phase: 'resolve-files',
    detail: matched.length === 0
      ? 'No files matched this target.'
      : `${matched.length} file${matched.length === 1 ? '' : 's'} matched.`,
  });
  await yieldToUI();

  switch (target.format) {
    case 'pdf':
      return exportPDF(workspacePath, matched, target, workspaceConfig, opts);
    case 'zip':
      return exportZip(workspacePath, matched, target, opts);
    case 'git-publish':
    case 'custom':
      // Legacy shell-backed formats: never executed. Report clearly without
      // touching the stored target config.
      return {
        targetId: target.id,
        outputs: [],
        errors: [
          `Export format "${target.format}" is no longer supported (it required shell command execution). ` +
          'The target config was kept untouched — edit or remove it in Export Settings. ' +
          'Supported formats: pdf, zip.',
        ],
        elapsed: 0,
      };
    default: {
      const format = (target as ExportTarget).format;
      const LEGACY_FORMATS = new Set(['canvas-png', 'canvas-pdf']);
      if (LEGACY_FORMATS.has(format)) {
        return {
          targetId: target.id,
          outputs: [],
          errors: [
            `Export format "${format}" is no longer supported (canvas export was removed). ` +
            'The target config was kept untouched — edit or remove it in Export Settings. ' +
            'Supported formats: pdf, zip.',
          ],
          elapsed: 0,
        };
      }
      return { targetId: target.id, outputs: [], errors: [`Unknown format: ${format}`], elapsed: 0 };
    }
  }
}
