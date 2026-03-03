import { createPortal } from 'react-dom';
import './ForceUpdateModal.css';

interface Props {
  open: boolean;
  requiredVersion: string;
  channel: string;
  onUpdate: () => void;
}

export default function ForceUpdateModal({ open, requiredVersion, channel, onUpdate }: Props) {
  if (!open) return null;

  const isStore = channel === 'mas' || channel === 'ios';

  return createPortal(
    <div className="fu-overlay">
      <div className="fu-modal">
        <div className="fu-icon">↑</div>
        <h2 className="fu-title">Atualização necessária</h2>
        <p className="fu-desc">
          Esta versão do Cafezin não é mais suportada.{' '}
          {isStore
            ? 'Acesse a App Store para atualizar.'
            : 'Clique abaixo para atualizar agora.'}
        </p>
        <p className="fu-version">
          Versão mínima: <strong>{requiredVersion}</strong>
        </p>
        <button className="fu-btn" onClick={onUpdate}>
          {isStore ? 'Abrir App Store' : 'Atualizar agora'}
        </button>
      </div>
    </div>,
    document.body
  );
}
