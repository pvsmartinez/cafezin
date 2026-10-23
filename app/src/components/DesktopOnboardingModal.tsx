import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Icon } from '@phosphor-icons/react';
import { Books, LinkSimple, Sparkle, X } from '@phosphor-icons/react';
import './DesktopOnboardingModal.css';

type Locale = 'en' | 'pt-BR';

interface DesktopOnboardingModalProps {
  open: boolean;
  locale: Locale;
  firstRun?: boolean;
  onClose: () => void;
}

interface HelpSlide {
  eyebrow: string;
  title: string;
  body: string;
  accent: string;
  bullets: string[];
  Icon: Icon;
}

const SWIPE_THRESHOLD = 56;

const SLIDES: Record<Locale, HelpSlide[]> = {
  'pt-BR': [
    {
      eyebrow: 'Bem-vindo',
      title: 'Escreva livros e relatórios em arquivos que são seus',
      body: 'Cada texto é um arquivo Markdown numa pasta do seu computador. Nada fica preso no app.',
      accent: 'Seus textos, no seu computador',
      bullets: ['Capítulos e notas em Markdown', 'Escrita visual ou Markdown puro', 'Manuscrito em PDF quando quiser'],
      Icon: Books,
    },
    {
      eyebrow: 'Referências',
      title: 'Ligue um texto ao outro',
      body: 'Escreva [[nome do texto]] para criar uma referência. Clique e o outro texto abre.',
      accent: '[[ ]] cria uma referência',
      bullets: ['[[personagens]] abre personagens.md', '[[personagens|as notas]] mostra outro rótulo', 'O rodapé mostra quem cita o texto aberto'],
      Icon: LinkSimple,
    },
    {
      eyebrow: 'Agente',
      title: 'Um agente ao lado, e a decisão é sua',
      body: 'Peça revisão, pesquisa ou um rascunho. Cada edição do agente fica marcada até você aceitar ou desfazer.',
      accent: '⌘K abre o agente',
      bullets: ['Antes e depois de cada edição', 'Aceite ou desfaça com um clique', 'Use o modelo que preferir'],
      Icon: Sparkle,
    },
  ],
  en: [
    {
      eyebrow: 'Welcome',
      title: 'Write books and reports in files you own',
      body: 'Every text is a Markdown file in a folder on your computer. Nothing is locked inside the app.',
      accent: 'Your texts, on your computer',
      bullets: ['Chapters and notes in Markdown', 'Visual writing or raw Markdown', 'Manuscript PDF whenever you want'],
      Icon: Books,
    },
    {
      eyebrow: 'References',
      title: 'Connect one text to another',
      body: 'Type [[text name]] to create a reference. Click it and the other text opens.',
      accent: '[[ ]] creates a reference',
      bullets: ['[[characters]] opens characters.md', '[[characters|the notes]] shows another label', 'The footer shows who references the open text'],
      Icon: LinkSimple,
    },
    {
      eyebrow: 'Agent',
      title: 'An agent at your side, and you decide',
      body: 'Ask for a review, research or a draft. Every agent edit stays marked until you accept or undo it.',
      accent: '⌘K opens the agent',
      bullets: ['Before and after for every edit', 'Accept or undo with one click', 'Use the model you prefer'],
      Icon: Sparkle,
    },
  ],
};

export default function DesktopOnboardingModal({ open, locale, firstRun = false, onClose }: DesktopOnboardingModalProps) {
  const slides = useMemo(() => SLIDES[locale] ?? SLIDES.en, [locale]);
  const [index, setIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') setIndex((current) => Math.min(current + 1, slides.length - 1));
      if (event.key === 'ArrowLeft') setIndex((current) => Math.max(current - 1, 0));
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open, slides.length]);

  if (!open) return null;

  const slide = slides[index];
  const isFirst = index === 0;
  const isLast = index === slides.length - 1;

  function goNext() {
    if (isLast) {
      onClose();
      return;
    }
    setIndex((current) => Math.min(current + 1, slides.length - 1));
  }

  function goPrev() {
    setIndex((current) => Math.max(current - 1, 0));
  }

  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    setTouchStartX(event.changedTouches[0]?.clientX ?? null);
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    const endX = event.changedTouches[0]?.clientX ?? null;
    if (touchStartX == null || endX == null) return;
    const delta = endX - touchStartX;
    setTouchStartX(null);
    if (Math.abs(delta) < SWIPE_THRESHOLD) return;
    if (delta < 0) goNext();
    else goPrev();
  }

  return createPortal(
    <div className="dom-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dom-modal" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <div className="dom-header">
          <div>
            <div className="dom-kicker">{firstRun ? (locale === 'pt-BR' ? 'Primeira sessão' : 'First session') : (locale === 'pt-BR' ? 'Ajuda' : 'Help')}</div>
            <div className="dom-step">{index + 1} / {slides.length}</div>
          </div>
          <button className="dom-close" onClick={onClose} title={locale === 'pt-BR' ? 'Fechar' : 'Close'}>
            <X size={16} />
          </button>
        </div>

        <div className="dom-body">
          <div className="dom-visual">
            <div className="dom-icon-wrap">
              <slide.Icon size={34} weight="thin" />
            </div>
            <div className="dom-accent">{slide.accent}</div>
          </div>

          <div className="dom-copy">
            <div className="dom-eyebrow">{slide.eyebrow}</div>
            <h2 className="dom-title">{slide.title}</h2>
            <p className="dom-body-text">{slide.body}</p>
            <div className="dom-bullets">
              {slide.bullets.map((item) => (
                <div key={item} className="dom-bullet">{item}</div>
              ))}
            </div>
          </div>
        </div>

        <div className="dom-progress" aria-label={locale === 'pt-BR' ? 'Progresso' : 'Progress'}>
          {slides.map((item, itemIndex) => (
            <button key={item.title} className={`dom-dot ${itemIndex === index ? 'is-active' : ''}`} aria-label={`${locale === 'pt-BR' ? 'Ir para o passo' : 'Go to step'} ${itemIndex + 1}`} onClick={() => setIndex(itemIndex)} />
          ))}
        </div>

        <div className="dom-footer">
          <div />
          <div className="dom-actions">
            {!isFirst && <button className="dom-btn dom-btn-secondary" onClick={goPrev}>{locale === 'pt-BR' ? 'Voltar' : 'Back'}</button>}
            {!isLast && <button className="dom-btn dom-btn-secondary" onClick={onClose}>{locale === 'pt-BR' ? 'Pular' : 'Skip'}</button>}
            <button className="dom-btn dom-btn-primary" onClick={goNext}>{isLast ? (locale === 'pt-BR' ? 'Começar' : 'Start') : (locale === 'pt-BR' ? 'Próximo' : 'Next')}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}