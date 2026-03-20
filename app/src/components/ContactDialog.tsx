import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { fetch } from '@tauri-apps/plugin-http';
import { supabase } from '../services/supabase';
import './ContactDialog.css';

const CONTACT_URL = 'https://dxxwlnvemqgpdrnkzrcr.supabase.co/functions/v1/contact';

type Kind = 'feedback' | 'bug' | 'feature';

interface Props {
  open: boolean;
  locale?: string;
  onClose: () => void;
}

const KIND_LABELS: Record<Kind, string> = {
  feedback: '💬 Feedback',
  bug: '🐛 Bug',
  feature: '✨ Feature request',
};

export default function ContactDialog({ open, locale, onClose }: Props) {
  const [kind, setKind] = useState<Kind>('feedback');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Pre-fill email from logged-in user
  useEffect(() => {
    if (!open) return;
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setEmail(data.user.email);
    }).catch(() => {});
  }, [open]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setStatus('idle');
      setMessage('');
      setErrorMsg('');
      setKind('feedback');
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setStatus('sending');
    setErrorMsg('');

    const payload = {
      name: email.trim() || 'Cafezin user',
      email: email.trim() || '',
      message: `[${KIND_LABELS[kind]}]\n\n${message.trim()}`,
      company: '',
      locale: locale ?? 'en',
      pagePath: '/app',
    };

    try {
      const res = await fetch(CONTACT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Falha ao enviar.');
      }

      setStatus('ok');
      setMessage('');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Falha ao enviar. Tente novamente.');
      setStatus('error');
    }
  }

  if (!open) return null;

  const ptBR = locale === 'pt-BR';

  return createPortal(
    <div className="cd-overlay" onClick={onClose}>
      <div className="cd-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="cd-header">
          <span className="cd-title">{ptBR ? 'Fale com a gente' : 'Get in touch'}</span>
          <button className="cd-close" onClick={onClose} title="Fechar">✕</button>
        </div>

        {status === 'ok' ? (
          <div className="cd-success">
            <span className="cd-success-icon">✓</span>
            <p>{ptBR ? 'Mensagem enviada! Pedro vai receber no Telegram.' : 'Message sent! Pedro will receive it on Telegram.'}</p>
            <button className="cd-btn-secondary" onClick={onClose}>
              {ptBR ? 'Fechar' : 'Close'}
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => { void handleSubmit(e); }}>
            <div className="cd-kinds">
              {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`cd-kind-btn${kind === k ? ' active' : ''}`}
                  onClick={() => setKind(k)}
                >
                  {KIND_LABELS[k]}
                </button>
              ))}
            </div>

            <div className="cd-field">
              <textarea
                className="cd-textarea"
                placeholder={ptBR ? 'Sua mensagem…' : 'Your message…'}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                required
                autoFocus
              />
            </div>

            <div className="cd-field">
              <input
                className="cd-input"
                type="email"
                placeholder={ptBR ? 'Seu e-mail (opcional)' : 'Your email (optional)'}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {status === 'error' && (
              <p className="cd-error">{errorMsg}</p>
            )}

            <div className="cd-footer">
              <button
                type="submit"
                className="cd-btn-primary"
                disabled={status === 'sending' || !message.trim()}
              >
                {status === 'sending'
                  ? (ptBR ? 'Enviando…' : 'Sending…')
                  : (ptBR ? 'Enviar' : 'Send')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
