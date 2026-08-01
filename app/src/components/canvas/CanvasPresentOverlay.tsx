/**
 * CanvasPresentOverlay — PNG slide stage + navigation bar shown while presenting.
 */
import type { TLShape } from 'tldraw';
import { useTranslation } from 'react-i18next';

interface CanvasPresentOverlayProps {
  frameIndex: number;
  frames: TLShape[];
  previewUrls: string[];
  previewGenState: 'idle' | 'generating';
  onExit: () => void;
  onGoToFrame: (idx: number) => void;
}

export function CanvasPresentOverlay({
  frameIndex, frames, previewUrls, previewGenState, onExit, onGoToFrame,
}: CanvasPresentOverlayProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* Fullscreen PNG slide backdrop */}
      <div className="canvas-present-stage">
        {previewUrls.length > 0 && previewUrls[frameIndex] ? (
          <img
            className="canvas-present-slide"
            src={previewUrls[frameIndex]}
            alt={t('canvas.slideFallbackName', { number: frameIndex + 1 })}
            draggable={false}
          />
        ) : previewGenState === 'generating' ? (
          <div className="canvas-present-generating">{t('canvasPresent.generating')}</div>
        ) : null}
      </div>

      {/* Bottom navigation bar */}
      <div className="canvas-present-overlay">
        <button className="canvas-present-exit" onClick={onExit} title={t('canvasPresent.exitTitle')}>
          ✕ {t('canvasPresent.exit')}
        </button>
        {frames.length > 0 ? (
          <div className="canvas-present-nav">
            <button
              className="canvas-present-nav-btn"
              disabled={frameIndex === 0}
              onClick={() => onGoToFrame(frameIndex - 1)}
              title={t('canvasPresent.prevTitle')}
            >←</button>
            <span className="canvas-present-counter">
              {frameIndex + 1} <span>/</span> {frames.length}
            </span>
            <button
              className="canvas-present-nav-btn"
              disabled={frameIndex === frames.length - 1}
              onClick={() => onGoToFrame(frameIndex + 1)}
              title={t('canvasPresent.nextTitle')}
            >→</button>
          </div>
        ) : (
          <div className="canvas-present-hint">
            {t('canvasPresent.noFramesPre')} <kbd>F</kbd> {t('canvasPresent.noFramesPost')}
          </div>
        )}
      </div>
    </>
  );
}
