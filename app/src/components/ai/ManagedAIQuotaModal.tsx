import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
        <h3 id="managed-ai-modal-title" className="managed-ai-modal-title">{t('quotaModal.title')}</h3>
        <p className="managed-ai-modal-desc">
          {message ?? t('quotaModal.descDefault')}
        </p>
        <div className="managed-ai-modal-actions">
          <button className="managed-ai-modal-primary" onClick={onUpgrade}>
            {t('quotaModal.upgradeButton')}
          </button>
          <button className="managed-ai-modal-secondary" onClick={onChooseProvider}>
            {t('quotaModal.chooseProviderButton')}
          </button>
        </div>
        <button className="managed-ai-modal-dismiss" onClick={onClose}>
          {t('quotaModal.dismissButton')}
        </button>
      </div>
    </div>
  );
}