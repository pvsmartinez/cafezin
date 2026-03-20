/**
 * canvasAISnapshot.ts
 *
 * Two concerns:
 *  1. Rich-text helpers — converts raw strings (with Markdown inline formatting)
 *     to the TLRichText structure that tldraw v4 expects.
 *  2. Snapshot sanitizer — repairs known schema violations in tldraw snapshots
 *     so tldraw v4.4+ doesn't throw ValidationErrors when loading older or
 *     AI-generated canvas files.
 *
 * Consumers: CanvasEditor, canvasAICommands, useCanvasFrameOps.
 */

import type { TLRichText, TLEditorSnapshot } from 'tldraw';
import { toRichText, createTLSchema } from 'tldraw';

// ── Markdown-aware richText builder ─────────────────────────────────────────

type _RichTextMark = { type: 'bold' } | { type: 'italic' } | { type: 'strike' };
type _RichTextTextNode = { type: 'text'; text: string; marks?: _RichTextMark[] };

function _parseInlineMd(line: string): _RichTextTextNode[] {
  const result: _RichTextTextNode[] = [];
  // order: ~~strike~~ before *italic* to avoid partial greedy match
  const pattern = /(~~)([\s\S]*?)\1|((?:\*\*|__))([\s\S]*?)\3|((?:\*|_))([\s\S]*?)\5/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(line)) !== null) {
    if (m.index > lastIdx) result.push({ type: 'text', text: line.slice(lastIdx, m.index) });
    if (m[1] !== undefined)      result.push({ type: 'text', text: m[2], marks: [{ type: 'strike'   }] });
    else if (m[3] !== undefined) result.push({ type: 'text', text: m[4], marks: [{ type: 'bold'     }] });
    else if (m[5] !== undefined) result.push({ type: 'text', text: m[6], marks: [{ type: 'italic'   }] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < line.length) result.push({ type: 'text', text: line.slice(lastIdx) });
  return result.length > 0 ? result : [{ type: 'text', text: '' }];
}

/**
 * Like tldraw's `toRichText()` but also parses Markdown inline formatting:
 *   **bold** / __bold__ → bold mark
 *   *italic* / _italic_ → italic mark
 *   ~~text~~            → strikethrough mark
 * Use for all user-visible text coming from AI canvas commands.
 */
export function toRichTextMd(raw: string): TLRichText {
  if (!raw) return toRichText('');
  const paragraphs = raw.split('\n').map((line) =>
    line
      ? { type: 'paragraph', content: _parseInlineMd(line) }
      : { type: 'paragraph' }
  );
  return { type: 'doc', content: paragraphs } as unknown as TLRichText;
}

// ── Lazy-cached current tldraw schema (sequences + versions) ────────────────
// Used by sanitizeSnapshot to clamp out-of-range sequence versions in
// AI-generated or externally-produced canvas files.
let _tlSerializedSchema: Record<string, number> | null = null;
function getTLSequences(): Record<string, number> {
  // Only cache on success — if createTLSchema() throws, return {} without
  // caching so the next call retries. Caching {} would make sanitizeSnapshot
  // treat EVERY sequence in a valid file as "unknown" and delete them,
  // silently corrupting the file.
  if (_tlSerializedSchema !== null) return _tlSerializedSchema;
  try {
    const s = createTLSchema().serialize() as { schemaVersion: number; sequences: Record<string, number> };
    _tlSerializedSchema = s.sequences ?? {};
    return _tlSerializedSchema;
  } catch {
    return {}; // don't cache — retry on next call
  }
}

// ── Snapshot sanitizer ───────────────────────────────────────────────────────

/** Minimal richText shape: `{ type: string, content: unknown[] }` */
function isValidRichText(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const rt = v as Record<string, unknown>;
  return typeof rt['type'] === 'string' && Array.isArray(rt['content']);
}

const RICH_TEXT_SHAPE_TYPES = new Set(['geo', 'note', 'arrow', 'text']);
const SCALE_SHAPE_TYPES      = new Set(['geo', 'note', 'arrow', 'line']);

/**
 * Repairs known schema violations in a raw tldraw snapshot so tldraw v4.4+
 * doesn't throw ValidationErrors or migration-errors when loading older or
 * AI-generated canvas files.
 *
 * Strategy: Rather than replacing the schema (which would prevent tldraw's own
 * migrations from running), we manually apply the same repairs that tldraw's
 * migrations would apply.  This way files persisted with an old schema get fixed
 * in-memory before tldraw sees them, so migrateStoreSnapshot → put → validateRecord
 * sees only valid records and never throws.
 *
 * Repairs applied per shape type:
 *  geo / note / arrow / text (`richTextTypes`):
 *    • `props.text` (string, pre-richText era) → converted to `props.richText` object
 *    • `props.richText` missing              → created from `props.text ?? ""`
 *    • `props.richText` malformed            → re-created via toRichText()
 *    • `props.richText.attrs`                → stripped (rejected by validator)
 *  geo / note / arrow / line (`scaleTypes`):
 *    • `props.scale` missing / non-finite    → set to 1
 *
 * Returns the same object (mutates inline — the caller owns the freshly-parsed value).
 */
export function sanitizeSnapshot(raw: unknown): TLEditorSnapshot {
  if (!raw || typeof raw !== 'object') return raw as TLEditorSnapshot;
  const snap = raw as Record<string, unknown>;

  // Support both legacy TLStoreSnapshot ({ schema, store }) and new TLEditorSnapshot
  // ({ document: { schema, store } }).  Walk whichever store object is present.
  const storeObj =
    (snap.store && typeof snap.store === 'object')
      ? snap.store as Record<string, unknown>
      : (snap.document && typeof snap.document === 'object')
          ? ((snap.document as Record<string, unknown>).store as Record<string, unknown> | undefined)
          : undefined;

  if (!storeObj) return raw as TLEditorSnapshot;

  let patchCount = 0;

  for (const record of Object.values(storeObj)) {
    if (!record || typeof record !== 'object') continue;
    const r = record as Record<string, unknown>;
    if (r.typeName !== 'shape') continue;

    const props = r.props;
    if (!props || typeof props !== 'object') continue;
    const p = props as Record<string, unknown>;

    // ── richText repair ───────────────────────────────────────────────────
    if (RICH_TEXT_SHAPE_TYPES.has(r.type as string)) {
      if (!isValidRichText(p.richText)) {
        // Old format: `text` was a plain string.
        const plainText = typeof p.text === 'string' ? p.text : '';
        p.richText = toRichText(plainText);
        patchCount++;
      }
      // Strip `attrs` from richText root — tldraw v4.4 validator rejects it.
      if (p.richText && typeof p.richText === 'object') {
        const rt = p.richText as Record<string, unknown>;
        if ('attrs' in rt) { delete rt['attrs']; patchCount++; }
      }
      // Remove legacy `text` prop if richText is now present (avoids unknown-prop errors).
      if ('text' in p && isValidRichText(p.richText)) { delete p['text']; }
    }

    // ── scale repair ─────────────────────────────────────────────────────
    if (SCALE_SHAPE_TYPES.has(r.type as string)) {
      if (typeof p.scale !== 'number' || !Number.isFinite(p.scale as number) || p.scale === 0) {
        p.scale = 1;
        patchCount++;
      }
    }
  }

  // ── Schema sequence version clamp ────────────────────────────────────────
  // If any sequence version in the snapshot is NEWER than what the running
  // tldraw build knows, migrateStoreSnapshot throws "migration-error".
  // Clamp each sequence down to the installed tldraw version so it can load
  // cleanly. Under-versioned sequences are left alone so forward migrations
  // still run. Unknown sequences are removed entirely (AI hallucinated types).
  try {
    const currentSeqs = getTLSequences();
    const schemaBlocks: Record<string, unknown>[] = [];
    if (snap.schema && typeof snap.schema === 'object')
      schemaBlocks.push(snap.schema as Record<string, unknown>);
    if (snap.document && typeof snap.document === 'object') {
      const doc = snap.document as Record<string, unknown>;
      if (doc.schema && typeof doc.schema === 'object')
        schemaBlocks.push(doc.schema as Record<string, unknown>);
    }
    // Guard: if currentSeqs is empty (schema init failed), skip entirely.
    if (Object.keys(currentSeqs).length === 0) {
      // eslint-disable-next-line no-console
      console.warn('[canvasAI] sanitizeSnapshot: schema sequences unavailable — skipping version clamp');
    } else {
      for (const schemaObj of schemaBlocks) {
        const seqs = schemaObj['sequences'];
        if (!seqs || typeof seqs !== 'object') continue;
        for (const key of Object.keys(seqs)) {
          const storedVer = (seqs as Record<string, number>)[key];
          const knownVer  = currentSeqs[key];
          if (knownVer == null) {
            // Unknown sequence type (AI hallucination) — remove it.
            delete (seqs as Record<string, unknown>)[key];
            patchCount++;
          } else if (typeof storedVer === 'number' && storedVer > knownVer) {
            // Sequence version too new — clamp to current so no TargetVersionTooNew error.
            (seqs as Record<string, number>)[key] = knownVer;
            patchCount++;
          }
        }
      }
    }
  } catch (schemaErr) {
    // eslint-disable-next-line no-console
    console.warn('[canvasAI] sanitizeSnapshot: schema normalization failed (non-fatal):', schemaErr);
  }

  if (patchCount > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[canvasAI] sanitizeSnapshot: repaired ${patchCount} prop(s) in snapshot`);
  }
  return raw as TLEditorSnapshot;
}
