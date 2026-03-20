import { Sparkle, X } from '@phosphor-icons/react';
import './NudgeToast.css';

interface NudgeToastProps {
  text: string;
  onAsk: () => void;
  onDismiss: () => void;
}

export default function NudgeToast({ text, onAsk, onDismiss }: NudgeToastProps) {
  return (
    <div className="nudge-toast">
      <Sparkle weight="fill" className="nudge-toast-icon" />
      <span className="nudge-toast-text">{text}</span>
      <button className="nudge-toast-cta" onClick={onAsk}>
        Perguntar
      </button>
      <button className="nudge-toast-dismiss" onClick={onDismiss} title="Dispensar">
        <X weight="bold" />
      </button>
    </div>
  );
}
