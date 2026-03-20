/**
 * exportWorkspace — core engine for workspace Build/Export targets.
 *
 * Supports 5 formats without system dependencies (pure JS except 'custom'):
 *   pdf         → markdown → PDF  (jsPDF + html2canvas, via exportMarkdownToPDF)
 *                 With merge:true → all matched files become one PDF
 *   canvas-png  → tldraw canvas → PNG per slide/frame (auto-opens canvas if needed)
 *   canvas-pdf  → tldraw canvas → multi-page PDF; merge:true → all canvases in one PDF
 *   zip         → bundle matching files into a .zip  (JSZip, includes binary files)
 *   custom      → run a shell command (desktop only, via Tauri shell_run)
 *
 * File selection: includeFiles (pinned list) > include extensions, minus excludeFiles.
 * Canvas auto-open: pass onOpenFileForExport + onRestoreAfterExport to unlock.
 */

import { readTextFile, writeFile, mkdir, exists, readDir, readFile as readBinaryFile } from '../services/fs';
import { invoke } from '@tauri-apps/api/core';
import jsPDF from 'jspdf';
import JSZip from 'jszip';
import { exportMarkdownToPDF } from './exportPDF';
import type { ExportTarget, WorkspaceConfig } from '../types';
import type { Editor, TLShape } from 'tldraw';

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

/**
 * Decode a data URL directly to bytes without using `fetch()`.
 * More reliable than fetch(dataUrl).arrayBuffer() in WebKit sandboxes.
 */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) throw new Error('Invalid data URL — missing comma separator');
  const base64 = dataUrl.slice(comma + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

type AnyFrame = TLShape & {
  x: number; y: number;
  props: { w: number; h: number; name: string };
};

function basename(relPath: string): string {
  return relPath.split('/').pop() ?? relPath;
}

function stripExt(filename: string): string {
  const dotIdx = filename.lastIndexOf('.');
  return dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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

function renderGitTemplate(template: string, target: ExportTarget, wsPath: string): string {
  const now = new Date();
  const workspaceName = wsPath.split('/').filter(Boolean).pop() ?? 'workspace';
  const replacements: Record<string, string> = {
    workspace: workspaceName,
    target: target.name,
    date: now.toISOString().slice(0, 10),
    datetime: now.toISOString().slice(0, 19).replace('T', ' '),
  };
  return template.replace(/\{\{(workspace|target|date|datetime)\}\}/g, (_, key: string) => replacements[key] ?? '');
}

async function runShellCommand(
  wsPath: string,
  cmd: string,
): Promise<{ stdout: string; stderr: string; exit_code: number }> {
  return invoke<{ stdout: string; stderr: string; exit_code: number }>('shell_run', {
    cmd,
    cwd: wsPath,
  });
}

async function runShellCommandCancelable(
  wsPath: string,
  cmd: string,
  opts?: Pick<RunExportOptions, 'shouldCancel'>,
): Promise<{ stdout: string; stderr: string; exit_code: number }> {
  const started = await invoke<{ id: string }>('shell_run_start', {
    cmd,
    cwd: wsPath,
  });

  let cancelSent = false;

  while (true) {
    if (opts?.shouldCancel?.()) {
      if (!cancelSent) {
        cancelSent = true;
        await invoke('shell_run_kill', { id: started.id }).catch(() => null);
      }
      throw new ExportCancelledError();
    }

    const status = await invoke<{
      running: boolean;
      stdout: string;
      stderr: string;
      exit_code: number | null;
    }>('shell_run_status', { id: started.id });

    if (!status.running) {
      return {
        stdout: status.stdout,
        stderr: status.stderr,
        exit_code: status.exit_code ?? -1,
      };
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
}

/** Strip trailing `.json` from `.tldr.json` → `.tldr` then strip that too */
function canvasBasename(relPath: string): string {
  return stripExt(stripExt(basename(relPath)));
}

/** List all workspace files (flat), skipping hidden/generated dirs */
export async function listAllFiles(wsPath: string, rel = ''): Promise<string[]> {
  const SKIP = new Set(['.git', '.cafezin', 'node_modules', '.DS_Store']);
  let entries;
  try { entries = await readDir(`${wsPath}${rel ? `/${rel}` : ''}`); } catch { return []; }
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

// ── Pre-processing helpers ────────────────────────────────────────────────────

/** Apply markdown transformations before rendering to PDF. */
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

async function exportCanvasPNG(
  wsPath: string,
  files: string[],
  target: ExportTarget,
  opts: RunExportOptions,
): Promise<ExportResult> {
  const t0 = Date.now();
  const outputs: string[] = [];
  const errors: string[] = [];
  const absOutDir = `${wsPath}/${target.outputDir}`;
  await ensureDir(absOutDir);
  throwIfCancelled(opts);

  const liveEditor = () => opts.canvasEditorRef?.current ?? opts.canvasEditor ?? null;

  if (files.length === 0) {
    return { targetId: target.id, outputs: [], errors: ['No canvas files matched this target. Check the include extensions or pinned file list.'], elapsed: Date.now() - t0 };
  }

  for (let fi = 0; fi < files.length; fi++) {
    throwIfCancelled(opts);
    const rel = files[fi];
    let opened = false;
    if (rel !== opts.activeCanvasRel || !liveEditor()) {
      if (opts.onOpenFileForExport) {
        reportProgress(opts, {
          done: fi,
          total: files.length,
          label: rel,
          phase: 'open-canvas',
          detail: `Opening ${rel}…`,
        });
        try { await opts.onOpenFileForExport(rel); opened = true; }
        catch (e) {
          errors.push(`${rel}: could not open canvas — ${e}`);
          reportProgress(opts, {
            done: fi + 1,
            total: files.length,
            label: rel,
            phase: 'error',
            detail: `Could not open ${rel}.`,
          });
          continue;
        }
      } else {
        errors.push(`${rel}: canvas must be open in the editor to export PNG.`);
        reportProgress(opts, {
          done: fi + 1,
          total: files.length,
          label: rel,
          phase: 'error',
          detail: `${rel} must be open before exporting.`,
        });
        continue;
      }
    }
    const editor = liveEditor();
    if (!editor) {
      errors.push(`${rel}: editor not available after open`);
      if (opened) opts.onRestoreAfterExport?.(); // must restore even without entering the try block
      reportProgress(opts, {
        done: fi + 1,
        total: files.length,
        label: rel,
        phase: 'error',
        detail: `${rel} did not finish mounting in time.`,
      });
      continue;
    }
    try {
      reportProgress(opts, {
        done: fi,
        total: files.length,
        label: rel,
        phase: 'inspect-canvas',
        detail: `Inspecting ${rel}…`,
      });
      const shapes = editor.getCurrentPageShapes();
      if (!shapes.length) {
        errors.push(`${rel}: canvas is empty`);
        reportProgress(opts, {
          done: fi + 1,
          total: files.length,
          label: rel,
          phase: 'error',
          detail: `${rel} is empty.`,
        });
        continue;
      }
      const frames = (shapes as AnyFrame[]).filter((s) => s.type === 'frame').sort((a, b) => a.x - b.x);
      const ids = frames.length ? frames.map((f) => f.id) : shapes.map((s) => s.id);

      for (let i = 0; i < ids.length; i++) {
        throwIfCancelled(opts);
        const shapeName = frames.length ? ((frames[i] as AnyFrame).props.name || `slide-${i + 1}`) : 'canvas';
        const suffix = ids.length > 1 ? `-${shapeName.replace(/[^a-z0-9]/gi, '-')}` : '';
        const outRel = `${target.outputDir}/${canvasBasename(rel)}${suffix}.png`;
        reportProgress(opts, {
          done: fi,
          total: files.length,
          label: rel,
          phase: 'export-slide',
          detail: ids.length > 1
            ? `Exporting slide ${i + 1} of ${ids.length} from ${rel}…`
            : `Exporting ${rel}…`,
        });
        const { url } = await editor.toImageDataUrl([ids[i]], { format: 'png', pixelRatio: 2, background: true });
        await writeFile(`${wsPath}/${outRel}`, dataUrlToBytes(url));
        outputs.push(outRel);
        await yieldToUI();
      }
    } catch (e) {
      errors.push(`${rel}: ${e}`);
    } finally {
      if (opened) opts.onRestoreAfterExport?.();
    }
    reportProgress(opts, {
      done: fi + 1,
      total: files.length,
      label: rel,
      phase: 'done-file',
      detail: `${rel} finished.`,
    });
  }
  return { targetId: target.id, outputs, errors, elapsed: Date.now() - t0 };
}

async function exportCanvasPDF(
  wsPath: string,
  files: string[],
  target: ExportTarget,
  opts: RunExportOptions,
): Promise<ExportResult> {
  const t0 = Date.now();
  const outputs: string[] = [];
  const errors: string[] = [];
  const absOutDir = `${wsPath}/${target.outputDir}`;
  await ensureDir(absOutDir);
  throwIfCancelled(opts);

  const liveEditor = () => opts.canvasEditorRef?.current ?? opts.canvasEditor ?? null;
  let mergePdf: jsPDF | null = null;
  const mergedRelPath = `${target.outputDir}/${target.mergeName?.trim() || 'merged'}.pdf`;

  if (files.length === 0) {
    return { targetId: target.id, outputs: [], errors: ['No canvas files matched this target. Check the include extensions or pinned file list.'], elapsed: Date.now() - t0 };
  }

  for (let fi = 0; fi < files.length; fi++) {
    throwIfCancelled(opts);
    const rel = files[fi];
    let opened = false;
    if (rel !== opts.activeCanvasRel || !liveEditor()) {
      if (opts.onOpenFileForExport) {
        reportProgress(opts, {
          done: fi,
          total: files.length,
          label: rel,
          phase: 'open-canvas',
          detail: `Opening ${rel}…`,
        });
        try { await opts.onOpenFileForExport(rel); opened = true; }
        catch (e) {
          errors.push(`${rel}: could not open canvas — ${e}`);
          reportProgress(opts, {
            done: fi + 1,
            total: files.length,
            label: rel,
            phase: 'error',
            detail: `Could not open ${rel}.`,
          });
          continue;
        }
      } else {
        errors.push(`${rel}: canvas must be open in the editor to export.`);
        reportProgress(opts, {
          done: fi + 1,
          total: files.length,
          label: rel,
          phase: 'error',
          detail: `${rel} must be open before exporting.`,
        });
        continue;
      }
    }
    const editor = liveEditor();
    if (!editor) {
      errors.push(`${rel}: editor not available after open`);
      if (opened) opts.onRestoreAfterExport?.(); // must restore even without entering the try block
      reportProgress(opts, {
        done: fi + 1,
        total: files.length,
        label: rel,
        phase: 'error',
        detail: `${rel} did not finish mounting in time.`,
      });
      continue;
    }

    try {
      reportProgress(opts, {
        done: fi,
        total: files.length,
        label: rel,
        phase: 'inspect-canvas',
        detail: `Inspecting ${rel}…`,
      });
      const shapes = editor.getCurrentPageShapes();
      if (!shapes.length) {
        errors.push(`${rel}: canvas is empty`);
        reportProgress(opts, {
          done: fi + 1,
          total: files.length,
          label: rel,
          phase: 'error',
          detail: `${rel} is empty.`,
        });
        continue;
      }
      const frames = (shapes as AnyFrame[]).filter((s) => s.type === 'frame').sort((a, b) => a.x - b.x);
      const slideIds = frames.length ? frames.map((f) => f.id) : [null];
      const allIds   = shapes.map((s) => s.id);
      const fw = frames.length ? frames[0].props.w : 1280;
      const fh = frames.length ? frames[0].props.h : 720;
      const orientation: 'landscape' | 'portrait' = fw >= fh ? 'landscape' : 'portrait';

      if (target.merge) {
        if (!mergePdf) { mergePdf = new jsPDF({ orientation, unit: 'px', format: [fw, fh] }); mergePdf.deletePage(1); }
        for (let slideIndex = 0; slideIndex < slideIds.length; slideIndex++) {
          throwIfCancelled(opts);
          const sid = slideIds[slideIndex];
          reportProgress(opts, {
            done: fi,
            total: files.length,
            label: rel,
            phase: 'export-slide',
            detail: slideIds.length > 1
              ? `Exporting slide ${slideIndex + 1} of ${slideIds.length} from ${rel}…`
              : `Exporting ${rel}…`,
          });
          const { url } = await editor.toImageDataUrl(sid ? [sid] : allIds, { format: 'png', pixelRatio: 2, background: true });
          mergePdf.addPage([fw, fh], orientation);
          mergePdf.addImage(url, 'PNG', 0, 0, fw, fh);
          await yieldToUI();
        }
      } else {
        const pdf = new jsPDF({ orientation, unit: 'px', format: [fw, fh] });
        pdf.deletePage(1);
        for (let slideIndex = 0; slideIndex < slideIds.length; slideIndex++) {
          throwIfCancelled(opts);
          const sid = slideIds[slideIndex];
          reportProgress(opts, {
            done: fi,
            total: files.length,
            label: rel,
            phase: 'export-slide',
            detail: slideIds.length > 1
              ? `Exporting slide ${slideIndex + 1} of ${slideIds.length} from ${rel}…`
              : `Exporting ${rel}…`,
          });
          const { url } = await editor.toImageDataUrl(sid ? [sid] : allIds, { format: 'png', pixelRatio: 2, background: true });
          pdf.addPage([fw, fh], orientation);
          pdf.addImage(url, 'PNG', 0, 0, fw, fh);
          await yieldToUI();
        }
        const outRel = `${target.outputDir}/${canvasBasename(rel)}.pdf`;
        reportProgress(opts, {
          done: fi,
          total: files.length,
          label: rel,
          phase: 'write-file',
          detail: `Writing ${outRel}…`,
        });
        await writeFile(`${wsPath}/${outRel}`, new Uint8Array(pdf.output('arraybuffer') as ArrayBuffer));
        outputs.push(outRel);
      }
    } catch (e) {
      errors.push(`${rel}: ${e}`);
    } finally {
      if (opened) opts.onRestoreAfterExport?.();
    }
    reportProgress(opts, {
      done: fi + 1,
      total: files.length,
      label: rel,
      phase: 'done-file',
      detail: `${rel} finished.`,
    });
  }

  if (target.merge && mergePdf) {
    try {
      throwIfCancelled(opts);
      reportProgress(opts, {
        done: files.length,
        total: files.length,
        label: mergedRelPath,
        phase: 'write-file',
        detail: `Writing merged PDF…`,
      });
      await writeFile(`${wsPath}/${mergedRelPath}`, new Uint8Array(mergePdf.output('arraybuffer') as ArrayBuffer));
      outputs.push(mergedRelPath);
    } catch (e) { errors.push(`merge write: ${e}`); }
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

async function exportCustom(
  wsPath: string,
  files: string[],
  target: ExportTarget,
  opts?: RunExportOptions,
): Promise<ExportResult> {
  const t0 = Date.now();
  const outputs: string[] = [];
  const errors: string[] = [];
  const cmd = target.customCommand?.trim() ?? '';
  if (!cmd) {
    return { targetId: target.id, outputs: [], errors: ['No custom command configured.'], elapsed: 0 };
  }
  if (files.length === 0 && target.include.length > 0) {
    // Only warn about no matches when a filter was set; no-filter custom commands are run once
    return { targetId: target.id, outputs: [], errors: ['No files matched this target. Check the include extensions or pinned file list.'], elapsed: Date.now() - t0 };
  }

  const absOutDir = `${wsPath}/${target.outputDir}`;
  await ensureDir(absOutDir);
  throwIfCancelled(opts);

  if (files.length === 0) {
    // Run the command once with no substitution
    try {
      reportProgress(opts, {
        done: 0,
        total: 1,
        label: target.name,
        phase: 'run-command',
        detail: 'Running custom command…',
      });
      const result = await runShellCommandCancelable(wsPath, cmd, opts);
      if (result.exit_code !== 0) errors.push(result.stderr || `exit code ${result.exit_code}`);
      else outputs.push(target.outputDir);
    } catch (e) {
      if (e instanceof ExportCancelledError) throw e;
      errors.push(String(e));
    }
  } else {
    for (let index = 0; index < files.length; index++) {
      throwIfCancelled(opts);
      const rel = files[index];
      const outName = stripExt(basename(rel));
      const finalCmd = cmd
        .replace(/\{\{input\}\}/g, rel)
        .replace(/\{\{output\}\}/g, `${target.outputDir}/${outName}`);
      try {
        reportProgress(opts, {
          done: index,
          total: files.length,
          label: rel,
          phase: 'run-command',
          detail: `Running custom command for ${rel}…`,
        });
        const result = await runShellCommandCancelable(wsPath, finalCmd, opts);
        if (result.exit_code !== 0) errors.push(`${rel}: ${result.stderr || `exit ${result.exit_code}`}`);
        else outputs.push(`${target.outputDir}/${outName}`);
      } catch (e) {
        if (e instanceof ExportCancelledError) throw e;
        errors.push(`${rel}: ${e}`);
      }
      await yieldToUI();
    }
  }
  return { targetId: target.id, outputs, errors, elapsed: Date.now() - t0 };
}

async function exportGitPublish(
  wsPath: string,
  target: ExportTarget,
  opts?: RunExportOptions,
): Promise<ExportResult> {
  const t0 = Date.now();
  const gitPublish = target.gitPublish ?? {};
  const commitTemplate = gitPublish.commitMessage?.trim() || 'Publish from Cafezin — {{datetime}}';
  const remote = gitPublish.remote?.trim() || 'origin';
  const branch = gitPublish.branch?.trim() || '';
  const skipCommitWhenNoChanges = gitPublish.skipCommitWhenNoChanges !== false;

  try {
    throwIfCancelled(opts);
    reportProgress(opts, {
      done: 0,
      total: 1,
      label: target.name,
      phase: 'git-check',
      detail: 'Checking git repository…',
    });
    const insideRepo = await runShellCommand(wsPath, 'git rev-parse --is-inside-work-tree');
    if (insideRepo.exit_code !== 0) {
      return {
        targetId: target.id,
        outputs: [],
        errors: ['This workspace is not a git repository. Initialize git before using Git Publish targets.'],
        elapsed: Date.now() - t0,
      };
    }

    throwIfCancelled(opts);
    reportProgress(opts, {
      done: 0,
      total: 1,
      label: target.name,
      phase: 'git-stage',
      detail: 'Staging changes…',
    });
    const addResult = await runShellCommand(wsPath, 'git add -A');
    if (addResult.exit_code !== 0) {
      return {
        targetId: target.id,
        outputs: [],
        errors: [addResult.stderr || 'git add -A failed.'],
        elapsed: Date.now() - t0,
      };
    }

    throwIfCancelled(opts);
    reportProgress(opts, {
      done: 0,
      total: 1,
      label: target.name,
      phase: 'git-diff',
      detail: 'Checking staged changes…',
    });
    const diffResult = await runShellCommand(wsPath, 'git diff --cached --quiet --exit-code');
    if (diffResult.exit_code !== 0 && diffResult.exit_code !== 1) {
      return {
        targetId: target.id,
        outputs: [],
        errors: [diffResult.stderr || 'Unable to inspect staged git changes.'],
        elapsed: Date.now() - t0,
      };
    }

    const hasChangesToCommit = diffResult.exit_code === 1;
    let commitMessage = '';
    if (hasChangesToCommit) {
      commitMessage = renderGitTemplate(commitTemplate, target, wsPath).trim();
      if (!commitMessage) {
        return {
          targetId: target.id,
          outputs: [],
          errors: ['Commit message template resolved to an empty string.'],
          elapsed: Date.now() - t0,
        };
      }
      throwIfCancelled(opts);
      reportProgress(opts, {
        done: 0,
        total: 1,
        label: target.name,
        phase: 'git-commit',
        detail: 'Creating commit…',
      });
      const commitResult = await runShellCommand(wsPath, `git commit -m ${shellQuote(commitMessage)}`);
      if (commitResult.exit_code !== 0) {
        return {
          targetId: target.id,
          outputs: [],
          errors: [commitResult.stderr || commitResult.stdout || 'git commit failed.'],
          elapsed: Date.now() - t0,
        };
      }
    } else if (!skipCommitWhenNoChanges) {
      return {
        targetId: target.id,
        outputs: [],
        errors: ['No staged changes to commit.'],
        elapsed: Date.now() - t0,
      };
    }

    const pushCmd = branch
      ? `git push ${shellQuote(remote)} ${shellQuote(branch)}`
      : `git push ${shellQuote(remote)}`;
    throwIfCancelled(opts);
    reportProgress(opts, {
      done: 0,
      total: 1,
      label: target.name,
      phase: 'git-push',
      detail: 'Pushing to remote…',
    });
    const pushResult = await runShellCommand(wsPath, pushCmd);
    if (pushResult.exit_code !== 0) {
      return {
        targetId: target.id,
        outputs: [],
        errors: [pushResult.stderr || pushResult.stdout || 'git push failed.'],
        elapsed: Date.now() - t0,
      };
    }

    const destination = branch ? `${remote}/${branch}` : `${remote} (current branch)`;
    const summary = hasChangesToCommit
      ? `Committed and pushed to ${destination}.`
      : `No new commit needed; pushed to ${destination}.`;

    return {
      targetId: target.id,
      outputs: [],
      errors: [],
      summary: commitMessage ? `${summary} Commit: ${commitMessage}` : summary,
      elapsed: Date.now() - t0,
    };
  } catch (e) {
    return {
      targetId: target.id,
      outputs: [],
      errors: [String(e)],
      elapsed: Date.now() - t0,
    };
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

export interface RunExportOptions {
  workspacePath: string;
  target: ExportTarget;
  workspaceConfig?: WorkspaceConfig;
  /**
   * Ref to the live canvas editor — re-read after onOpenFileForExport resolves
   * so the fresh instance is used. Preferred over canvasEditor.
   */
  canvasEditorRef?: { current: Editor | null };
  /**
   * Concrete editor — used by the Copilot agent tool path which lacks a ref.
   * Ignored when canvasEditorRef is provided.
   */
  canvasEditor?: Editor | null;
  /** Relative path of the currently-open canvas file */
  activeCanvasRel?: string | null;
  /**
   * Programmatically switch to a canvas file before exporting it.
   * Must resolve only after the tldraw Editor is fully mounted.
   * When provided, canvas exports no longer require the file to be pre-opened.
   */
  onOpenFileForExport?: (relPath: string) => Promise<void>;
  /** Restore the previous tab after each canvas file export. */
  onRestoreAfterExport?: () => void;
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
    case 'canvas-png':
      return exportCanvasPNG(workspacePath, matched, target, opts);
    case 'canvas-pdf':
      return exportCanvasPDF(workspacePath, matched, target, opts);
    case 'zip':
      return exportZip(workspacePath, matched, target, opts);
    case 'git-publish':
      return exportGitPublish(workspacePath, target, opts);
    case 'custom':
      return exportCustom(workspacePath, matched, target, opts);
    default:
      return { targetId: target.id, outputs: [], errors: [`Unknown format: ${(target as ExportTarget).format}`], elapsed: 0 };
  }
}
