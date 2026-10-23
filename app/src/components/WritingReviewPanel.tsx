import { useEffect, useId, useRef } from 'react';
import type { AIEditMark } from '../types';
import './WritingReviewPanel.css';

interface WritingReviewPanelProps {
  marks: AIEditMark[];
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onOpenFile: (path: string) => void;
  onClose: () => void;
}

const WritingReviewPanel = ({
  marks, onAccept, onReject, onOpenFile, onClose,
}: WritingReviewPanelProps) => {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const pending = marks.filter((mark) => !mark.reviewed);

  useEffect(() => {
    const previous = document.activeElement;
    panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const controls = panelRef.current?.querySelectorAll<HTMLButtonElement>(
        'button:not(:disabled), [href], [tabindex="0"]',
      );
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first ||
          !panelRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last ||
          !panelRef.current?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [onClose]);

  return (
    <div className="writing-review-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="writing-review" role="dialog" aria-modal="true"
        aria-labelledby={titleId} ref={panelRef}>
        <header className="writing-review-header">
          <h2 id={titleId}>Revisão da IA <span>{pending.length}</span></h2>
          <button type="button" onClick={onClose} aria-label="Fechar revisão">×</button>
        </header>
        <div className="writing-review-body" aria-live="polite">
          {pending.length === 0 && <p className="writing-review-empty">
            Tudo revisado. Seu texto está pronto para continuar.
          </p>}
          {pending.map((mark) => (
            <article className="writing-review-change" key={mark.id}>
              <div className="writing-review-file">
                <button type="button" onClick={() => { onOpenFile(mark.fileRelPath); onClose(); }}>
                  {mark.fileRelPath}
                </button>
                <span>{mark.model}</span>
              </div>
              <div className="writing-review-comparison">
                <section className="writing-review-before">
                  <h3>Antes</h3>
                  <pre>{mark.revert
                    ? (mark.revert.beforeText || 'Trecho novo')
                    : 'Versão anterior indisponível para esta alteração.'}</pre>
                </section>
                <section className="writing-review-after">
                  <h3>Depois</h3>
                  <pre>{(mark.revert ? mark.revert.afterText : mark.text) || 'Trecho removido'}</pre>
                </section>
              </div>
              <footer>
                <button type="button" disabled={!mark.revert} onClick={() => onReject(mark.id)}
                  title={!mark.revert ? 'Esta alteração antiga não tem dados para desfazer.' : undefined}>
                  Rejeitar alteração
                </button>
                <button type="button" className="writing-review-accept"
                  onClick={() => onAccept(mark.id)}>Aceitar alteração</button>
              </footer>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
};

export default WritingReviewPanel;
