/**
 * AIMarkOverlay — the agent's edits as notes in the margin of the page.
 *
 * Each pending mark gets a note beside the page, level with the edited text:
 * what was there before (struck through), and Manter / Desfazer. When the
 * window is too narrow for a margin, compact buttons sit inside the page's
 * own right padding so they never cover words.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIEditMark } from '../types';
import type { EditorHandle } from './Editor';
import './AIMarkOverlay.css';

const NOTE_MIN_WIDTH = 190;
const NOTE_MAX_WIDTH = 290;
const NOTE_GAP = 26;
const NOTE_ESTIMATED_HEIGHT = 128;
const COMPACT_INSET = 66;

interface AIMarkOverlayProps {
  visible: boolean;
  marks: AIEditMark[];
  editorRef: React.RefObject<EditorHandle | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onReview: (id: string) => void;
  onReject: (id: string) => void;
}

interface MarkPos {
  actionsTop: number;
  actionsLeft: number;
  markId: string;
  canReject: boolean;
  /** Note card in the margin, or compact buttons inside the page padding. */
  mode: 'note' | 'compact';
  width: number;
}

export default function AIMarkOverlay({
  visible,
  marks,
  editorRef,
  containerRef,
  onReview,
  onReject,
}: AIMarkOverlayProps) {
  const { t, i18n } = useTranslation();
  const [positions, setPositions] = useState<MarkPos[]>([]);
  const positionsRef = useRef<MarkPos[]>([]);

  const recalculate = useCallback(() => {
    if (!visible || marks.length === 0) {
      // Only update state if something actually changed
      if (positionsRef.current.length > 0) {
        setPositions([]);
        positionsRef.current = [];
      }
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const page = container.querySelector('.prose-page, .cm-content');
    const pageRight = (page?.getBoundingClientRect().right ?? containerRect.right) - containerRect.left;
    const available = containerRect.width - pageRight - NOTE_GAP - 16;
    const mode: MarkPos['mode'] = available >= NOTE_MIN_WIDTH ? 'note' : 'compact';
    const width = Math.min(NOTE_MAX_WIDTH, available);

    const found: MarkPos[] = [];
    for (const mark of marks) {
      const coords = editorRef.current?.getMarkCoords({ text: mark.text, revert: mark.revert });
      if (!coords) continue;
      found.push({
        actionsTop: (mode === 'note' ? coords.top : (coords.top + coords.bottom) / 2) - containerRect.top,
        actionsLeft: mode === 'note' ? pageRight + NOTE_GAP : pageRight - COMPACT_INSET,
        markId: mark.id,
        canReject: !!mark.revert,
        mode,
        width,
      });
    }
    // Stack notes so they never overlap, keeping each as close to its text as possible.
    found.sort((x, y) => x.actionsTop - y.actionsTop);
    const next: MarkPos[] = [];
    for (const pos of found) {
      const prev = next[next.length - 1];
      const minTop = prev && mode === 'note' ? prev.actionsTop + NOTE_ESTIMATED_HEIGHT + 12 : -Infinity;
      next.push({ ...pos, actionsTop: Math.max(pos.actionsTop, minTop) });
    }
    // Skip setState if coords haven't actually changed (avoids re-renders on idle frames)
    const current = positionsRef.current;
    if (
      next.length === current.length &&
      next.every((p, i) =>
        p.actionsTop === current[i].actionsTop &&
        p.actionsLeft === current[i].actionsLeft &&
        p.width === current[i].width &&
        p.markId === current[i].markId
      )
    ) return;
    setPositions(next);
    positionsRef.current = next;
  }, [visible, marks, editorRef, containerRef]);

  // Event-driven position sync — recalculate only on scroll or resize, not every frame.
  // This replaces the previous 60fps RAF loop that caused continuous React re-renders.
  useEffect(() => {
    if (!visible) {
      if (positionsRef.current.length > 0) {
        setPositions([]);
        positionsRef.current = [];
      }
      return;
    }
    // Initial calculation — CodeMirror may not have committed its DOM layout yet.
    // New marks can arrive before CM has finished its async content update pipeline:
    //   1. content state change → Editor useEffect → setCmValue (re-render) →
    //      @uiw/react-codemirror dispatches to CM → CM schedules measure RAF.
    // This multi-step chain means CM's coordsAtPos returns null for newly inserted
    // text in the first 1-2 frames. We retry at increasing intervals to catch the
    // CM measure pass once it completes (usually within ~200ms).
    recalculate();
    const raf = requestAnimationFrame(() => recalculate());
    const t100 = setTimeout(() => recalculate(), 100);
    const t400 = setTimeout(() => recalculate(), 400);
    // The Prose editor is lazy-loaded and can mount after the retries above.
    const t1200 = setTimeout(() => recalculate(), 1200);
    // Recalculate when ANY descendant scrolls (CM6 uses .cm-scroller, Tiptap
    // uses its own element) — capture:true catches scroll from any child.
    const container = containerRef.current;
    const onScroll = () => recalculate();
    container?.addEventListener('scroll', onScroll, { passive: true, capture: true });
    // Recalculate on window resize (container rect changes)
    window.addEventListener('resize', onScroll, { passive: true });
    // Side panels opening/closing resize the editor area without a window resize.
    const resizeObserver = container ? new ResizeObserver(() => recalculate()) : null;
    if (container) resizeObserver?.observe(container);
    // Content loads (file switch, agent writes) change where marks sit.
    let frame = 0;
    const mutationObserver = container ? new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => recalculate());
    }) : null;
    if (container) mutationObserver?.observe(container, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t100);
      clearTimeout(t400);
      clearTimeout(t1200);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      cancelAnimationFrame(frame);
      container?.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onScroll);
    };
  }, [visible, recalculate, containerRef]);

  if (!visible || marks.length === 0) return null;

  const markById = new Map(marks.map((mark) => [mark.id, mark]));

  return (
    <div className="aimo-layer">
      {positions.map(({ actionsTop, actionsLeft, markId, canReject, mode, width }) => {
        const mark = markById.get(markId);
        if (mode === 'compact') {
          return (
            <div key={markId} className="aimo-actions" style={{ top: actionsTop, left: actionsLeft }}>
              <button
                className="aimo-accept-btn"
                title={t('aiMarkOverlay.acceptTitle')}
                onClick={(e) => { e.stopPropagation(); onReview(markId); }}
              >✓</button>
              {canReject && (
                <button
                  className="aimo-reject-btn"
                  title={t('aiMarkOverlay.rejectTitle')}
                  onClick={(e) => { e.stopPropagation(); onReject(markId); }}
                >↺</button>
              )}
            </div>
          );
        }
        const before = mark?.revert?.beforeText.trim();
        return (
          <aside key={markId} className="aimo-note" style={{ top: actionsTop, left: actionsLeft, width }}>
            <div className="aimo-note-who">
              ✦ {t('aiMarkOverlay.agent')}
              {mark && <span>{relativeTime(mark.insertedAt, i18n.language)}</span>}
            </div>
            {before
              ? <div className="aimo-note-before">{before}</div>
              : <div className="aimo-note-added">{t('aiMarkOverlay.added')}</div>}
            <div className="aimo-note-actions">
              <button className="aimo-note-keep" onClick={(e) => { e.stopPropagation(); onReview(markId); }}>
                ✓ {t('aiMarkOverlay.keep')}
              </button>
              {canReject && (
                <button className="aimo-note-undo" onClick={(e) => { e.stopPropagation(); onReject(markId); }}>
                  ↺ {t('aiMarkOverlay.undo')}
                </button>
              )}
            </div>
          </aside>
        );
      })}
    </div>
  );
}

function relativeTime(iso: string, locale: string): string {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}
