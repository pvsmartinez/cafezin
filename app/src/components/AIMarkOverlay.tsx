/**
 * AIMarkOverlay — always-visible ✓/× buttons anchored to each AI-marked region.
 *
 * Each mark gets accept/reject buttons pinned to the right gutter of the editor,
 * vertically centred on the highlighted text. Always visible so they work
 * reliably regardless of live-preview panels or pointer position issues.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import type { AIEditMark } from '../types';
import type { EditorHandle } from './Editor';
import './AIMarkOverlay.css';

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
}

export default function AIMarkOverlay({
  visible,
  marks,
  editorRef,
  containerRef,
  onReview,
  onReject,
}: AIMarkOverlayProps) {
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

    const next: MarkPos[] = [];
    for (const mark of marks) {
      const coords = editorRef.current?.getMarkCoords({ text: mark.text, revert: mark.revert });
      if (!coords) continue;
      next.push({
        actionsTop: (coords.top + coords.bottom) / 2 - containerRect.top,
        actionsLeft: coords.right - containerRect.left,
        markId: mark.id,
        canReject: !!mark.revert,
      });
    }
    // Skip setState if coords haven't actually changed (avoids re-renders on idle frames)
    const current = positionsRef.current;
    if (
      next.length === current.length &&
      next.every((p, i) =>
        p.actionsTop === current[i].actionsTop &&
        p.actionsLeft === current[i].actionsLeft &&
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
    // Recalculate when ANY descendant scrolls (CM6 uses .cm-scroller, Tiptap
    // uses its own element) — capture:true catches scroll from any child.
    const container = containerRef.current;
    const onScroll = () => recalculate();
    container?.addEventListener('scroll', onScroll, { passive: true, capture: true });
    // Recalculate on window resize (container rect changes)
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t100);
      clearTimeout(t400);
      container?.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onScroll);
    };
  }, [visible, recalculate, containerRef]);

  if (!visible || marks.length === 0) return null;

  return (
    <div className="aimo-layer" aria-hidden="true">
      {positions.map(({ actionsTop, actionsLeft, markId, canReject }) => (
        <div
          key={markId}
          className="aimo-actions"
          style={{ top: actionsTop, left: actionsLeft }}
        >
          <button
            className="aimo-accept-btn"
            title="Accept AI edit"
            onClick={(e) => { e.stopPropagation(); onReview(markId); }}
          >✓</button>
          {canReject && (
            <button
              className="aimo-reject-btn"
              title="Cancel AI edit"
              onClick={(e) => { e.stopPropagation(); onReject(markId); }}
            >×</button>
          )}
        </div>
      ))}
    </div>
  );
}
