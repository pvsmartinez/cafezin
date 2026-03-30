import './ManagedAIQuotaModal.css';

interface ManagedAIQuotaModalProps {
  open: boolean;
  message?: string | null;
  onClose: () => void;
  onUpgrade: () => void;
  onChooseProvider: () => void;
}

export function ManagedAIQuotaModal({
  open,
  message,
  onClose,
  onUpgrade,
  onChooseProvider,
}: ManagedAIQuotaModalProps) {
  if (!open) return null;

  return (
    <div className="managed-ai-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="managed-ai-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="managed-ai-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="managed-ai-modal-badge">Cafezin IA</div>
        <h3 id="managed-ai-modal-title" className="managed-ai-modal-title">Cota mensal esgotada</h3>
        <p className="managed-ai-modal-desc">
          {message ?? 'Sua cota mensal da Cafezin IA acabou. Você pode fazer upgrade do plano na web ou trocar para outro provider.'}
        </p>
        <div className="managed-ai-modal-actions">
          <button className="managed-ai-modal-primary" onClick={onUpgrade}>
            Upgrade do plano ↗
          </button>
          <button className="managed-ai-modal-secondary" onClick={onChooseProvider}>
            Escolher outro provider
          </button>
        </div>
        <button className="managed-ai-modal-dismiss" onClick={onClose}>
          Agora não
        </button>
      </div>
    </div>
  );
}