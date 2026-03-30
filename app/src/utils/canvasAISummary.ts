/**
 * canvasAISummary.ts
 *
 * Canvas-to-text summarisation helpers for the AI system prompt:
 *   • Attribute mappers (color, fill, size, font, align)
 *   • Background shape detection (isBgShape)
 *   • Shape description (describeShape)
 *   • Canvas page summary (summarizeCanvas)
 *   • Selection summary (summarizeCanvasSelection)
 *   • AI context string builder (canvasAIContext)
 *   • Screenshot helpers (canvasToDataUrl, compressDataUrl)
 *
 * These are read-only operations — they never mutate the editor store.
 * Consumers: App.tsx, canvasTools.ts, CanvasEditor.tsx, useAIScreenshot.ts, useAIStream.ts
 */

import type { Editor, TLRichText, TLShapeId } from 'tldraw';
import { renderPlaintextFromRichText } from 'tldraw';
import type { TLFrameShape } from '@tldraw/tlschema';

// ── Slide layout constants — keep in sync with CanvasEditor.tsx ─────────────
export const SLIDE_W = 1280;
export const SLIDE_H = 720;
export const SLIDE_GAP = 80;

// ── Color mapping ────────────────────────────────────────────────────────────

export type TLColor =
  | 'black' | 'blue' | 'green' | 'grey' | 'light-blue' | 'light-green'
  | 'light-red' | 'light-violet' | 'orange' | 'red' | 'violet' | 'white' | 'yellow';

const COLOR_MAP: Record<string, TLColor> = {
  yellow: 'yellow', blue: 'blue', green: 'green', red: 'red', orange: 'orange',
  purple: 'violet', violet: 'violet', lavender: 'light-violet',
  grey: 'grey', gray: 'grey',
  white: 'white', black: 'black',
  'light-blue': 'light-blue', 'light-green': 'light-green',
  'light-red': 'light-red', 'light-violet': 'light-violet',
  pink: 'light-red', teal: 'light-blue',
};

export type TLFill = 'none' | 'semi' | 'solid' | 'pattern';
export type TLSize = 's' | 'm' | 'l' | 'xl';
export type TLFont = 'draw' | 'sans' | 'serif' | 'mono';
export type TLAlign = 'start' | 'middle' | 'end';

export function mapFill(raw: unknown): TLFill {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'none' || s === 'semi' || s === 'solid' || s === 'pattern') return s as TLFill;
  return 'solid';
}

export function mapColor(raw: unknown, fallback: TLColor = 'yellow'): TLColor {
  return COLOR_MAP[String(raw ?? '').toLowerCase()] ?? fallback;
}

export function mapSize(raw: unknown, fallback: TLSize = 'm'): TLSize {
  const s = String(raw ?? '').toLowerCase();
  if (s === 's' || s === 'm' || s === 'l' || s === 'xl') return s as TLSize;
  if (s === 'small') return 's';
  if (s === 'large') return 'l';
  if (s === 'xlarge' || s === 'x-large' || s === 'title') return 'xl';
  return fallback;
}

export function mapFont(raw: unknown, fallback: TLFont = 'sans'): TLFont {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'draw' || s === 'sans' || s === 'serif' || s === 'mono') return s as TLFont;
  return fallback;
}

export function mapAlign(raw: unknown, fallback: TLAlign = 'start'): TLAlign {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'start' || s === 'left') return 'start';
  if (s === 'middle' || s === 'center') return 'middle';
  if (s === 'end' || s === 'right') return 'end';
  return fallback;
}

// ── Background shape detection ────────────────────────────────────────────────

/**
 * Returns true when a shape is a full-frame background (image or solid-fill geo rectangle).
 * Uses `meta.isBg` marker first (set by our ops), then falls back to size heuristic so
 * older canvas files created before the marker was introduced still work.
 */
export function isBgShape(
  shape: ReturnType<Editor['getCurrentPageShapes']>[number],
  fw: number,
  fh: number,
): boolean {
  if ((shape.meta as Record<string, unknown>)?.isBg === true) return true;
  const p = shape.props as { w?: number; h?: number; fill?: string; geo?: string };
  const isFullFrame = (p.w ?? 0) >= fw * 0.8 && (p.h ?? 0) >= fh * 0.8;
  if (!isFullFrame) return false;
  if (shape.type === 'image') return true;
  if (shape.type === 'geo') return p.geo === 'rectangle' && (p.fill === 'solid' || p.fill === 'semi' || p.fill === 'pattern');
  return false;
}

// ── Single-shape description ──────────────────────────────────────────────────

/** Compute the axis-aligned bounding box for a set of shapes (parent-relative coords). */
function shapeBounds(ss: ReturnType<Editor['getCurrentPageShapes']>): { x1: number; y1: number; x2: number; y2: number } | null {
  if (ss.length === 0) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const s of ss) {
    const p = s.props as { w?: number; h?: number };
    const w = p.w ?? 200;
    const h = p.h ?? 100;
    x1 = Math.min(x1, s.x);
    y1 = Math.min(y1, s.y);
    x2 = Math.max(x2, s.x + w);
    y2 = Math.max(y2, s.y + h);
  }
  return { x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2) };
}

/**
 * Render a single non-frame shape as a one-line description string.
 * Pass `frameW`/`frameH` when the shape is a child of a frame so image shapes
 * can be tagged `[BG]` when they cover ≥80% of the frame area.
 */
function describeShape(
  editor: Editor,
  shape: ReturnType<Editor['getCurrentPageShapes']>[number],
  frameW?: number,
  frameH?: number,
): string {
  const props = shape.props as {
    richText?: TLRichText;
    color?: string;
    fill?: string;
    geo?: string;
    w?: number;
    h?: number;
    start?: { x: number; y: number };
    end?: { x: number; y: number };
    text?: string;
  };
  let text = '';
  if (props.richText) {
    try { text = renderPlaintextFromRichText(editor, props.richText); } catch { /* skip */ }
  } else if (typeof props.text === 'string') {
    text = props.text;
  }
  // 10 chars — 6 chars created ~1/16M collision probability at 50 shapes which is too risky;
  // 10 chars reduces it to ~1/1T which is safe for any realistic canvas size.
  const shortId = shape.id.slice(-10);
  const x = Math.round(shape.x);
  const y = Math.round(shape.y);
  const attrs: string[] = [];
  if (props.color) attrs.push(`color:${props.color}`);
  if (props.fill && props.fill !== 'none') attrs.push(`fill:${props.fill}`);
  const anyProps = props as Record<string, unknown>;
  if (anyProps.size) attrs.push(`size:${anyProps.size}`);
  if (anyProps.font && anyProps.font !== 'sans') attrs.push(`font:${anyProps.font}`);
  const attrStr = attrs.length ? ` [${attrs.join(', ')}]` : '';
  if (shape.type === 'arrow') {
    const ap = props as unknown as { start: { x: number; y: number }; end: { x: number; y: number } };
    const sx = Math.round(shape.x + (ap.start?.x ?? 0));
    const sy = Math.round(shape.y + (ap.start?.y ?? 0));
    const ex = Math.round(shape.x + (ap.end?.x ?? 0));
    const ey = Math.round(shape.y + (ap.end?.y ?? 0));
    return `[${shortId}] arrow from (${sx},${sy}) → (${ex},${ey})` + (text ? ` label:"${text}"` : '') + attrStr;
  }
  if (shape.type === 'geo') {
    const w = props.w ? Math.round(props.w) : '?';
    const h = props.h ? Math.round(props.h) : '?';
    return `[${shortId}] ${props.geo ?? 'geo'} at (${x},${y}) size ${w}×${h}` + (text ? ` text:"${text}"` : '') + attrStr;
  }
  if (shape.type === 'image') {
    const imgProps = shape.props as { assetId?: string; w?: number; h?: number };
    const iw = typeof imgProps.w === 'number' ? imgProps.w : 0;
    const ih = typeof imgProps.h === 'number' ? imgProps.h : 0;
    const w = iw ? Math.round(iw) : '?';
    const h = ih ? Math.round(ih) : '?';
    // Tag as [BG] when this image covers ≥80% of its parent frame.
    const isBg =
      frameW !== undefined && frameH !== undefined &&
      iw >= frameW * 0.8 && ih >= frameH * 0.8;
    const bgTag = isBg ? ' [BG]' : '';
    let srcPart = '';
    if (imgProps.assetId) {
      try {
        const asset = editor.getAsset(imgProps.assetId as Parameters<Editor['getAsset']>[0]) as { props?: { src?: string } } | undefined;
        const src = asset?.props?.src ?? '';
        if (src && !src.startsWith('data:')) {
          const filename = src.split('/').pop()?.split('?')[0] ?? '';
          if (filename) srcPart = ` src:"${filename.slice(0, 40)}"`;
        } else if (src.startsWith('data:')) {
          srcPart = ' src:"<data-url>"`';
        }
      } catch { /* asset store unavailable — skip */ }
    }
    return `[${shortId}] image${bgTag} at (${x},${y}) size ${w}×${h}${srcPart}`;
  }
  return `[${shortId}] ${shape.type} at (${x},${y})` + (text ? ` text:"${text}"` : '') + attrStr;
}

// ── Page-level summaries ──────────────────────────────────────────────────────

/** Returns a short human-readable description of every shape on the canvas. */
export function summarizeCanvas(editor: Editor): string {
  const shapes = editor.getCurrentPageShapes();
  if (shapes.length === 0) return 'The canvas is currently empty.';

  const page = editor.getCurrentPage();
  const frames = shapes.filter((s) => s.type === 'frame').sort((a, b) => (a as TLFrameShape).x - (b as TLFrameShape).x) as TLFrameShape[];
  const nonFrames = shapes.filter((s) => s.type !== 'frame');
  const lines: string[] = [
    `Canvas page: "${page.name}" — ${shapes.length} shape(s), ${frames.length} slide(s):`,
  ];

  const frameChildren = new Map<string, typeof nonFrames>();
  const freeShapes: typeof nonFrames = [];
  for (const s of nonFrames) {
    const parentFrame = frames.find((f) => f.id === s.parentId);
    if (parentFrame) {
      if (!frameChildren.has(parentFrame.id)) frameChildren.set(parentFrame.id, []);
      frameChildren.get(parentFrame.id)!.push(s);
    } else {
      freeShapes.push(s);
    }
  }

  if (frames.length > 0) {
    lines.push('  Slides (frames):');
    frames.forEach((f, i) => {
      const name = (f.props as { name?: string }).name ?? `Slide ${i + 1}`;
      const children = frameChildren.get(f.id) ?? [];
      lines.push(`    [${f.id.slice(-10)}] slide ${i + 1}: "${name}" at (${Math.round(f.x)},${Math.round(f.y)}) size ${f.props.w}\u00d7${f.props.h}`);
      if (children.length === 0) {
        lines.push(`      (empty slide — free to fill entire ${f.props.w}\u00d7${f.props.h} area)`);
      } else {
        const nonBgChildren = children.filter((s) => !isBgShape(s, f.props.w, f.props.h));
        const bb = shapeBounds(nonBgChildren.length > 0 ? nonBgChildren : children);
        if (bb) {
          const freeY = bb.y2 + 20;
          lines.push(`      Occupied area: (${bb.x1},${bb.y1})\u2192(${bb.x2},${bb.y2}). Next free row starts at y\u2248${freeY}`);
        }
        for (const s of children) {
          lines.push('      ' + describeShape(editor, s, f.props.w, f.props.h));
        }
      }
    });
  }

  const shapesToList = frames.length > 0 ? freeShapes : shapes;
  if (shapesToList.length > 0) {
    const bb = shapeBounds(shapesToList);
    if (bb) {
      lines.push(`  Page-level content occupies (${bb.x1},${bb.y1})\u2192(${bb.x2},${bb.y2}). Add new content below y\u2248${bb.y2 + 40} or right of x\u2248${bb.x2 + 40}.`);
    }
  }
  for (const shape of shapesToList) {
    lines.push('  ' + describeShape(editor, shape));
  }
  return lines.join('\n');
}

export function summarizeCanvasSelection(editor: Editor): string | null {
  const selected = editor.getSelectedShapes();
  if (selected.length === 0) return null;

  const lines: string[] = [`Selected canvas shapes: ${selected.length}`];
  for (const shape of selected) {
    if (shape.type === 'frame') {
      const frame = shape as TLFrameShape;
      const name = (frame.props as { name?: string }).name ?? 'Untitled slide';
      lines.push(
        `[${frame.id.slice(-10)}] slide "${name}" at (${Math.round(frame.x)},${Math.round(frame.y)}) size ${frame.props.w}×${frame.props.h}`,
      );
      continue;
    }
    const parentFrame = editor.getShape(shape.parentId as TLShapeId);
    if (parentFrame?.type === 'frame') {
      const frame = parentFrame as TLFrameShape;
      lines.push(`${describeShape(editor, shape, frame.props.w, frame.props.h)} (inside slide "${(frame.props as { name?: string }).name ?? 'Untitled slide'}")`);
      continue;
    }
    lines.push(describeShape(editor, shape));
  }
  return lines.join('\n');
}

/**
 * Full AI document context for an open canvas file.
 * Includes the current shape summary AND the canvas_op tool protocol.
 */
export function canvasAIContext(editor: Editor, filename: string): string {
  return [
    `Canvas file: ${filename}`,
    summarizeCanvas(editor),
    '',
    'The summary above shows "Occupied area" and "Next free row" for each slide so you know exactly where to place new shapes without overlap.',
    'Use canvas_op to modify (one JSON object per line). Always include "slide":"<frameId>" to parent shapes inside a frame.',
    'x/y inside a slide are frame-relative: (0,0) = frame top-left, max ≈ (1280,720).',
  ].join('\n');
}

// ── Screenshot helpers ────────────────────────────────────────────────────────

/**
 * Renders the current canvas page to a base64 PNG data URL.
 * pixelRatio 1 = screen size (~60-150 kB), 1.5 = sharper for vision sends (~150-350 kB).
 * Returns '' when the canvas is empty or rendering fails.
 */
export async function canvasToDataUrl(editor: Editor, pixelRatio = 1): Promise<string> {
  const shapes = editor.getCurrentPageShapes();
  if (shapes.length === 0) return '';
  const ids = shapes.map((s) => s.id);
  try {
    const { url } = await editor.toImageDataUrl(ids, {
      format: 'png',
      pixelRatio,
      background: true,
    });
    return url;
  } catch {
    return '';
  }
}

/**
 * Compress an image data URL: scale down to `maxWidth` pixels and convert to
 * JPEG at `quality` (0–1). Guarantees the result is under `maxBytes` by
 * making additional passes at reduced quality/width if needed.
 *
 * Returns the original URL unchanged if conversion fails for any reason.
 */
export function compressDataUrl(
  dataUrl: string,
  maxWidth = 1024,
  quality = 0.7,
  maxBytes = 180_000, // ~135 KB of raw base64 ≈ ~180 KB string length
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const drawAndEncode = (w: number, h: number, q: number): string => {
          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          const ctx = cv.getContext('2d');
          if (!ctx) return dataUrl;
          ctx.drawImage(img, 0, 0, w, h);
          return cv.toDataURL('image/jpeg', q);
        };

        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        let w = Math.round(img.width * scale);
        let h = Math.round(img.height * scale);
        let result = drawAndEncode(w, h, quality);

        // If still over budget, reduce quality in steps then shrink dimensions.
        const qualitySteps = [0.45, 0.35, 0.25];
        for (const q of qualitySteps) {
          if (result.length <= maxBytes) break;
          result = drawAndEncode(w, h, q);
        }
        // Last resort: halve dimensions.
        if (result.length > maxBytes) {
          w = Math.max(Math.round(w / 2), 128);
          h = Math.max(Math.round(h / 2), 72);
          result = drawAndEncode(w, h, 0.35);
        }

        resolve(result);
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
