import { Check, X, Info } from '@phosphor-icons/react';
import type { Toast } from '../../hooks/useToast';

interface ToastListProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

const ICONS: Record<string, React.ReactNode> = {
  success: <Check size={14} weight="bold" />,
  error:   <X     size={14} weight="bold" />,
  info:    <Info  size={14} />,
};

const TYPE_CLASSES: Record<string, string> = {
  success: 'mb-toast-success',
  error:   'mb-toast-error',
  info:    'mb-toast-info',
};

const ICON_BG: Record<string, string> = {
  success: 'mb-toast-success-icon',
  error:   'mb-toast-error-icon',
  info:    'mb-toast-info-icon',
};

export default function ToastList({ toasts, onDismiss }: ToastListProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[99999] flex flex-col items-center gap-2 w-[min(calc(100vw-32px),360px)] pointer-events-none"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-[10px] px-4 py-3 rounded-xl text-sm font-medium leading-[1.4] w-full pointer-events-auto cursor-pointer backdrop-glass animate-toast-in ${TYPE_CLASSES[t.type] ?? TYPE_CLASSES.info}`}
          style={{ boxShadow: 'var(--mb-toast-shadow)' }}
          role="alert"
          onClick={() => onDismiss(t.id)}
        >
          <span className={`shrink-0 w-5 h-5 flex items-center justify-center text-[13px] font-bold rounded-full ${ICON_BG[t.type] ?? ''}`}>
            {ICONS[t.type]}
          </span>
          <span className="flex-1 break-words">{t.message}</span>
          {t.type === 'error' && (
            <button
              className="shrink-0 bg-transparent border-0 text-inherit opacity-60 text-sm font-bold p-[0_2px] cursor-pointer"
              onClick={(e) => { e.stopPropagation(); onDismiss(t.id); }}
              aria-label="Fechar"
            ><X size={14} weight="bold" /></button>
          )}
        </div>
      ))}
    </div>
  );
}

