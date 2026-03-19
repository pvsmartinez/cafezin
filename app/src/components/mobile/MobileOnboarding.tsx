import { useState } from 'react';
import type { Icon } from '@phosphor-icons/react';
import { ArrowsLeftRight, Books, Microphone, NotePencil, Robot, Sparkle } from '@phosphor-icons/react';

interface MobileOnboardingProps {
  onFinish: () => void;
}

interface OnboardingSlide {
  title: string;
  body: string;
  eyebrow: string;
  accent: string;
  Icon: Icon;
}

const SWIPE_THRESHOLD = 48;

const SLIDES: OnboardingSlide[] = [
  {
    eyebrow: 'Cafezin no celular',
    title: 'Seu companion app para ideias fora da mesa',
    body: 'Capture insights, anote rascunhos e retome o contexto do seu trabalho enquanto voce esta on the go.',
    accent: 'Companion app do desktop',
    Icon: NotePencil,
  },
  {
    eyebrow: 'Sync',
    title: 'Desktop e mobile no mesmo fluxo',
    body: 'Seus workspaces sincronizados acompanham voce no celular para revisar arquivos, acompanhar projetos e continuar de onde parou.',
    accent: 'Continuidade entre devices',
    Icon: ArrowsLeftRight,
  },
  {
    eyebrow: 'Leitura e contexto',
    title: 'Abra arquivos e volte para o fio da meada rapido',
    body: 'Consulte notas, capitulos, materiais e canvases do workspace sem depender de abrir o desktop toda vez.',
    accent: 'Seu contexto com voce',
    Icon: Books,
  },
  {
    eyebrow: 'Voice memos',
    title: 'Fale a ideia antes que ela evapore',
    body: 'Grave um memo de voz, transcreva e transforme esse pensamento bruto em rascunho ou proximo passo.',
    accent: 'Da voz ao rascunho',
    Icon: Microphone,
  },
  {
    eyebrow: 'Copilot mobile',
    title: 'Converse com a IA usando o contexto do workspace',
    body: 'No celular, o Copilot ajuda voce a revisar, pensar e organizar o trabalho sem sair do app.',
    accent: 'IA para continuar o trabalho',
    Icon: Robot,
  },
  {
    eyebrow: 'Pronto',
    title: 'Cafezin mobile e para capturar, revisar e continuar',
    body: 'Use o celular para manter o trabalho andando entre um momento e outro. Quando quiser, e so entrar e seguir.',
    accent: 'Feito para primeira sessao',
    Icon: Sparkle,
  },
];

export default function MobileOnboarding({ onFinish }: MobileOnboardingProps) {
  const [index, setIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  const slide = SLIDES[index];
  const isFirst = index === 0;
  const isLast = index === SLIDES.length - 1;

  function goNext() {
    if (isLast) {
      onFinish();
      return;
    }
    setIndex((current) => Math.min(current + 1, SLIDES.length - 1));
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

  return (
    <div className="mb-shell mb-screen fixed inset-0 z-[120] flex flex-col overflow-hidden bg-app-bg">
      <div className="flex-1 overflow-y-auto scroll-touch flex flex-col">
        <div className="mb-onboarding-wrap flex min-h-full flex-col px-5 pb-[calc(28px+env(safe-area-inset-bottom,0px))] pt-[calc(28px+env(safe-area-inset-top,0px))]">
          <div className="flex items-center justify-between pb-4">
            <div className="mb-onboarding-kicker">Primeira sessao</div>
            <button className="btn-ghost px-4 py-2 text-[13px]" onClick={onFinish}>
              Pular
            </button>
          </div>

          <div
            className="mb-onboarding-card mb-card flex flex-1 flex-col"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div className="mb-onboarding-hero">
              <div className="mb-onboarding-icon">
                <slide.Icon size={34} weight="thin" />
              </div>
              <div className="mb-onboarding-accent">{slide.accent}</div>
            </div>

            <div className="mb-onboarding-copy">
              <div className="mb-onboarding-eyebrow">{slide.eyebrow}</div>
              <h1 className="mb-onboarding-title">{slide.title}</h1>
              <p className="mb-onboarding-body">{slide.body}</p>
            </div>

            <div className="mb-onboarding-progress" aria-label="Progresso do onboarding">
              {SLIDES.map((item, itemIndex) => (
                <button
                  key={item.title}
                  className={`mb-onboarding-dot ${itemIndex === index ? 'is-active' : ''}`}
                  aria-label={`Ir para tela ${itemIndex + 1}`}
                  aria-current={itemIndex === index ? 'true' : undefined}
                  onClick={() => setIndex(itemIndex)}
                />
              ))}
            </div>

            <div className="mb-onboarding-footer">
              <div className="mb-onboarding-step">{index + 1} / {SLIDES.length}</div>
              <div className="flex items-center gap-2">
                {!isFirst && (
                  <button className="btn-secondary px-4 py-3 text-[14px]" onClick={goPrev}>
                    Voltar
                  </button>
                )}
                <button className="btn-primary px-5 py-3 text-[14px]" onClick={goNext}>
                  {isLast ? 'Entrar / continuar' : 'Proxima'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}