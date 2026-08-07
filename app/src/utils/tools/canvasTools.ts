/**
 * Canvas workspace tools: list shapes, execute canvas operations, take
 * canvas/preview screenshots, and place images on the canvas.
 */

import { readTextFile } from '../../services/fs';
import {
  executeCanvasCommands,
  canvasToDataUrl,
  compressDataUrl,
  summarizeCanvas,
  placeImageOnCanvas,
} from '../canvasAI';
import { renderHtmlOffscreen } from '../htmlPreview';
import { lockFile, unlockFile } from '../../services/copilotLock';
import { getMimeType } from '../mime';
import { getCanvasEditor, ensureCanvasTabOpen, setCopilotOverlay } from '../canvasRegistry';
import type { ToolDefinition, DomainExecutor } from './shared';

// ── Tool definitions ─────────────────────────────────────────────────────────

export const CANVAS_TOOL_DEFS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_canvas_shapes',
      description:
        'List all shapes on a canvas. Pass expected_file to inspect a specific .tldr.json file even if it is not the active tab — the tool will open/switch to it if needed. ' +
        "Returns the canvas filename first (so you can verify you are editing the correct file), then each shape's short ID (last 10 chars), type, position, size, color, fill, and text content. Arrow shapes include their start/end coordinates. Call this before update, move, or delete operations to get valid shape IDs.",
      parameters: {
        type: 'object',
        properties: {
          expected_file: {
            type: 'string',
            description: 'Optional relative workspace path of the canvas file to inspect, e.g. "aulas/Aula-02.tldr.json". The tool will switch to that tab if needed.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'canvas_op',
      description:
        'Create, update, move, or delete shapes on a canvas (.tldr.json file). You MUST pass expected_file with the relative path of the canvas you intend to edit (e.g. "aulas/Aula-02.tldr.json") — the tool will automatically switch to that tab if needed. Call list_canvas_shapes first if the user wants to modify existing shapes — you need the IDs.',
      parameters: {
        type: 'object',
        properties: {
          expected_file: {
            type: 'string',
            description: 'Relative workspace path of the canvas file you intend to edit, e.g. "aulas/Aula-02.tldr.json". Must match the currently open tab — the tool will return an error if it does not, so the user knows to switch files before proceeding.',
          },
          commands: {
            type: 'string',
            description: [
              'Newline-separated JSON command objects. Core op signatures:',
              '  {"op":"add_slide","name":"Slide title"}',
              '  {"op":"duplicate_slide","slide":"<id>","name":"Slide 2"}   ← copy slide + ALL content',
              '  {"op":"add_note","text":"…","x":100,"y":100,"color":"yellow","size":"m","font":"sans","align":"middle","slide":"<id>"}',
              '  {"op":"add_text","text":"…","x":100,"y":200,"color":"black","size":"xl","font":"sans","align":"start","slide":"<id>"}',
              '  {"op":"add_geo","geo":"rectangle","text":"Label","x":100,"y":100,"w":200,"h":120,"color":"blue","fill":"solid","size":"m","font":"sans","align":"middle","slide":"<id>"}',
              '  {"op":"add_arrow","x1":100,"y1":150,"x2":400,"y2":150,"label":"depends on","color":"grey"}',
              '  {"op":"add_image","url":"https://…","x":0,"y":0,"w":800,"h":450,"slide":"<id>","to_back":true}',
              '  {"op":"set_slide_background","url":"https://…","slide":"<id>"}  or {"op":"set_slide_background","color":"blue","slide":"<id>"}',
              '  {"op":"copy_slide_background","from_slide":"<id>","to_slides":["<id>",…]}',
              '  {"op":"apply_theme","bg_color":"black","text_color":"white","to_slides":"all"}   ← batch recolor/theme (fields each optional)',
              '  {"op":"recolor_slide","slide":"<id>","text_color":"white","geo_color":"light-blue"}   ← geo_color defaults to text_color',
              '  {"op":"move","id":"<shapeId>","x":300,"y":400}',
              '  {"op":"update","id":"<shapeId>","text":"New","color":"red","fill":"solid","size":"l","font":"sans","align":"start"}   ← fields optional; also renames frames',
              '  {"op":"delete","id":"<shapeId>"}',
              '  {"op":"clear","confirm":"yes"}   ← DANGER: wipes ALL shapes; only if the user explicitly asks',
              '  {"op":"add_bullet_list","slide":"<id>","header":"…","items":["Item 1","Item 2"],"y_start":80,"item_color":"yellow","pitch":90}',
              '  {"op":"add_card_list","slide":"<id>","title":"…","cards":[{"text":"…","color":"yellow"}],"cols":1}   ← THE op for colorful teaching slides',
              '  {"op":"add_two_col","slide":"<id>","header":"Comparação","left_title":"…","left_items":["…"],"right_title":"…","right_items":["…"],"y_start":40}',
              '  {"op":"create_lesson","slides":[{"type":"title|bullet-list|two-col|timeline|closing",…}]}   ← simple outline decks',
              '',
              'RULES: Always include "slide":"<frameId>" on add_* to parent a shape inside a frame (else it floats ungrouped).',
              'With "slide", x/y are PARENT-RELATIVE (0,0 = frame top-left; frame is 1280×720).',
              'Slide frame IDs = last 10 chars from list_canvas_shapes.',
              'Colors: yellow, blue, green, red, orange, violet, grey, black, white, light-blue, light-violet.',
              'Sizes: s|m|l|xl — Fonts: sans|serif|draw|mono — Align: start|middle|end.',
              'Geo: rectangle|ellipse|triangle|diamond|hexagon|cloud|star|arrow-right.',
              'Safe area: x 80–1200, y 20–680. 2 columns: left x=80 w=540, right x=660 w=540.',
              'For rich high-level ops (add_card_list / add_two_col / apply_theme / create_lesson) read the FULL reference with worked JSON examples:',
              '  CALL read_skill name="canvas" first (it also gives workflow tips for lesson decks) — reuse slides with duplicate_slide, not manual recreation.',
            ].join('\n'),
          },
        },
        required: ['expected_file', 'commands'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'canvas_screenshot',
      description:
        'Take a PNG screenshot of the current canvas and inject it into the conversation as a visual image. ' +
        'Call this ONCE after completing all canvas_op modifications to visually verify the result looks correct. ' +
        'This is your only way to see what the canvas actually looks like — use it to catch layout issues, overlapping shapes, or wrong colors before replying to the user. ' +
        'Do NOT call this repeatedly — one visual check per interaction.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'screenshot_preview',
      description:
        'Capture a screenshot of the live HTML/CSS preview pane and inject it as a vision image so you can ' +
        'visually verify layout, spacing, typography, and interactive element positioning. ' +
        'ALWAYS call this after writing or patching an HTML or CSS file to check the rendered result. ' +
        'Use it iteratively: write → screenshot → spot issues → patch → screenshot again until the layout is correct. ' +
        'Works in both preview mode and editor mode whenever an HTML file is active.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_canvas_image',
      description:
        'Fetch an image from a URL and place it as a free-floating image shape on the canvas PAGE (not inside any slide). ' +
        'Use this only when the user wants an image outside all slides. ' +
        'IMPORTANT: if you want to place an image INSIDE a slide (with a slide: field), use canvas_op with add_image or set_slide_background instead. ' +
        'Optionally specify x/y position (page coordinates). Defaults to the current viewport center.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The full image URL (https://…). Supported: jpg, png, gif, webp, svg.',
          },
          x: {
            type: 'number',
            description: 'X position on the canvas page (optional — defaults to viewport center).',
          },
          y: {
            type: 'number',
            description: 'Y position on the canvas page (optional — defaults to viewport center).',
          },
          width: {
            type: 'number',
            description: 'Desired display width in pixels (optional — defaults to natural image width, capped at 800px).',
          },
        },
        required: ['url'],
      },
    },
  },
];

// ── Executor ─────────────────────────────────────────────────────────────────

export const executeCanvasTools: DomainExecutor = async (name, args, ctx) => {
  const { canvasEditor, activeFile, webPreviewRef, onCanvasModified, getActiveHtml } = ctx;

  switch (name) {

    // ── list_canvas_shapes ──────────────────────────────────────────────
    case 'list_canvas_shapes': {
      const expectedFile = String(args.expected_file ?? '').trim();
      if (expectedFile) {
        try {
          await ensureCanvasTabOpen(expectedFile);
        } catch (e) {
          return `Error opening canvas tab "${expectedFile}": ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      const targetFile = expectedFile || activeFile || '';
      const regEditor = targetFile ? getCanvasEditor(targetFile) : undefined;
      const editor = regEditor ?? (!targetFile ? canvasEditor.current : null);
      if (!editor) {
        if (expectedFile) {
          return `Error: canvas editor for "${expectedFile}" is not mounted. ` +
            'Make sure the file exists and was created as a canvas, then try again.';
        }
        return 'No canvas is currently open. Ask the user to open a .tldr.json canvas file first.';
      }
      // Always prefix with the canvas file so the AI can verify it is editing the right file.
      const fileHeader = targetFile ? `Canvas file: ${targetFile}` : '';
      const summary = summarizeCanvas(editor);
      return fileHeader ? `${fileHeader}\n${summary}` : summary;
    }

    // ── canvas_op ───────────────────────────────────────────────────────
    case 'canvas_op': {
      // Show overlay and auto-switch to the target canvas tab if needed
      const expectedFile = String(args.expected_file ?? '').trim();
      setCopilotOverlay(true);
      try {
        if (expectedFile) await ensureCanvasTabOpen(expectedFile);
      } catch (e) {
        setCopilotOverlay(false);
        return `Error opening canvas tab "${expectedFile}": ${e instanceof Error ? e.message : String(e)}`;
      }
      // Resolve editor: prefer registry lookup for the target file.
      // IMPORTANT: when expectedFile is set, NEVER fall back to canvasEditor.current —
      // that would silently edit the wrong (previously open) canvas.
      const targetFile = expectedFile || (activeFile ?? '');
      const editor = targetFile ? getCanvasEditor(targetFile) : canvasEditor.current;
      if (!editor) {
        setCopilotOverlay(false);
        if (expectedFile) {
          return `Error: canvas editor for "${expectedFile}" is not mounted. ` +
            `Make sure the file exists and was created with scaffold_workspace before calling canvas_op. ` +
            `If it was just created, try calling canvas_op again — the tab may still be loading.`;
        }
        return 'No canvas is currently open. Ask the user to open a .tldr.json canvas file first.';
      }

      const rawCommands = String(args.commands ?? '');
      const stripped = rawCommands
        .replace(/^```canvas\r?\n/, '')
        .replace(/\n```\s*$/, '');
      const fenced = '```canvas\n' + stripped + '\n```';
      if (targetFile) lockFile(targetFile, ctx.agentId);
      await new Promise<void>((r) => setTimeout(r, 0));
      let count = 0;
      let shapeIds: string[] = [];
      let errors: string[] = [];
      try {
        // Snapshot every shape on the current page BEFORE the batch so reject
        // can restore pre-edit state instead of deleting AI-created shapes.
        const beforeShapes = new Map(
          editor.getCurrentPageShapes().map((s) => [s.id, structuredClone(s)]),
        );
        ({ count, shapeIds, errors } = executeCanvasCommands(editor, fenced));
        if (count > 0 && shapeIds.length > 0) {
          const canvasRevert: Record<string, unknown | null> = {};
          for (const sid of shapeIds) {
            canvasRevert[sid] = beforeShapes.has(sid as never) ? beforeShapes.get(sid as never) ?? null : null;
          }
          onCanvasModified?.(shapeIds, canvasRevert);
        } else {
          onCanvasModified?.(shapeIds);
        }
      } finally {
        if (targetFile) unlockFile(targetFile);
        setCopilotOverlay(false);
      }
      if (count === 0) {
        if (errors.length > 0) {
          return `Canvas operation failed — all changes rolled back. ${errors.length} error(s): ${errors.join('; ')}`;
        }
        return `No commands were executed. Check the command syntax.`;
      }
      const fileTag = targetFile ? ` on ${targetFile.split('/').pop()}` : '';
      return `Executed ${count} canvas operation(s) successfully${fileTag}.`;
    }

    // ── canvas_screenshot ───────────────────────────────────────────────
    case 'canvas_screenshot': {
      const editor = canvasEditor.current;
      if (!editor) return 'No canvas is currently open. Ask the user to open a .tldr.json canvas file first.';
      const url = await canvasToDataUrl(editor, 0.5);
      if (!url) return 'Canvas is empty — nothing to screenshot.';
      // 320px wide, 0.55 quality — keeps a photographic canvas background under ~50 KB
      const compressed = await compressDataUrl(url, 320, 0.55);
      return `__CANVAS_PNG__:${compressed}`;
    }

    // ── screenshot_preview ──────────────────────────────────────────────
    case 'screenshot_preview': {
      const activeHtml = getActiveHtml?.();
      if (activeHtml) {
        let freshHtml: string;
        try {
          freshHtml = await readTextFile(activeHtml.absPath);
        } catch {
          freshHtml = activeHtml.html;
        }
        const offscreenUrl = await renderHtmlOffscreen(freshHtml, activeHtml.absPath);
        if (offscreenUrl) {
          const compressed = await compressDataUrl(offscreenUrl, 320, 0.55);
          return `__PREVIEW_PNG__:${compressed}`;
        }
      }

      if (webPreviewRef?.current) {
        const url = await webPreviewRef.current.getScreenshot();
        if (url) {
          const compressed = await compressDataUrl(url, 320, 0.55);
          return `__PREVIEW_PNG__:${compressed}`;
        }
      }

      return 'No HTML preview is available. Open an HTML file and try again.';
    }

    // ── add_canvas_image ────────────────────────────────────────────────
    case 'add_canvas_image': {
      const editor = canvasEditor.current;
      if (!editor) return 'No canvas is currently open. Ask the user to open a .tldr.json canvas file first.';

      const imgUrl = String(args.url ?? '').trim();
      if (!imgUrl) return 'Error: url is required.';

      const ext = imgUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? 'png';
      const mimeType = getMimeType(ext, 'image/png');

      let natW = 800;
      let natH = 600;
      try {
        await new Promise<void>((resolve) => {
          const img = new Image();
          const timeout = setTimeout(resolve, 10_000); // 10s timeout — unreachable URLs hang forever otherwise
          img.onload = () => { clearTimeout(timeout); natW = img.naturalWidth || 800; natH = img.naturalHeight || 600; resolve(); };
          img.onerror = () => { clearTimeout(timeout); resolve(); };
          img.src = imgUrl;
        });
      } catch { /* use defaults */ }

      const imgName = imgUrl.split('/').pop()?.split('?')[0] ?? 'image';
      const placed = placeImageOnCanvas(editor, imgUrl, imgName, mimeType, natW, natH, {
        x: typeof args.x === 'number' ? args.x : undefined,
        y: typeof args.y === 'number' ? args.y : undefined,
        width: typeof args.width === 'number' ? args.width : undefined,
      });

      return `Image added to canvas at (${placed.x}, ${placed.y}) with size ${placed.w}×${placed.h}px. Source: ${imgUrl}`;
    }

    default:
      return null;
  }
};
