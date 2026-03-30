import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';
import './FeedbackNudge.css';

interface Props {
  onOpenFeedback: () => void;
  onDismiss: () => void;
}

export default function FeedbackNudge({ onOpenFeedback, onDismiss }: Props) {
  function handleFeedback() {
    onDismiss();
    onOpenFeedback();
  }

  return createPortal(
    <div className="feedback-nudge" role="complementary" aria-label="Pedido de feedback">
      <span className="feedback-nudge-emoji">☕</span>
      <div className="feedback-nudge-body">
        <span className="feedback-nudge-title">O Cafezin é novinho!</span>
        <span className="feedback-nudge-text">Seu feedback nos ajuda a melhorar.</span>
      </div>
      <button className="feedback-nudge-cta" onClick={handleFeedback}>
        Dar feedback
      </button>
      <button className="feedback-nudge-dismiss" onClick={onDismiss} title="Dispensar">
        <X weight="bold" />
      </button>
    </div>,
    document.body,
  );
}
