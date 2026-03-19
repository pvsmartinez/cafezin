import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Icon } from '@phosphor-icons/react';
import { ArrowsLeftRight, Books, Keyboard, RocketLaunch, Sparkle, X } from '@phosphor-icons/react';
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
      eyebrow: 'Como usar o Cafezin',
      title: 'Um workspace para escrever, ensinar, planejar e publicar',
      body: 'Use o Cafezin para livros, aulas, sites, planilhas e qualquer trabalho intelectual que precise de contexto real.',
      accent: 'Markdown, canvas e IA no mesmo lugar',
      bullets: ['Escreva livro ou aula em arquivos locais', 'Abra sites e HTML com preview', 'Consulte spreadsheets sem sair do app'],
      Icon: Sparkle,
    },
    {
      eyebrow: 'Copilot',
      title: 'O Copilot trabalha com o contexto do seu workspace',
      body: 'Abra o painel de IA para revisar texto, estruturar ideias, transformar rascunho em material pronto e usar ferramentas do workspace.',
      accent: 'Cmd+K para abrir rapido',
      bullets: ['Pergunte sobre o arquivo atual', 'Peca para criar e editar arquivos', 'Use canvas, docs e contexto real juntos'],
      Icon: RocketLaunch,
    },
    {
      eyebrow: 'Atalhos',
      title: 'Os atalhos certos deixam o fluxo mais rapido',
      body: 'O Cafezin foi desenhado para ficar leve no dia a dia. Os principais atalhos resolvem quase tudo sem tirar sua mao do teclado.',
      accent: 'Fluxo de trabalho diario',
      bullets: ['Cmd+K abre o Copilot', 'Cmd+F busca no arquivo e Cmd+Shift+F no projeto', 'Cmd+, abre Settings e Cmd+Shift+P alterna preview'],
      Icon: Keyboard,
    },
    {
      eyebrow: 'Casos de uso',
      title: 'Livro, aula, spreadsheet e site podem conviver no mesmo projeto',
      body: 'Monte materiais longos, revise dados, organize pesquisa e publique demos sem espalhar seu trabalho em varias ferramentas soltas.',
      accent: 'Feito para trabalho profundo',
      bullets: ['Capitulos, notas e pesquisa lado a lado', 'Aulas, slides e materiais no mesmo workspace', 'Planilhas e sites como parte do processo'],
      Icon: Books,
    },
    {
      eyebrow: 'Companion app',
      title: 'O mobile entra como companion app do desktop',
      body: 'Quando voce estiver fora da mesa, o celular serve para capturar ideias, revisar arquivos, usar voice memos e manter o contexto andando.',
      accent: 'Desktop e mobile no mesmo fluxo',
      bullets: ['Revise workspaces sincronizados', 'Capture ideias por voz no celular', 'Continue o trabalho sem perder o fio'],
      Icon: ArrowsLeftRight,
    },
  ],
  en: [
    {
      eyebrow: 'How Cafezin works',
      title: 'One workspace for writing, teaching, planning, and publishing',
      body: 'Use Cafezin for books, lessons, sites, spreadsheets, and any deep work that benefits from real project context.',
      accent: 'Markdown, canvas, and AI together',
      bullets: ['Write books and lessons in local files', 'Open sites and HTML with preview', 'Review spreadsheets without leaving the app'],
      Icon: Sparkle,
    },
    {
      eyebrow: 'Copilot',
      title: 'Copilot works with real workspace context',
      body: 'Open the AI panel to revise text, structure ideas, turn rough drafts into finished material, and use workspace tools directly.',
      accent: 'Cmd+K opens it fast',
      bullets: ['Ask about the current file', 'Create and edit files through tools', 'Use docs, canvas, and project context together'],
      Icon: RocketLaunch,
    },
    {
      eyebrow: 'Shortcuts',
      title: 'The right shortcuts make the workflow feel light',
      body: 'Cafezin is designed for everyday use. A small set of shortcuts covers most of the flow without forcing you into menus.',
      accent: 'Daily workflow',
      bullets: ['Cmd+K opens Copilot', 'Cmd+F searches the file and Cmd+Shift+F searches the project', 'Cmd+, opens Settings and Cmd+Shift+P toggles preview'],
      Icon: Keyboard,
    },
    {
      eyebrow: 'Use cases',
      title: 'Books, lessons, spreadsheets, and sites can live in one project',
      body: 'Build long-form material, review data, organize research, and publish demos without scattering your work across disconnected tools.',
      accent: 'Built for deep work',
      bullets: ['Chapters, notes, and research side by side', 'Lessons, slides, and materials in one workspace', 'Spreadsheets and sites as part of the same process'],
      Icon: Books,
    },
    {
      eyebrow: 'Companion app',
      title: 'Mobile works as the desktop companion app',
      body: 'Away from the desk, use mobile to capture ideas, review files, record voice memos, and keep the work moving with the same context.',
      accent: 'Desktop and mobile in one flow',
      bullets: ['Review synced workspaces', 'Capture ideas by voice on mobile', 'Keep momentum without losing context'],
      Icon: ArrowsLeftRight,
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
            <div className="dom-kicker">{firstRun ? (locale === 'pt-BR' ? 'Primeira sessao' : 'First session') : 'Help'}</div>
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

        <div className="dom-progress" aria-label="Onboarding progress">
          {slides.map((item, itemIndex) => (
            <button key={item.title} className={`dom-dot ${itemIndex === index ? 'is-active' : ''}`} aria-label={`Go to slide ${itemIndex + 1}`} onClick={() => setIndex(itemIndex)} />
          ))}
        </div>

        <div className="dom-footer">
          <div className="dom-hint">{locale === 'pt-BR' ? 'Setas esquerda/direita tambem funcionam' : 'Left and right arrows also work'}</div>
          <div className="dom-actions">
            {!isFirst && <button className="dom-btn dom-btn-secondary" onClick={goPrev}>{locale === 'pt-BR' ? 'Voltar' : 'Back'}</button>}
            <button className="dom-btn dom-btn-secondary" onClick={onClose}>{locale === 'pt-BR' ? 'Fechar' : 'Close'}</button>
            <button className="dom-btn dom-btn-primary" onClick={goNext}>{isLast ? (locale === 'pt-BR' ? 'Comecar' : 'Start') : (locale === 'pt-BR' ? 'Proximo' : 'Next')}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}