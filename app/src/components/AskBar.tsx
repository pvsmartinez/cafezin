/**
 * AskBar — a quiet prompt under the page. Enter sends the request to the
 * agent (opening its panel); the answer's edits come back as margin notes.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatCircle, Sparkle } from '@phosphor-icons/react';
import './AskBar.css';

interface AskBarProps {
  placeholder: string;
  onAsk: (text: string) => void;
  /** Opens the conversation without sending anything. */
  onOpenChat?: () => void;
}

export default function AskBar({ placeholder, onAsk, onOpenChat }: AskBarProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');

  function submit() {
    const value = text.trim();
    if (!value) return;
    onAsk(value);
    setText('');
  }

  return (
    <form
      className="ask-bar"
      onSubmit={(event) => { event.preventDefault(); submit(); }}
    >
      <Sparkle className="ask-bar-icon" size={16} weight="fill" aria-hidden />
      <input
        className="ask-bar-input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        aria-label={t('askBar.label')}
      />
      {text.trim()
        ? <button className="ask-bar-send" type="submit">{t('askBar.send')} ↵</button>
        : onOpenChat && (
          <button type="button" className="ask-bar-chat" onClick={onOpenChat} title={t('askBar.chatTitle')}>
            <ChatCircle size={15} /> {t('askBar.chat')}
          </button>
        )}
    </form>
  );
}
