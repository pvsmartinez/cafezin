/**
 * canvasAICommands.ts
 *
 * Parse-and-execute layer: reads a ```canvas … ``` code block produced by the
 * AI and applies each JSON command against the live tldraw Editor instance.
 *
 * Command format (one JSON object per line inside the fenced block):
 *   {"op":"add_slide",  "name":"Slide title"}
 *   {"op":"add_note",   "text":"…", "x":100, "y":100, "color":"yellow"}
 *   {"op":"add_text",   "text":"…", "x":100, "y":100}
 *   {"op":"add_geo",    "geo":"rectangle", "x":0, "y":0, "w":200, "h":120}
 *   {"op":"add_image",  "url":"https://…", "x":0, "y":0, "w":1280, "h":720, "slide":"frameId"}
 *   {"op":"set_slide_background", "url":"https://…", "slide":"frameId"}
 *   {"op":"copy_slide_background","from_slide":"abc1234567","to_slides":["def1234567"]}
 *   {"op":"update",     "id":"abc123", "text":"New text"}
 *   {"op":"delete",     "id":"abc123"}
 *   {"op":"clear",      "confirm":"yes"}
 *   {"op":"apply_theme","bg_color":"black","text_color":"white","to_slides":"all"}
 *   {"op":"recolor_slide","slide":"abc1234567","text_color":"white"}
 *   {"op":"duplicate_slide","slide":"abc1234567","name":"Slide 3"}
 *   {"op":"create_lesson","slides":[…]}
 *   {"op":"add_bullet_list","slide":"abc1234567","header":"H","items":["a","b"]}
 *   {"op":"add_two_col","slide":"abc1234567","left_title":"A","left_items":["…"],"right_title":"B","right_items":["…"]}
 *
 * "id" / "slide" values match the last-10-characters of a shape ID.
 */

import type { Editor, TLRichText, TLShapeId } from 'tldraw';
import { createShapeId, toRichText } from 'tldraw';
import type {
  TLNoteShape, TLGeoShape, TLTextShape, TLGeoShapeGeoStyle,
  TLArrowShape, TLFrameShape,
} from '@tldraw/tlschema';
import { toRichTextMd } from './canvasAISnapshot';
import {
  SLIDE_W, SLIDE_H, SLIDE_GAP,
  type TLColor,
  mapColor, mapFill, mapSize, mapFont, mapAlign,
  isBgShape,
} from './canvasAISummary';

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Find the first ```canvas … ``` block in `aiText`, execute each JSON command
 * against the live editor, and return the count of affected shapes and the
 * IDs of any newly-created shapes.
 * Returns { count: 0, shapeIds: [] } if no canvas block is found.
 */
export function executeCanvasCommands(
  editor: Editor,
  aiText: string,
): { count: number; shapeIds: string[]; errors: string[] } {
  const matches = [...aiText.matchAll(/```canvas\r?\n([\s\S]*?)```/g)];
  if (matches.length === 0) return { count: 0, shapeIds: [], errors: [] };

  // Only execute the LAST block — the AI often emits an explanatory example block
  // before the real commands block, and running all blocks would duplicate shapes.
  const match = matches[matches.length - 1];
  let count = 0;
  const errors: string[] = [];
  const affectedShapeIds = new Set<string>();

  // Atomic rollback: create a history stopping point before any mutations.
  const markId = editor.markHistoryStoppingPoint('canvas-op-batch');

  for (const line of match[1].split('\n').map((l) => l.trim()).filter(Boolean)) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      errors.push(`JSON parse error on: ${line.slice(0, 80)}`);
      continue;
    }
    try {
      const result = runCommand(editor, parsed);
      count += result.count;
      if (result.shapeId) affectedShapeIds.add(String(result.shapeId));
    } catch (e) {
      errors.push(`Command "${parsed.op}" failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Any error = roll back the entire batch atomically.
  if (errors.length > 0) {
    try { editor.bailToMark(markId); } catch { /* history may be empty — ignore */ }
    return { count: 0, shapeIds: [], errors };
  }

  return { count, shapeIds: [...affectedShapeIds], errors };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

type CommandResult = { count: number; shapeId: string | null };

/** Coerce an AI-supplied number to a finite value — guards against NaN/Infinity in AI output. */
function safeCoord(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Create a tldraw image asset + shape. Pass `isBg=true` to mark with meta.isBg. */
function _createImageShape(
  editor: Editor,
  url: string,
  name: string,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  parentId?: TLShapeId,
  isBg = false,
): string {
  const assetId = `asset:${crypto.randomUUID()}` as unknown as ReturnType<typeof createShapeId>;
  editor.createAssets([{
    id: assetId,
    typeName: 'asset',
    type: 'image',
    props: {
      name,
      src: url,
      w: sw,
      h: sh,
      mimeType: url.match(/\.png(\?|$)/i) ? 'image/png'
        : url.match(/\.gif(\?|$)/i) ? 'image/gif'
        : url.match(/\.webp(\?|$)/i) ? 'image/webp'
        : url.match(/\.svg(\?|$)/i) ? 'image/svg+xml'
        : 'image/jpeg',
      isAnimated: false,
    },
    meta: {},
  } as any]);
  const imgId = createShapeId();
  editor.createShapes([{
    id: imgId,
    type: 'image',
    x: sx,
    y: sy,
    ...(parentId ? { parentId } : {}),
    meta: isBg ? { isBg: true } : {},
    props: {
      assetId,
      w: sw,
      h: sh,
      playing: true,
      url: '',
      crop: null,
      flipX: false,
      flipY: false,
      altText: '',
    } as any,
  }]);
  return imgId;
}

/** Create a solid-color full-frame background rectangle tagged with meta.isBg. */
function _createColorBgShape(
  editor: Editor,
  color: TLColor,
  fw: number,
  fh: number,
  parentId?: TLShapeId,
): string {
  const bgId = createShapeId();
  editor.createShapes<TLGeoShape>([{
    id: bgId,
    type: 'geo',
    x: 0,
    y: 0,
    meta: { isBg: true },
    ...(parentId ? { parentId } : {}),
    props: {
      geo: 'rectangle',
      w: fw,
      h: fh,
      richText: toRichText(''),
      color,
      fill: 'solid',
      scale: 1,
    },
  }]);
  return bgId;
}

/**
 * Reliably place a background shape behind all frame content.
 * sendToBack alone can fail silently for shapes inside a tldraw frame because
 * the z-order is frame-local and some tldraw versions apply it page-globally.
 */
function _sendBgToBack(editor: Editor, bgId: string, frameId: TLShapeId) {
  try { editor.sendToBack([bgId as TLShapeId]); } catch { /* older tldraw */ }
  const siblings = editor.getCurrentPageShapes().filter(
    (s) => s.parentId === frameId && s.id !== bgId,
  );
  if (siblings.length > 0) {
    try { editor.bringToFront(siblings.map((s) => s.id as TLShapeId)); } catch { /* older tldraw */ }
  }
}

// ── Command dispatcher ────────────────────────────────────────────────────────

function runCommand(editor: Editor, cmd: Record<string, unknown>): CommandResult {
  const op = String(cmd.op ?? '');
  const existing = editor.getCurrentPageShapes();

  // ── add_slide (frame) ────────────────────────────────────────
  if (op === 'add_slide') {
    const frames = existing
      .filter((s) => s.type === 'frame')
      .sort((a, b) => (a as TLFrameShape).x - (b as TLFrameShape).x) as TLFrameShape[];
    const last = frames[frames.length - 1];
    const sx = last ? last.x + (last.props.w ?? SLIDE_W) + SLIDE_GAP : 0;
    const sy = frames.length > 0 ? Math.min(...frames.map((f) => f.y)) : 0;
    const slideName = String(cmd.name ?? `Slide ${frames.length + 1}`);
    const slideId = createShapeId();
    editor.createShapes<TLFrameShape>([{
      id: slideId, type: 'frame', x: sx, y: sy,
      props: { w: SLIDE_W, h: SLIDE_H, name: slideName },
    }]);
    return { count: 1, shapeId: slideId };
  }

  // ── clear ────────────────────────────────────────────────────
  if (op === 'clear') {
    if (cmd.confirm !== 'yes') {
      console.warn('[canvasAI] clear op blocked: missing confirm:"yes"');
      return { count: 0, shapeId: null };
    }
    if (existing.length > 0) editor.deleteShapes(existing.map((s) => s.id as TLShapeId));
    return { count: existing.length, shapeId: null };
  }

  // ── delete ───────────────────────────────────────────────────
  if (op === 'delete') {
    const suffix = String(cmd.id ?? '');
    if (!suffix) return { count: 0, shapeId: null };
    const target = existing.find((s) => s.id.endsWith(suffix));
    if (!target) return { count: 0, shapeId: null };
    editor.deleteShapes([target.id as TLShapeId]);
    return { count: 1, shapeId: null };
  }

  // ── update ───────────────────────────────────────────────────
  if (op === 'update') {
    const suffix = String(cmd.id ?? '');
    if (!suffix) throw new Error('Missing "id" field on update command — call list_canvas_shapes to find shape IDs.');
    const target = existing.find((s) => s.id.endsWith(suffix));
    if (!target) throw new Error(`Shape not found: "${suffix}" — call list_canvas_shapes to get valid IDs.`);
    if (cmd.text === undefined && cmd.color === undefined && cmd.fill === undefined &&
        cmd.size === undefined && cmd.font === undefined && cmd.align === undefined)
      return { count: 0, shapeId: null };

    const RICH_TEXT_TYPES = new Set(['note', 'text', 'geo', 'arrow']);
    if (target.type === 'frame') {
      const patch: Record<string, unknown> = {};
      if (cmd.text !== undefined) patch.name = String(cmd.text);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editor.updateShapes([{ id: target.id, type: 'frame', props: patch } as any]);
    } else if (RICH_TEXT_TYPES.has(target.type)) {
      const patch: Record<string, unknown> = {};
      if (cmd.text  !== undefined) patch.richText = toRichTextMd(String(cmd.text));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (cmd.color !== undefined) patch.color = mapColor(cmd.color, (target.props as any).color);
      if (cmd.fill  !== undefined) patch.fill  = mapFill(cmd.fill);
      if (cmd.size  !== undefined) patch.size  = mapSize(cmd.size);
      if (cmd.font  !== undefined) patch.font  = mapFont(cmd.font);
      if (cmd.align !== undefined) {
        if (target.type === 'text') patch.textAlign = mapAlign(cmd.align);
        else patch.align = mapAlign(cmd.align);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editor.updateShapes([{ id: target.id, type: target.type, props: patch } as any]);
    } else {
      return { count: 0, shapeId: null };
    }
    return { count: 1, shapeId: target.id };
  }

  // ── move ─────────────────────────────────────────────────────
  if (op === 'move') {
    const suffix = String(cmd.id ?? '');
    if (!suffix) throw new Error('Missing "id" field on move command — call list_canvas_shapes to find shape IDs.');
    const target = existing.find((s) => s.id.endsWith(suffix));
    if (!target) throw new Error(`Shape not found: "${suffix}" — call list_canvas_shapes to get valid IDs.`);
    const newX = safeCoord(cmd.x, target.x);
    const newY = safeCoord(cmd.y, target.y);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor.updateShapes([{ id: target.id, type: target.type, x: newX, y: newY } as any]);
    return { count: 1, shapeId: target.id };
  }

  // ── create_lesson ─────────────────────────────────────────────────────────
  if (op === 'create_lesson') {
    const slideSpecs = Array.isArray(cmd.slides) ? (cmd.slides as Record<string, unknown>[]) : [];
    if (slideSpecs.length === 0) throw new Error('create_lesson: "slides" array is required and must not be empty.');

    const existingFrames = existing
      .filter((s) => s.type === 'frame')
      .sort((a, b) => (a as TLFrameShape).x - (b as TLFrameShape).x) as TLFrameShape[];
    let nextX = existingFrames.length > 0
      ? existingFrames[existingFrames.length - 1].x + SLIDE_W + SLIDE_GAP
      : 0;
    const baseY = existingFrames.length > 0 ? Math.min(...existingFrames.map((f) => f.y)) : 0;

    let totalCount = 0;

    for (const spec of slideSpecs) {
      const slideType = String(spec.type ?? 'title');
      const slideTitle = String(spec.title ?? 'Slide');
      const frameId = createShapeId();

      editor.createShapes<TLFrameShape>([{
        id: frameId, type: 'frame', x: nextX, y: baseY,
        props: { w: SLIDE_W, h: SLIDE_H, name: slideTitle },
      }]);
      nextX += SLIDE_W + SLIDE_GAP;
      totalCount++;

      const pid = frameId as TLShapeId;

      // Accent bar (blue stripe across the top of every slide)
      editor.createShapes<TLGeoShape>([{
        id: createShapeId(), type: 'geo', parentId: pid, x: 0, y: 0,
        props: { geo: 'rectangle', w: 1280, h: 8, richText: toRichText(''), color: 'blue', fill: 'solid', size: 's', font: 'sans', align: 'middle', scale: 1 },
      }]);
      totalCount++;

      if (slideType === 'title' || slideType === 'closing' || slideType === 'summary' || slideType === 'questions') {
        const subtitle = String(spec.subtitle ?? '');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.createShapes<TLTextShape>([{ id: createShapeId(), type: 'text', parentId: pid, x: 100, y: 240, props: { richText: toRichTextMd(slideTitle), color: 'black', size: 'xl', font: 'sans', textAlign: 'start', autoSize: false, w: 1080 } as any }]);
        totalCount++;
        if (subtitle) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          editor.createShapes<TLTextShape>([{ id: createShapeId(), type: 'text', parentId: pid, x: 100, y: 355, props: { richText: toRichTextMd(subtitle), color: 'grey', size: 'l', font: 'sans', textAlign: 'start', autoSize: false, w: 1080 } as any }]);
          totalCount++;
        }
      } else if (slideType === 'bullet-list') {
        const bullets = Array.isArray(spec.bullets) ? (spec.bullets as unknown[]).map(String) : [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.createShapes<TLTextShape>([{ id: createShapeId(), type: 'text', parentId: pid, x: 80, y: 22, props: { richText: toRichTextMd(slideTitle), color: 'black', size: 'xl', font: 'sans', textAlign: 'start', autoSize: false, w: 1100 } as any }]);
        editor.createShapes<TLGeoShape>([{ id: createShapeId(), type: 'geo', parentId: pid, x: 80, y: 104,
          props: { geo: 'rectangle', w: 1120, h: 2, richText: toRichText(''), color: 'grey', fill: 'solid', size: 's', font: 'sans', align: 'middle', scale: 1 } }]);
        totalCount += 2;
        const maxBullets = Math.min(bullets.length, 6);
        for (let i = 0; i < maxBullets; i++) {
          editor.createShapes<TLGeoShape>([{
            id: createShapeId(), type: 'geo', parentId: pid,
            x: 80, y: 118 + i * 90,
            props: { geo: 'rectangle', w: 1120, h: 78, richText: toRichTextMd(bullets[i]), color: mapColor(spec.item_color, 'black'), fill: 'none', size: 'm', font: 'sans', align: 'start', scale: 1 },
          }]);
          totalCount++;
        }
      } else if (slideType === 'two-col') {
        const leftTitle  = String((spec as Record<string, unknown>).left_title  ?? 'Left');
        const rightTitle = String((spec as Record<string, unknown>).right_title ?? 'Right');
        const leftItems  = Array.isArray((spec as Record<string, unknown>).left_items)  ? ((spec as Record<string, unknown>).left_items  as unknown[]).map(String) : [];
        const rightItems = Array.isArray((spec as Record<string, unknown>).right_items) ? ((spec as Record<string, unknown>).right_items as unknown[]).map(String) : [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.createShapes<TLTextShape>([{ id: createShapeId(), type: 'text', parentId: pid, x: 80, y: 22, props: { richText: toRichTextMd(slideTitle), color: 'black', size: 'xl', font: 'sans', textAlign: 'start', autoSize: false, w: 1100 } as any }]);
        editor.createShapes<TLGeoShape>([{ id: createShapeId(), type: 'geo', parentId: pid, x: 80, y: 104,
          props: { geo: 'rectangle', w: 1120, h: 2, richText: toRichText(''), color: 'grey', fill: 'solid', size: 's', font: 'sans', align: 'middle', scale: 1 } }]);
        totalCount += 2;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.createShapes<TLTextShape>([{ id: createShapeId(), type: 'text', parentId: pid, x: 80,  y: 118, props: { richText: toRichTextMd(leftTitle),  color: 'blue', size: 'l', font: 'sans', textAlign: 'start', autoSize: false, w: 520 } as any }]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.createShapes<TLTextShape>([{ id: createShapeId(), type: 'text', parentId: pid, x: 680, y: 118, props: { richText: toRichTextMd(rightTitle), color: 'blue', size: 'l', font: 'sans', textAlign: 'start', autoSize: false, w: 520 } as any }]);
        totalCount += 2;
        const maxLeft  = Math.min(leftItems.length,  5);
        const maxRight = Math.min(rightItems.length, 5);
        for (let i = 0; i < maxLeft; i++) {
          editor.createShapes<TLGeoShape>([{ id: createShapeId(), type: 'geo', parentId: pid, x: 80, y: 188 + i * 86,
            props: { geo: 'rectangle', w: 540, h: 74, richText: toRichTextMd(leftItems[i]), color: 'black', fill: 'none', size: 'm', font: 'sans', align: 'start', scale: 1 } }]);
          totalCount++;
        }
        for (let i = 0; i < maxRight; i++) {
          editor.createShapes<TLGeoShape>([{ id: createShapeId(), type: 'geo', parentId: pid, x: 680, y: 188 + i * 86,
            props: { geo: 'rectangle', w: 540, h: 74, richText: toRichTextMd(rightItems[i]), color: 'grey', fill: 'none', size: 'm', font: 'sans', align: 'start', scale: 1 } }]);
          totalCount++;
        }
      } else if (slideType === 'timeline') {
        const events = Array.isArray(spec.events) ? (spec.events as unknown[]).map(String) : [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.createShapes<TLTextShape>([{ id: createShapeId(), type: 'text', parentId: pid, x: 80, y: 22, props: { richText: toRichTextMd(slideTitle), color: 'black', size: 'xl', font: 'sans', textAlign: 'start', autoSize: false, w: 1100 } as any }]);
        totalCount++;
        const arrowId = createShapeId();
        editor.createShapes<TLArrowShape>([{
          id: arrowId, type: 'arrow', parentId: pid, x: 80, y: 370,
          props: { start: { x: 0, y: 0 }, end: { x: 1100, y: 0 }, richText: toRichTextMd(''), color: 'grey', arrowheadEnd: 'arrow', arrowheadStart: 'none' } as TLArrowShape['props'],
        }]);
        totalCount++;
        const maxEvents = Math.min(events.length, 6);
        const nodeW = 160;
        const pitch = maxEvents > 0 ? Math.min(230, Math.floor(1100 / maxEvents)) : 230;
        for (let i = 0; i < maxEvents; i++) {
          const nx = 80 + i * pitch;
          editor.createShapes<TLGeoShape>([{
            id: createShapeId(), type: 'geo', parentId: pid, x: nx, y: 270,
            props: { geo: 'rectangle', w: nodeW, h: 80, richText: toRichTextMd(events[i]), color: 'blue', fill: 'solid', size: 's', font: 'sans', align: 'middle', scale: 1 },
          }]);
          totalCount++;
        }
      }
    }
    return { count: totalCount, shapeId: null };
  }

  // ── add_bullet_list ───────────────────────────────────────────────────────
  if (op === 'add_bullet_list') {
    const suffix = cmd.slide ? String(cmd.slide) : '';
    if (!suffix) throw new Error('add_bullet_list requires a "slide" field with a frame ID.');
    const pid = existing.find((s) => s.type === 'frame' && s.id.endsWith(suffix))?.id as TLShapeId | undefined;
    if (!pid) throw new Error(`add_bullet_list: frame not found for slide="${suffix}". Call list_canvas_shapes to get valid IDs.`);

    const header = String(cmd.header ?? '');
    const items  = Array.isArray(cmd.items) ? (cmd.items as unknown[]).map(String) : [];
    const yStart = safeCoord(cmd.y_start, header ? 18 : 80);
    const pitch  = safeCoord(cmd.pitch, 90);

    let currentY = yStart;
    let count = 0;

    if (header) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editor.createShapes<TLTextShape>([{ id: createShapeId(), type: 'text', parentId: pid, x: 80, y: currentY,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        props: { richText: toRichTextMd(header), color: mapColor(cmd.header_color, 'black'), size: 'xl', font: 'sans', textAlign: 'start', autoSize: false, w: 1120 } as any }]);
      editor.createShapes<TLGeoShape>([{ id: createShapeId(), type: 'geo', parentId: pid, x: 80, y: currentY + 90,
        props: { geo: 'rectangle', w: 1120, h: 2, richText: toRichText(''), color: 'grey', fill: 'solid', size: 's', font: 'sans', align: 'middle', scale: 1 } }]);
      currentY += 100;
      count += 2;
    }
    const maxItems = Math.min(items.length, 7);
    for (let i = 0; i < maxItems; i++) {
      editor.createShapes<TLGeoShape>([{
        id: createShapeId(), type: 'geo', parentId: pid, x: 80, y: currentY,
        props: { geo: 'rectangle', w: 1120, h: 78, richText: toRichTextMd(items[i]), color: mapColor(cmd.item_color, 'black'), fill: 'none', size: 'm', font: 'sans', align: 'start', scale: 1 },
      }]);
      currentY += pitch;
      count++;
    }
    return { count, shapeId: null };
  }

  // ── add_two_col ───────────────────────────────────────────────────────────
  if (op === 'add_two_col') {
    const suffix = cmd.slide ? String(cmd.slide) : '';
    if (!suffix) throw new Error('add_two_col requires a "slide" field with a frame ID.');
    const pid = existing.find((s) => s.type === 'frame' && s.id.endsWith(suffix))?.id as TLShapeId | undefined;
    if (!pid) throw new Error(`add_two_col: frame not found for slide="${suffix}". Call list_canvas_shapes to get valid IDs.`);

    const header     = String(cmd.header ?? '');
    const leftTitle  = String((cmd as Record<string, unknown>).left_title  ?? 'Esquerda');
    const rightTitle = String((cmd as Record<string, unknown>).right_title ?? 'Direita');
    const leftItems  = Array.isArray((cmd as Record<string, unknown>).left_items)  ? ((cmd as Record<string, unknown>).left_items  as unknown[]).map(String) : [];
    const rightItems = Array.isArray((cmd as Record<string, unknown>).right_items) ? ((cmd as Record<string, unknown>).right_items as unknown[]).map(String) : [];
    const yStart     = safeCoord(cmd.y_start, 18);
    const pitch      = safeCoord(cmd.pitch, 86);

    let currentY = yStart;
    let count = 0;

    if (header) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editor.createShapes<TLTextShape>([{ id: createShapeId(), type: 'text', parentId: pid, x: 80, y: currentY,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        props: { richText: toRichTextMd(header), color: 'black', size: 'xl', font: 'sans', textAlign: 'start', autoSize: false, w: 1120 } as any }]);
      editor.createShapes<TLGeoShape>([{ id: createShapeId(), type: 'geo', parentId: pid, x: 80, y: currentY + 90,
        props: { geo: 'rectangle', w: 1120, h: 2, richText: toRichText(''), color: 'grey', fill: 'solid', size: 's', font: 'sans', align: 'middle', scale: 1 } }]);
      currentY += 100;
      count += 2;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor.createShapes<TLTextShape>([{ id: createShapeId(), type: 'text', parentId: pid, x: 80,  y: currentY,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      props: { richText: toRichTextMd(leftTitle),  color: 'blue', size: 'l', font: 'sans', textAlign: 'start', autoSize: false, w: 540 } as any }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor.createShapes<TLTextShape>([{ id: createShapeId(), type: 'text', parentId: pid, x: 660, y: currentY,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      props: { richText: toRichTextMd(rightTitle), color: 'blue', size: 'l', font: 'sans', textAlign: 'start', autoSize: false, w: 540 } as any }]);
    currentY += 68;
    count += 2;

    const maxLeft  = Math.min(leftItems.length,  5);
    const maxRight = Math.min(rightItems.length, 5);
    for (let i = 0; i < maxLeft; i++) {
      editor.createShapes<TLGeoShape>([{
        id: createShapeId(), type: 'geo', parentId: pid, x: 80, y: currentY + i * pitch,
        props: { geo: 'rectangle', w: 540, h: 74, richText: toRichTextMd(leftItems[i]), color: 'black', fill: 'none', size: 'm', font: 'sans', align: 'start', scale: 1 },
      }]);
      count++;
    }
    for (let i = 0; i < maxRight; i++) {
      editor.createShapes<TLGeoShape>([{
        id: createShapeId(), type: 'geo', parentId: pid, x: 660, y: currentY + i * pitch,
        props: { geo: 'rectangle', w: 540, h: 74, richText: toRichTextMd(rightItems[i]), color: 'grey', fill: 'none', size: 'm', font: 'sans', align: 'start', scale: 1 },
      }]);
      count++;
    }
    return { count, shapeId: null };
  }

  // ── Auto-position for new freestanding shapes ─────────────────────────────
  const idx = existing.length;
  const x = safeCoord(cmd.x, 100 + (idx % 5) * 220);
  const y = safeCoord(cmd.y, 100 + Math.floor(idx / 5) * 160);

  const parentFrameId = cmd.slide
    ? (existing.find((s) => s.type === 'frame' && s.id.endsWith(String(cmd.slide)))?.id as TLShapeId | undefined)
    : undefined;

  // ── add_note (sticky note) ────────────────────────────────────
  if (op === 'add_note') {
    const noteId = createShapeId();
    editor.createShapes<TLNoteShape>([{
      id: noteId,
      type: 'note',
      ...(parentFrameId ? { parentId: parentFrameId } : {}),
      x, y,
      props: {
        richText: toRichTextMd(String(cmd.text ?? '')),
        color: mapColor(cmd.color, 'yellow'),
        size: mapSize(cmd.size, 'm'),
        font: mapFont(cmd.font, 'sans'),
        align: mapAlign(cmd.align, 'middle'),
      },
    }]);
    return { count: 1, shapeId: noteId };
  }

  // ── add_text (freestanding text label) ────────────────────────
  if (op === 'add_text') {
    const textId = createShapeId();
    editor.createShapes<TLTextShape>([{
      id: textId,
      type: 'text',
      ...(parentFrameId ? { parentId: parentFrameId } : {}),
      x, y,
      props: {
        richText: toRichTextMd(String(cmd.text ?? '')),
        color: mapColor(cmd.color, 'black'),
        size: mapSize(cmd.size, 'm'),
        font: mapFont(cmd.font, 'sans'),
        textAlign: mapAlign(cmd.align, 'start'),
        autoSize: true,
      },
    }]);
    return { count: 1, shapeId: textId };
  }

  // ── add_geo (rectangle, ellipse, triangle, …) ─────────────────
  if (op === 'add_geo') {
    const VALID_GEO = new Set([
      'rectangle', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon',
      'octagon', 'star', 'rhombus', 'rhombus-2', 'oval', 'trapezoid',
      'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down',
      'x-box', 'check-box', 'cloud', 'heart',
    ]);
    const rawGeo = String(cmd.geo ?? 'rectangle');
    if (!VALID_GEO.has(rawGeo)) throw new Error(`Unknown geo type "${rawGeo}". Valid types: ${[...VALID_GEO].join(', ')}.`);
    const geoVal = rawGeo as TLGeoShapeGeoStyle;
    const geoId = createShapeId();
    editor.createShapes<TLGeoShape>([{
      id: geoId,
      type: 'geo',
      ...(parentFrameId ? { parentId: parentFrameId } : {}),
      x, y,
      props: {
        geo: geoVal,
        w: safeCoord(cmd.w, 200),
        h: safeCoord(cmd.h, 120),
        richText: toRichTextMd(String(cmd.text ?? '')),
        color: mapColor(cmd.color, 'blue'),
        fill: mapFill(cmd.fill),
        size: mapSize(cmd.size, 'm'),
        font: mapFont(cmd.font, 'sans'),
        align: mapAlign(cmd.align, 'middle'),
        scale: 1,
      },
    }]);
    return { count: 1, shapeId: geoId };
  }

  // ── add_arrow ─────────────────────────────────────────────────
  if (op === 'add_arrow') {
    const x1 = safeCoord(cmd.x1, x);
    const y1 = safeCoord(cmd.y1, y);
    const x2 = safeCoord(cmd.x2, x1 + 200);
    const y2 = safeCoord(cmd.y2, y1);
    const label = String(cmd.label ?? cmd.text ?? '');
    const arrowId = createShapeId();
    editor.createShapes<TLArrowShape>([{
      id: arrowId,
      type: 'arrow',
      ...(parentFrameId ? { parentId: parentFrameId } : {}),
      x: x1, y: y1,
      props: {
        start: { x: 0, y: 0 },
        end: { x: x2 - x1, y: y2 - y1 },
        richText: toRichTextMd(label),
        color: mapColor(cmd.color, 'grey'),
        arrowheadEnd: 'arrow',
        arrowheadStart: 'none',
      } as TLArrowShape['props'],
    }]);
    return { count: 1, shapeId: arrowId };
  }

  // ── add_image ─────────────────────────────────────────────────
  if (op === 'add_image') {
    const url = String(cmd.url ?? '').trim();
    if (!url) throw new Error('add_image requires a "url" field.');
    const imgW = safeCoord(cmd.w, parentFrameId ? SLIDE_W : 800);
    const imgH = safeCoord(cmd.h, parentFrameId ? SLIDE_H : 600);
    const imgX = safeCoord(cmd.x, 0);
    const imgY = safeCoord(cmd.y, 0);
    const imgName = url.split('/').pop()?.split('?')[0] ?? 'image';
    const imgId = _createImageShape(editor, url, imgName, imgX, imgY, imgW, imgH, parentFrameId);
    if (cmd.to_back && parentFrameId) {
      _sendBgToBack(editor, imgId, parentFrameId);
    } else if (cmd.to_back) {
      try { editor.sendToBack([imgId as TLShapeId]); } catch { /* older tldraw */ }
    }
    return { count: 1, shapeId: imgId };
  }

  // ── set_slide_background ──────────────────────────────────────
  if (op === 'set_slide_background') {
    const url = String(cmd.url ?? '').trim();
    const colorRaw = cmd.color ? String(cmd.color).trim() : '';
    if (!url && !colorRaw) throw new Error('set_slide_background requires either a "url" or a "color" field.');
    const slideId = String(cmd.slide ?? '').trim();
    if (!slideId) throw new Error('set_slide_background requires a "slide" field (last-10-char frame ID).');
    const frame = existing.find((s) => s.type === 'frame' && s.id.endsWith(slideId)) as TLFrameShape | undefined;
    if (!frame) throw new Error(`Slide not found: "${slideId}". Call list_canvas_shapes to get valid frame IDs.`);
    const fw = (frame.props as { w: number }).w ?? SLIDE_W;
    const fh = (frame.props as { h: number }).h ?? SLIDE_H;
    const children = existing.filter((s) => s.parentId === frame.id);
    const toRemove = children.filter((s) => isBgShape(s, fw, fh));
    if (toRemove.length > 0) editor.deleteShapes(toRemove.map((s) => s.id as TLShapeId));
    let bgId: string;
    if (url) {
      const imgName = url.split('/').pop()?.split('?')[0] ?? 'bg';
      bgId = _createImageShape(editor, url, imgName, 0, 0, fw, fh, frame.id as TLShapeId, true);
    } else {
      bgId = _createColorBgShape(editor, mapColor(colorRaw, 'grey'), fw, fh, frame.id as TLShapeId);
    }
    _sendBgToBack(editor, bgId, frame.id as TLShapeId);
    return { count: 1, shapeId: bgId };
  }

  // ── copy_slide_background ─────────────────────────────────────
  if (op === 'copy_slide_background') {
    const fromId = String(cmd.from_slide ?? '').trim();
    if (!fromId) throw new Error('copy_slide_background requires a "from_slide" field.');
    const rawToSlides = Array.isArray(cmd.to_slides) ? cmd.to_slides.map(String) : [];
    if (rawToSlides.length === 0) throw new Error('copy_slide_background requires a "to_slides" array with at least one frame ID.');
    const fromFrame = existing.find((s) => s.type === 'frame' && s.id.endsWith(fromId)) as TLFrameShape | undefined;
    if (!fromFrame) throw new Error(`Source slide not found: "${fromId}"`);
    const fw = (fromFrame.props as { w: number }).w ?? SLIDE_W;
    const fh = (fromFrame.props as { h: number }).h ?? SLIDE_H;
    const srcBgs = existing.filter((s) => s.parentId === fromFrame.id && isBgShape(s, fw, fh));
    if (srcBgs.length === 0) throw new Error(`No background found in source slide "${fromId}". Set a background with set_slide_background first.`);

    let total = 0;
    let lastId: string | null = null;
    for (const toSuffix of rawToSlides) {
      const toFrame = existing.find((s) => s.type === 'frame' && s.id.endsWith(toSuffix)) as TLFrameShape | undefined;
      if (!toFrame) continue;
      const tw = (toFrame.props as { w: number }).w ?? SLIDE_W;
      const th = (toFrame.props as { h: number }).h ?? SLIDE_H;
      const tgtBgs = existing.filter((s) => s.parentId === toFrame.id && isBgShape(s, tw, th));
      if (tgtBgs.length > 0) editor.deleteShapes(tgtBgs.map((s) => s.id as TLShapeId));
      for (const bg of srcBgs) {
        let newId: string | null = null;
        if (bg.type === 'image') {
          const srcProps = bg.props as { assetId?: string };
          let srcUrl = '';
          if (srcProps.assetId) {
            try {
              const asset = editor.getAsset(srcProps.assetId as any) as { props?: { src?: string } } | undefined;
              srcUrl = asset?.props?.src ?? '';
            } catch { /* ignore */ }
          }
          if (!srcUrl) continue;
          const imgName = srcUrl.split('/').pop()?.split('?')[0] ?? 'bg';
          newId = _createImageShape(editor, srcUrl, imgName, 0, 0, tw, th, toFrame.id as TLShapeId, true);
        } else if (bg.type === 'geo') {
          const gp = bg.props as { color?: string };
          newId = _createColorBgShape(editor, mapColor(gp.color, 'grey'), tw, th, toFrame.id as TLShapeId);
        }
        if (!newId) continue;
        _sendBgToBack(editor, newId, toFrame.id as TLShapeId);
        lastId = newId;
        total++;
      }
    }
    if (total === 0) throw new Error('No backgrounds were copied. Check that the source slide has a background and the target IDs are correct.');
    return { count: total, shapeId: lastId };
  }

  // ── apply_theme ───────────────────────────────────────────────
  if (op === 'apply_theme') {
    const bgUrl = String(cmd.bg_url ?? '').trim();
    const bgColor = cmd.bg_color ? String(cmd.bg_color).trim() : '';
    const textColorRaw = cmd.text_color ? String(cmd.text_color).trim() : '';
    if (!bgUrl && !bgColor && !textColorRaw)
      throw new Error('apply_theme requires at least one of: bg_url, bg_color, text_color.');

    const allFrames = existing.filter((s) => s.type === 'frame') as TLFrameShape[];
    if (allFrames.length === 0) throw new Error('No slides found. Create slides with add_slide first.');

    const rawTarget = cmd.to_slides;
    let targetFrames: TLFrameShape[];
    if (!rawTarget || rawTarget === 'all' || (Array.isArray(rawTarget) && (rawTarget as string[]).includes('all'))) {
      targetFrames = allFrames;
    } else {
      const ids = (Array.isArray(rawTarget) ? rawTarget : [rawTarget]).map(String);
      targetFrames = allFrames.filter((f) => ids.some((id) => f.id.endsWith(id)));
      if (targetFrames.length === 0)
        throw new Error('No slides matched the given IDs. Call list_canvas_shapes to get valid frame IDs.');
    }

    let total = 0;
    let lastBgId: string | null = null;

    for (const frame of targetFrames) {
      const fw = (frame.props as { w: number }).w ?? SLIDE_W;
      const fh = (frame.props as { h: number }).h ?? SLIDE_H;
      const children = existing.filter((s) => s.parentId === frame.id);

      if (bgUrl || bgColor) {
        const toRemove = children.filter((s) => isBgShape(s, fw, fh));
        if (toRemove.length > 0) editor.deleteShapes(toRemove.map((s) => s.id as TLShapeId));
        let bgId: string;
        if (bgUrl) {
          const imgName = bgUrl.split('/').pop()?.split('?')[0] ?? 'bg';
          bgId = _createImageShape(editor, bgUrl, imgName, 0, 0, fw, fh, frame.id as TLShapeId, true);
        } else {
          bgId = _createColorBgShape(editor, mapColor(bgColor, 'grey'), fw, fh, frame.id as TLShapeId);
        }
        _sendBgToBack(editor, bgId, frame.id as TLShapeId);
        lastBgId = bgId;
        total++;
      }

      if (textColorRaw) {
        const mappedColor = mapColor(textColorRaw, 'black');
        const contentShapes = children.filter((s) =>
          !isBgShape(s, fw, fh) && ['note', 'text', 'geo', 'arrow'].includes(s.type),
        );
        for (const s of contentShapes) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          editor.updateShapes([{ id: s.id, type: s.type, props: { color: mappedColor } } as any]);
          total++;
        }
      }
    }
    return { count: total, shapeId: lastBgId };
  }

  // ── recolor_slide ─────────────────────────────────────────────
  if (op === 'recolor_slide') {
    const slideId = String(cmd.slide ?? '').trim();
    if (!slideId) throw new Error('recolor_slide requires a "slide" field (last-10-char frame ID).');
    const frame = existing.find((s) => s.type === 'frame' && s.id.endsWith(slideId)) as TLFrameShape | undefined;
    if (!frame) throw new Error(`Slide not found: "${slideId}". Call list_canvas_shapes to get valid frame IDs.`);
    const fw = (frame.props as { w: number }).w ?? SLIDE_W;
    const fh = (frame.props as { h: number }).h ?? SLIDE_H;
    const textColorRaw = cmd.text_color ? String(cmd.text_color).trim() : '';
    const geoColorRaw  = cmd.geo_color  ? String(cmd.geo_color).trim()  : textColorRaw;
    if (!textColorRaw && !geoColorRaw)
      throw new Error('recolor_slide requires at least "text_color" or "geo_color".');

    const children = existing.filter((s) => s.parentId === frame.id && !isBgShape(s, fw, fh));
    let total = 0;

    if (textColorRaw) {
      const cls = mapColor(textColorRaw, 'black');
      for (const s of children.filter((cs) => ['note', 'text', 'arrow'].includes(cs.type))) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.updateShapes([{ id: s.id, type: s.type, props: { color: cls } } as any]);
        total++;
      }
    }
    if (geoColorRaw) {
      const gc = mapColor(geoColorRaw, 'blue');
      for (const s of children.filter((cs) => cs.type === 'geo')) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.updateShapes([{ id: s.id, type: s.type, props: { color: gc } } as any]);
        total++;
      }
    }
    return { count: total, shapeId: null };
  }

  // ── duplicate_slide ───────────────────────────────────────────
  if (op === 'duplicate_slide') {
    const srcSuffix = String(cmd.slide ?? '').trim();
    if (!srcSuffix) throw new Error('duplicate_slide requires a "slide" field (last-10-char frame ID). Call list_canvas_shapes to get the ID.');
    const srcFrame = existing.find((s) => s.type === 'frame' && s.id.endsWith(srcSuffix)) as TLFrameShape | undefined;
    if (!srcFrame) throw new Error(`Slide not found: "${srcSuffix}". Call list_canvas_shapes to get valid frame IDs.`);

    const frames = existing
      .filter((s) => s.type === 'frame')
      .sort((a, b) => (a as TLFrameShape).x - (b as TLFrameShape).x) as TLFrameShape[];
    const last = frames[frames.length - 1];
    const newX = last.x + (last.props.w ?? SLIDE_W) + SLIDE_GAP;
    const newY = Math.min(...frames.map((f) => f.y));

    const fw = (srcFrame.props as { w: number }).w ?? SLIDE_W;
    const fh = (srcFrame.props as { h: number }).h ?? SLIDE_H;
    const newName = String(cmd.name ?? srcFrame.props.name ?? `Slide ${frames.length + 1}`);
    const newFrameId = createShapeId();
    editor.createShapes<TLFrameShape>([{
      id: newFrameId, type: 'frame', x: newX, y: newY,
      props: { w: fw, h: fh, name: newName },
    }]);

    const children = existing.filter((s) => s.parentId === srcFrame.id);
    const bgChildren      = children.filter((s) =>  isBgShape(s, fw, fh));
    const contentChildren = children.filter((s) => !isBgShape(s, fw, fh));

    let copied = 0;

    const copyChild = (child: typeof children[0]) => {
      const cp = child.props as Record<string, unknown>;
      if (child.type === 'note') {
        editor.createShapes<TLNoteShape>([{
          id: createShapeId(), type: 'note',
          parentId: newFrameId, x: child.x, y: child.y,
          props: {
            richText: cp.richText as TLRichText ?? toRichText(''),
            color: (cp.color as TLColor) ?? 'yellow',
          },
        }]);
        copied++;
      } else if (child.type === 'text') {
        editor.createShapes<TLTextShape>([{
          id: createShapeId(), type: 'text',
          parentId: newFrameId, x: child.x, y: child.y,
          props: {
            richText: cp.richText as TLRichText ?? toRichText(''),
            color: (cp.color as TLColor) ?? 'black',
            autoSize: (cp.autoSize as boolean) ?? true,
            w: safeCoord(cp.w, 200),
            scale: safeCoord(cp.scale, 1),
          },
        }]);
        copied++;
      } else if (child.type === 'geo') {
        const childIsBg = isBgShape(child, fw, fh);
        const geoId = createShapeId();
        editor.createShapes<TLGeoShape>([{
          id: geoId, type: 'geo',
          meta: childIsBg ? { isBg: true } : {},
          parentId: newFrameId, x: child.x, y: child.y,
          props: {
            geo: (cp.geo as TLGeoShapeGeoStyle) ?? 'rectangle',
            w: safeCoord(cp.w, 200), h: safeCoord(cp.h, 120),
            richText: cp.richText as TLRichText ?? toRichText(''),
            color: (cp.color as TLColor) ?? 'blue',
            fill: mapFill(cp.fill),
            scale: 1,
          },
        }]);
        if (childIsBg) { try { editor.sendToBack([geoId as TLShapeId]); } catch { /* older tldraw */ } }
        copied++;
      } else if (child.type === 'arrow') {
        const ap = cp as { start?: { x: number; y: number }; end?: { x: number; y: number }; richText?: TLRichText; color?: string; arrowheadEnd?: string; arrowheadStart?: string };
        editor.createShapes<TLArrowShape>([{
          id: createShapeId(), type: 'arrow',
          parentId: newFrameId, x: child.x, y: child.y,
          props: {
            start: ap.start ?? { x: 0, y: 0 },
            end: ap.end   ?? { x: 200, y: 0 },
            richText: ap.richText ?? toRichText(''),
            color: mapColor(ap.color, 'grey'),
            arrowheadEnd: (ap.arrowheadEnd as TLArrowShape['props']['arrowheadEnd'])   ?? 'arrow',
            arrowheadStart: (ap.arrowheadStart as TLArrowShape['props']['arrowheadStart']) ?? 'none',
          } as TLArrowShape['props'],
        }]);
        copied++;
      } else if (child.type === 'image') {
        const imgP = cp as { assetId?: string; w?: number; h?: number };
        let srcUrl = '';
        if (imgP.assetId) {
          try {
            const asset = editor.getAsset(imgP.assetId as Parameters<Editor['getAsset']>[0]) as { props?: { src?: string } } | undefined;
            srcUrl = asset?.props?.src ?? '';
          } catch { /* ignore */ }
        }
        if (srcUrl) {
          const imgW = safeCoord(imgP.w, fw);
          const imgH = safeCoord(imgP.h, fh);
          const childIsBg = isBgShape(child, fw, fh);
          const imgName = srcUrl.split('/').pop()?.split('?')[0] ?? 'image';
          const imgId = _createImageShape(editor, srcUrl, imgName, child.x, child.y, imgW, imgH, newFrameId, childIsBg);
          if (childIsBg) { try { editor.sendToBack([imgId as TLShapeId]); } catch { /* older tldraw */ } }
          copied++;
        }
      }
    };

    for (const bg      of bgChildren)      { try { copyChild(bg);      } catch { /* skip */ } }
    for (const content of contentChildren) { try { copyChild(content); } catch { /* skip */ } }

    // Final z-order fix: ensure ALL bg shapes in the new frame are behind content.
    const newBgs = editor.getCurrentPageShapes().filter(
      (s) => s.parentId === newFrameId && isBgShape(s, fw, fh),
    );
    for (const bg of newBgs) { _sendBgToBack(editor, bg.id, newFrameId); }

    return { count: 1 + copied, shapeId: newFrameId };
  }

  return { count: 0, shapeId: null };
}

// ── Shared image-placement helper (used by useCanvasDrop + AI tools) ─────────

/**
 * Create a tldraw image asset + shape in a single call.
 *
 * Placement priority (first wins):
 *   1. `opts.x` / `opts.y`       — explicit top-left page coords (AI tool semantics)
 *   2. `opts.dropX` / `opts.dropY` — mouse-drop page center (drag-drop semantics)
 *   3. No coords                 — center in the current viewport
 *
 * `opts.width` overrides the default display width (capped at 800 px otherwise).
 */
export interface PlaceImageOpts {
  /** Explicit top-left page X (AI / direct placement). */
  x?: number;
  /** Explicit top-left page Y. */
  y?: number;
  /** Mouse-drop page center X (shape will be centered on this point). */
  dropX?: number;
  /** Mouse-drop page center Y. */
  dropY?: number;
  /** Override display width in pixels. */
  width?: number;
}

export function placeImageOnCanvas(
  editor: Editor,
  src: string,
  name: string,
  mimeType: string,
  natW: number,
  natH: number,
  opts: PlaceImageOpts = {},
): { x: number; y: number; w: number; h: number } {
  const maxW = 800;
  const desiredW = typeof opts.width === 'number' ? opts.width : Math.min(natW, maxW);
  const scale = natW > 0 ? desiredW / natW : 1;
  const dispW = Math.round(desiredW);
  const dispH = Math.round(natH * scale);

  let px: number, py: number;
  if (opts.x !== undefined && opts.y !== undefined) {
    px = Math.round(opts.x);
    py = Math.round(opts.y);
  } else if (opts.dropX !== undefined && opts.dropY !== undefined) {
    px = Math.round(opts.dropX - dispW / 2);
    py = Math.round(opts.dropY - dispH / 2);
  } else {
    const vp = editor.getViewportPageBounds();
    px = Math.round(vp.x + vp.w / 2 - dispW / 2);
    py = Math.round(vp.y + vp.h / 2 - dispH / 2);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assetId = `asset:${crypto.randomUUID()}` as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor.createAssets([{ id: assetId, typeName: 'asset', type: 'image', props: { name, src, w: natW, h: natH, mimeType, isAnimated: mimeType === 'image/gif' }, meta: {} } as any]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor.createShape({ type: 'image', x: px, y: py, props: { assetId, w: dispW, h: dispH, playing: true, url: '', crop: null, flipX: false, flipY: false, altText: '' } as any });
  return { x: px, y: py, w: dispW, h: dispH };
}
