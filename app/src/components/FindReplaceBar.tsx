/**
 * FindReplaceBar — floating Ctrl+F bar that appears at the top of the editor area.
 *
 * For text/code files (CodeMirror): uses @codemirror/search SearchQuery API.
 * For markdown files (Tiptap): searches document text directly via ProseMirror.
 * For canvas files (tldraw): searches shape text and zooms between matches.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { X, ArrowUp, ArrowDown, CaretDown, CaretRight } from '@phosphor-icons/react';
import {
  SearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  RegExpCursor,
} from '@codemirror/search';
import { SearchCursor } from '@codemirror/search';
import type { EditorHandle } from './Editor';
import type { Editor as TiptapEditor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Editor as TldrawEditor, TLShape } from 'tldraw';
import './FindReplaceBar.css';

export interface FindReplaceBarProps {
  /** Whether the bar is visible */
  open: boolean;
  onClose: () => void;
  /** CodeMirror editor ref — present when a text/code file is open */
  editorRef?: React.RefObject<EditorHandle | null>;
  /** tldraw editor — present when a canvas is open */
  canvasEditor?: TldrawEditor | null;
  /** 'editor' | 'canvas' | null */
  fileKind?: string | null;
}

// ── Canvas helpers ────────────────────────────────────────────────────────────
function canvasMatches(
  editor: TldrawEditor,
  needle: string,
  caseSensitive: boolean,
): TLShape[] {
  if (!needle) return [];
  const shapes = editor.getCurrentPageShapes();
  return shapes.filter((s) => {
    const text = (s.props as Record<string, unknown>).text as string | undefined;
    if (!text) return false;
    return caseSensitive
      ? text.includes(needle)
      : text.toLowerCase().includes(needle.toLowerCase());
  });
}

function zoomToShape(editor: TldrawEditor, shape: TLShape) {
  const bounds = editor.getShapePageBounds(shape.id);
  if (!bounds) return;
  editor.zoomToBounds(bounds, { animation: { duration: 200 }, inset: 80 });
  editor.select(shape.id);
}

// ── Tiptap search helpers ─────────────────────────────────────────────────────

/** Convert a plain-text character offset into a ProseMirror document position. */
function tiptapCharToPos(doc: PMNode, charOffset: number): number {
  let chars = 0;
  let result = -1;
  doc.descendants((node, pos) => {
    if (result !== -1) return false;
    if (!node.isText) return undefined;
    const len = node.text!.length;
    if (chars + len > charOffset) { result = pos + (charOffset - chars); return false; }
    chars += len;
    return undefined;
  });
  if (result === -1 && charOffset === chars) result = doc.content.size;
  return result;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findAllInTiptap(
  editor: TiptapEditor,
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  useRegex: boolean,
): Array<{ from: number; to: number }> {
  if (!query) return [];
  const doc = editor.state.doc;
  const docText = doc.textContent;

  let pattern = useRegex ? query : escapeRegex(query);
  if (wholeWord) pattern = `\\b${pattern}\\b`;
  let regex: RegExp;
  try { regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi'); }
  catch { return []; }

  const results: Array<{ from: number; to: number }> = [];
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = regex.exec(docText)) !== null) {
    const from = tiptapCharToPos(doc, m.index);
    const to   = tiptapCharToPos(doc, m.index + m[0].length);
    if (from !== -1 && to !== -1) results.push({ from, to });
  }
  return results;
}

function highlightTiptapMatch(
  editor: TiptapEditor,
  match: { from: number; to: number },
) {
  editor.commands.setTextSelection(match);
  try {
    const dom = editor.view.domAtPos(match.from);
    const el = (dom.node as Element).nodeType === 1
      ? dom.node as Element
      : (dom.node as Element).parentElement;
    el?.scrollIntoView({ block: 'nearest' });
  } catch { /* ignore */ }
}

// ── Match count helper for CodeMirror ─────────────────────────────────────────
function countCMMatches(
  view: ReturnType<EditorHandle['getView']>,
  query: SearchQuery,
): number {
  if (!view || !query.search) return 0;
  const doc = view.state.doc;
  let n = 0;
  if (query.regexp) {
    try {
      const c = new RegExpCursor(doc, query.search, { ignoreCase: !query.caseSensitive });
      while (!c.next().done) n++;
    } catch { /* invalid regex */ }
  } else {
    const norm = query.caseSensitive ? undefined : (s: string) => s.toLowerCase();
    const c = new SearchCursor(doc, query.search, 0, doc.length, norm);
    while (!c.next().done) n++;
  }
  return n;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function FindReplaceBar({
  open,
  onClose,
  editorRef,
  canvasEditor,
  fileKind,
}: FindReplaceBarProps) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [showReplace, setShowReplace] = useState(false);

  // Canvas navigation state
  const [canvasMatchIdx, setCanvasMatchIdx] = useState(0);
  const [canvasMatchCount, setCanvasMatchCount] = useState(0);
  const [cmMatchCount, setCmMatchCount] = useState(0);
  // Tiptap navigation state
  const [tiptapMatchIdx, setTiptapMatchIdx] = useState(0);
  const [tiptapMatches, setTiptapMatches] = useState<Array<{ from: number; to: number }>>([]);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // Focus search input when bar opens
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchInputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // Build and apply search query whenever query/options change
  const applyQuery = useCallback(() => {
    if (fileKind === 'canvas') return;

    // ── Tiptap path ──────────────────────────────────────────────────────────
    const tiptap = editorRef?.current?.getTiptapEditor?.();
    if (tiptap) {
      const matches = findAllInTiptap(tiptap, query, caseSensitive, wholeWord, useRegex);
      setTiptapMatches(matches);
      setTiptapMatchIdx(0);
      if (matches.length > 0) highlightTiptapMatch(tiptap, matches[0]);
      return;
    }

    // ── CodeMirror path ───────────────────────────────────────────────────────
    const view = editorRef?.current?.getView();
    if (!view) return;

    let searchStr = query;
    let isRegex = useRegex;

    // Whole-word: wrap in \b...\b as regex
    if (wholeWord && !useRegex && searchStr) {
      searchStr = `\\b${searchStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`;
      isRegex = true;
    }

    const sq = new SearchQuery({
      search: searchStr,
      caseSensitive,
      regexp: isRegex,
      replace: replacement,
    });

    view.dispatch({ effects: setSearchQuery.of(sq) });

    // Count matches
    if (query) {
      const count = countCMMatches(view, sq);
      setCmMatchCount(count);
    } else {
      setCmMatchCount(0);
    }
  }, [query, caseSensitive, useRegex, wholeWord, replacement, editorRef, fileKind]);

  // Recompute whenever query/options change
  useEffect(() => {
    applyQuery();
  }, [applyQuery]);

  // Canvas: recount matches when query/options/canvasEditor change
  useEffect(() => {
    if (fileKind !== 'canvas' || !canvasEditor) return;
    const matches = canvasMatches(canvasEditor, query, caseSensitive);
    setCanvasMatchCount(matches.length);
    setCanvasMatchIdx(0);
    if (matches.length > 0) zoomToShape(canvasEditor, matches[0]);
  }, [query, caseSensitive, canvasEditor, fileKind]);

  function handleFindNext() {
    if (fileKind === 'canvas') {
      if (!canvasEditor || canvasMatchCount === 0) return;
      const matches = canvasMatches(canvasEditor, query, caseSensitive);
      const idx = (canvasMatchIdx + 1) % matches.length;
      setCanvasMatchIdx(idx);
      zoomToShape(canvasEditor, matches[idx]);
      return;
    }
    const tiptap = editorRef?.current?.getTiptapEditor?.();
    if (tiptap) {
      if (tiptapMatches.length === 0) return;
      const idx = (tiptapMatchIdx + 1) % tiptapMatches.length;
      setTiptapMatchIdx(idx);
      highlightTiptapMatch(tiptap, tiptapMatches[idx]);
      return;
    }
    const view = editorRef?.current?.getView();
    if (!view) return;
    applyQuery();
    findNext(view);
  }

  function handleFindPrev() {
    if (fileKind === 'canvas') {
      if (!canvasEditor || canvasMatchCount === 0) return;
      const matches = canvasMatches(canvasEditor, query, caseSensitive);
      const idx = (canvasMatchIdx - 1 + matches.length) % matches.length;
      setCanvasMatchIdx(idx);
      zoomToShape(canvasEditor, matches[idx]);
      return;
    }
    const tiptap = editorRef?.current?.getTiptapEditor?.();
    if (tiptap) {
      if (tiptapMatches.length === 0) return;
      const idx = (tiptapMatchIdx - 1 + tiptapMatches.length) % tiptapMatches.length;
      setTiptapMatchIdx(idx);
      highlightTiptapMatch(tiptap, tiptapMatches[idx]);
      return;
    }
    const view = editorRef?.current?.getView();
    if (!view) return;
    applyQuery();
    findPrevious(view);
  }

  function handleReplaceOne() {
    const tiptap = editorRef?.current?.getTiptapEditor?.();
    if (tiptap) {
      if (tiptapMatches.length === 0 || !query) return;
      const match = tiptapMatches[tiptapMatchIdx];
      // Verify the selection still matches, then replace
      const matched = tiptap.state.doc.textBetween(match.from, match.to);
      const expected = useRegex
        ? new RegExp(query, caseSensitive ? '' : 'i').test(matched)
        : caseSensitive ? matched === query : matched.toLowerCase() === query.toLowerCase();
      if (expected) {
        tiptap.chain().setTextSelection(match).deleteSelection().insertContent(replacement).run();
      }
      // Recompute matches after change
      const newMatches = findAllInTiptap(tiptap, query, caseSensitive, wholeWord, useRegex);
      setTiptapMatches(newMatches);
      const idx = Math.min(tiptapMatchIdx, Math.max(0, newMatches.length - 1));
      setTiptapMatchIdx(idx);
      if (newMatches.length > 0) highlightTiptapMatch(tiptap, newMatches[idx]);
      return;
    }
    const view = editorRef?.current?.getView();
    if (!view || fileKind === 'canvas') return;
    applyQuery();
    replaceNext(view);
    applyQuery(); // recount after replace
  }

  function handleReplaceAll() {
    const tiptap = editorRef?.current?.getTiptapEditor?.();
    if (tiptap) {
      if (tiptapMatches.length === 0 || !query) return;
      // Replace from end to start to keep positions valid
      const sorted = [...tiptapMatches].reverse();
      for (const match of sorted) {
        tiptap.chain().setTextSelection(match).deleteSelection().insertContent(replacement).run();
      }
      setTiptapMatches([]);
      setTiptapMatchIdx(0);
      return;
    }
    const view = editorRef?.current?.getView();
    if (!view || fileKind === 'canvas') return;
    applyQuery();
    replaceAll(view);
    applyQuery(); // recount after replace
  }

  // Close on Escape anywhere in the bar
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handleClose();
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleFindNext();
    }
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      handleFindPrev();
    }
  }

  function handleClose() {
    // Clear CM highlight on close
    const view = editorRef?.current?.getView();
    if (view) {
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) });
    }
    // Clear Tiptap selection on close
    const tiptap = editorRef?.current?.getTiptapEditor?.();
    if (tiptap) {
      const pos = tiptap.state.selection.from;
      tiptap.commands.setTextSelection(pos);
    }
    setCmMatchCount(0);
    setTiptapMatches([]);
    setTiptapMatchIdx(0);
    onClose();
  }

  if (!open) return null;

  const isCanvas = fileKind === 'canvas';
  const isTiptap = !isCanvas && !!(editorRef?.current?.getTiptapEditor?.());
  const matchCount = isCanvas ? canvasMatchCount : isTiptap ? tiptapMatches.length : cmMatchCount;

  return (
    <div className="frb-root" onKeyDown={handleKeyDown} role="dialog" aria-label="Find and replace">
      {/* Toggle expand/collapse replace row */}
      <button
        className="frb-toggle"
        onClick={() => setShowReplace((v) => !v)}
        title="Toggle replace"
      >
        {showReplace ? <CaretDown weight="thin" size={11} /> : <CaretRight weight="thin" size={11} />}
      </button>

      <div className="frb-main">
        {/* ── Find row ── */}
        <div className="frb-row">
          <div className="frb-input-wrap">
            <input
              ref={searchInputRef}
              className="frb-input"
              placeholder="Find…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              spellCheck={false}
            />
            {query && (
              <span className="frb-count">
                {matchCount === 0 ? 'no results' : `${matchCount} match${matchCount !== 1 ? 'es' : ''}`}
              </span>
            )}
          </div>

          {/* Options */}
          <div className="frb-options">
            <button
              className={`frb-opt${caseSensitive ? ' active' : ''}`}
              onClick={() => setCaseSensitive((v) => !v)}
              title="Case sensitive"
            >Aa</button>
            <button
              className={`frb-opt${wholeWord ? ' active' : ''}`}
              onClick={() => setWholeWord((v) => !v)}
              title="Whole word"
              disabled={isCanvas}
            >[W]</button>
            <button
              className={`frb-opt${useRegex ? ' active' : ''}`}
              onClick={() => setUseRegex((v) => !v)}
              title="Use regex"
              disabled={isCanvas}
            >.*</button>
          </div>

          {/* Navigation */}
          <div className="frb-nav">
            <button className="frb-nav-btn" onClick={handleFindPrev} title="Previous match (Shift+Enter)" disabled={matchCount === 0}><ArrowUp weight="thin" size={13} /></button>
            <button className="frb-nav-btn" onClick={handleFindNext} title="Next match (Enter)" disabled={matchCount === 0}><ArrowDown weight="thin" size={13} /></button>
          </div>

          <button className="frb-close" onClick={handleClose} title="Close (Esc)"><X weight="thin" size={14} /></button>
        </div>

        {/* ── Replace row ── */}
        {showReplace && !isCanvas && (
          <div className="frb-row frb-replace-row">
            <div className="frb-input-wrap">
              <input
                ref={replaceInputRef}
                className="frb-input frb-input--replace"
                placeholder="Replace…"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="frb-replace-actions">
              <button className="frb-rep-btn" onClick={handleReplaceOne} disabled={matchCount === 0 || !query}>Replace</button>
              <button className="frb-rep-btn" onClick={handleReplaceAll} disabled={matchCount === 0 || !query}>Replace All</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
