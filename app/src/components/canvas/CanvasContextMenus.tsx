/**
 * CanvasContextMenus — portal-rendered overlays for shape interactions.
 *
 * Renders via React portals so they appear above tldraw's z-index layers:
 * - Shape right-click context menu (Duplicate, Layer order, Wrap as Slide, Lock, Delete)
 * - Long-press Unlock pill for locked shapes
 * - Brief lock-flash animation on first touch
 */
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Editor, TLShapeId, TLShape } from 'tldraw';
import { createShapeId } from 'tldraw';
import { SLIDE_W, SLIDE_H } from './canvasConstants';
import { applyThemeToSlides, loadThemeFromDoc } from './canvasTheme';

interface CanvasContextMenusProps {
  editorRef: React.MutableRefObject<Editor | null>;
  // Shape right-click menu
  shapeCtxMenu: { x: number; y: number; shapeId: TLShapeId; isLocked: boolean } | null;
  setShapeCtxMenu: (v: { x: number; y: number; shapeId: TLShapeId; isLocked: boolean } | null) => void;
  // Lock pill
  lockPill: { x: number; y: number; shapeId: TLShapeId } | null;
  setLockPill: (v: { x: number; y: number; shapeId: TLShapeId } | null) => void;
  // Lock flash
  lockFlash: { x: number; y: number } | null;
}

export function CanvasContextMenus({
  editorRef,
  shapeCtxMenu, setShapeCtxMenu,
  lockPill, setLockPill,
  lockFlash,
}: CanvasContextMenusProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* ── Shape right-click context menu ────────────────────────────────── */}
      {shapeCtxMenu && (() => {
        const { x, y, shapeId } = shapeCtxMenu;
        const dismiss = () => setShapeCtxMenu(null);
        return createPortal(
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onMouseDown={dismiss} />
            <div
              className="canvas-ctx-menu"
              style={{ position: 'fixed', left: x, top: y, zIndex: 9999 }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button className="canvas-ctx-item" onClick={() => {
                const ed = editorRef.current;
                if (ed) ed.duplicateShapes([shapeId], { x: 16, y: 16 });
                dismiss();
              }}>
                <span className="canvas-ctx-icon">⧉</span> {t('canvasCtxMenu.duplicate')}
              </button>
              <div className="canvas-ctx-sep" />
              <button className="canvas-ctx-item" onClick={() => { editorRef.current?.bringForward([shapeId]); dismiss(); }}>
                <span className="canvas-ctx-icon">⬆</span> {t('canvasCtxMenu.bringForward')}
              </button>
              <button className="canvas-ctx-item" onClick={() => { editorRef.current?.sendBackward([shapeId]); dismiss(); }}>
                <span className="canvas-ctx-icon">⬇</span> {t('canvasCtxMenu.sendBackward')}
              </button>
              <div className="canvas-ctx-sep" />
              {/* Wrap as Slide — creates a slide frame around selected shapes */}
              <button className="canvas-ctx-item" onClick={() => {
                const ed = editorRef.current;
                if (!ed) { dismiss(); return; }
                const allIds = ed.getSelectedShapeIds();
                const targetIds = (allIds.length > 0 ? allIds : [shapeId])
                  .filter((id) => { const s = ed.getShape(id); return s && s.type !== 'frame'; }) as TLShapeId[];
                const bounds = allIds.length > 0 ? ed.getSelectionPageBounds() : ed.getShapePageBounds(shapeId);
                if (!bounds || targetIds.length === 0) { dismiss(); return; }
                const PAD = 60;
                const fw = Math.max(SLIDE_W, bounds.w + PAD * 2);
                const fh = Math.max(SLIDE_H, bounds.h + PAD * 2);
                const fx = bounds.x - (fw - bounds.w) / 2;
                const fy = bounds.y - (fh - bounds.h) / 2;
                const frameId = createShapeId();
                ed.createShape({ id: frameId, type: 'frame', x: fx, y: fy, props: { w: fw, h: fh, name: '' } });
                ed.reparentShapes(targetIds, frameId);
                applyThemeToSlides(ed, loadThemeFromDoc(ed));
                ed.setSelectedShapes([frameId]);
                dismiss();
              }}>
                <span className="canvas-ctx-icon">⊞</span> {t('canvasCtxMenu.wrapAsSlide')}
              </button>
              <div className="canvas-ctx-sep" />
              <button className="canvas-ctx-item" onClick={() => {
                const ed = editorRef.current;
                const shape: TLShape | undefined = ed?.getShape(shapeId);
                if (ed && shape) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ed.updateShape({ id: shapeId, type: shape.type, isLocked: true } as any);
                  ed.setSelectedShapes(ed.getSelectedShapeIds().filter((id) => id !== shapeId));
                }
                dismiss();
              }}>
                <span className="canvas-ctx-icon">🔒</span> {t('canvasCtxMenu.lock')}
              </button>
              <div className="canvas-ctx-sep" />
              <button className="canvas-ctx-item canvas-ctx-item--danger" onClick={() => {
                editorRef.current?.deleteShapes([shapeId]);
                dismiss();
              }}>
                <span className="canvas-ctx-icon">✕</span> {t('canvasCtxMenu.delete')}
              </button>
            </div>
          </>,
          document.body
        );
      })()}

      {/* ── Long-press Unlock pill ─────────────────────────────────────────── */}
      {lockPill && (() => {
        const { x, y, shapeId } = lockPill;
        const dismiss = () => setLockPill(null);
        return createPortal(
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onMouseDown={dismiss} />
            <button
              className="canvas-lock-pill"
              style={{ position: 'fixed', left: x, top: y, zIndex: 9999 }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                const ed = editorRef.current;
                const shape = ed?.getShape(shapeId);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                if (ed && shape) ed.updateShape({ id: shapeId, type: shape.type, isLocked: false } as any);
                dismiss();
              }}
            >
              🔓 {t('canvasCtxMenu.unlock')}
            </button>
          </>,
          document.body
        );
      })()}

      {/* ── Brief lock-flash animation ─────────────────────────────────────── */}
      {lockFlash && createPortal(
        <div
          className="canvas-lock-flash"
          style={{ position: 'fixed', left: lockFlash.x, top: lockFlash.y }}
          aria-hidden="true"
        >🔒</div>,
        document.body
      )}
    </>
  );
}
