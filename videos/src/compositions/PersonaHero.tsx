import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  staticFile,
  Sequence,
} from "remotion";

// ── Brand ─────────────────────────────────────────────────────────────────
const GOLD   = "#d4a853";
const PURPLE = "#9c6fe4";
const TEAL   = "#3db89a";
const BG     = "#0c0b09";

// ── Timing @ 30 fps ────────────────────────────────────────────────────────
// Intro: 90f (3s) — 3 personas aparecem em cascata + tagline visível
// Each slide: 190f (155 hold = 5.2s leitura + 35 trans)
// Outro: 105f (3.5s) — CTA + micro-copy + URL
// Total: 90 + 3×190 + 105 = 765 frames = 25.5s
const INTRO = 90;
const HOLD  = 155;
const TRANS = 35;
const SLIDE = HOLD + TRANS;  // 190 frames per slot
const N     = 3;
const OUTRO = 105;

// ── Persona slide data ─────────────────────────────────────────────────────
interface SlideData {
  img: string;
  imgPos: string;   // objectPosition to highlight different area of same screenshot
  pill: string;
  color: string;
  h: string;
  sub: string;
}

const SLIDES_PT: SlideData[] = [
  {
    img: staticFile("desktop/writer.png"),
    imgPos: "center center",
    pill: "✍️  Escritores",
    color: GOLD,
    h: "Escreva sem travar.\nA IA continua com você.",
    sub: "Sugestões em tempo real · revisão instantânea · brainstorm",
  },
  {
    img: staticFile("desktop/educator.png"),
    imgPos: "center center",
    pill: "📚  Educadores",
    color: PURPLE,
    h: "Crie suas aulas.\nEm minutos, não horas.",
    sub: "Planos de aula · slides completos · materiais com IA",
  },
  {
    img: staticFile("desktop/writer.png"),
    imgPos: "68% center",   // zoom AI feedback panel — mostra revisão de pesquisa
    pill: "🎓  Estudantes",
    color: TEAL,
    h: "Organize sua pesquisa.\nEscreva com confiança.",
    sub: "Anotações inteligentes · resumos · entregue no prazo",
  },
];

const SLIDES_EN: SlideData[] = [
  {
    img: staticFile("desktop/writer.png"),
    imgPos: "center center",
    pill: "✍️  Writers",
    color: GOLD,
    h: "Write without\nlosing your voice.",
    sub: "Real-time suggestions · instant review · brainstorm",
  },
  {
    img: staticFile("desktop/educator.png"),
    imgPos: "center center",
    pill: "📚  Educators",
    color: PURPLE,
    h: "Build your lessons.\nIn minutes, not hours.",
    sub: "Lesson plans · full slides · AI-powered materials",
  },
  {
    img: staticFile("desktop/writer.png"),
    imgPos: "68% center",
    pill: "🎓  Students",
    color: TEAL,
    h: "Organize your research.\nWrite with confidence.",
    sub: "Smart notes · summaries · deliver on time",
  },
];

// ── Persona intro — staggered name reveal ──────────────────────────────────
const PERSONAS_PT = [
  { emoji: "✍️", name: "Escritores",  color: GOLD   },
  { emoji: "📚", name: "Professores", color: PURPLE },
  { emoji: "🎓", name: "Estudantes",  color: TEAL   },
];
const PERSONAS_EN = [
  { emoji: "✍️", name: "Writers",    color: GOLD   },
  { emoji: "📚", name: "Educators",  color: PURPLE },
  { emoji: "🎓", name: "Students",   color: TEAL   },
];

const PersonaIntro: React.FC<{ locale: "pt-BR" | "en-US" }> = ({ locale }) => {
  const personas = locale === "pt-BR" ? PERSONAS_PT : PERSONAS_EN;
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Exit: starts at frame 74, done at INTRO=90 (gives tagline 16 frames of full visibility)
  const exitOp = interpolate(f, [74, INTRO], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const paraOp = spring({ frame: f - 2, fps, config: { damping: 18 } });
  // Tagline appears AFTER last persona (f=32+20=52), with buffer at f=58
  const tagOp  = spring({ frame: f - 58, fps, config: { damping: 16 }, from: 0, to: 1 });
  const tagY   = interpolate(tagOp, [0, 1], [12, 0]);

  return (
    <AbsoluteFill
      style={{
        background: BG,
        alignItems: "center",
        justifyContent: "center",
        opacity: exitOp,
      }}
    >
      {/* Subtle center glow — gold tint */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 700px 260px at 50% 48%, rgba(212,168,83,0.09) 0%, transparent 70%)`,
        }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          position: "relative",
        }}
      >
        {/* "Para" label */}
        <div
          style={{
            color: "rgba(255,255,255,0.35)",
            fontSize: 22,
            fontWeight: 500,
            fontFamily: "system-ui, -apple-system, sans-serif",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            opacity: paraOp,
            marginBottom: 12,
          }}
        >
          Para
        </div>

        {/* Staggered persona names */}
        {personas.map((p, i) => {
          const delay = 4 + i * 14;
          const sp = spring({
            frame: f - delay,
            fps,
            config: { damping: 14, stiffness: 120 },
            from: 0,
            to: 1,
          });
          const y = interpolate(sp, [0, 1], [30, 0]);

          return (
            <div
              key={i}
              style={{
                color: p.color,
                fontSize: 80,
                fontWeight: 900,
                fontFamily: "system-ui, -apple-system, sans-serif",
                letterSpacing: "-0.03em",
                lineHeight: 1.05,
                opacity: sp,
                transform: `translateY(${y}px)`,
              }}
            >
              {p.emoji}  {p.name}
            </div>
          );
        })}

        {/* Tagline */}
        <div
          style={{
            color: "rgba(255,255,255,0.52)",
            fontSize: 32,
            fontFamily: "system-ui, sans-serif",
            marginTop: 24,
            opacity: tagOp,
            transform: `translateY(${tagY}px)`,
          }}
        >
          {locale === "pt-BR" ? "A IA que amplifica o que você faz." : "AI that amplifies what you do."}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── Slide card ─────────────────────────────────────────────────────────────
const SlideCard: React.FC<{ s: SlideData }> = ({ s }) => {
  const f   = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame: f, fps, config: { damping: 22, stiffness: 65 } });
  const imgX  = interpolate(enter, [0, 1], [180, 0]);

  // Ken Burns: slow zoom-out over slide lifetime
  const zoom = interpolate(f, [0, HOLD + TRANS], [1.1, 1.01], {
    extrapolateRight: "clamp",
  });

  // Exit: fade out over last TRANS frames
  const exit = interpolate(f, [HOLD, HOLD + TRANS], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Staggered text entrances
  const pillP = spring({ frame: f -  6, fps, config: { damping: 14, stiffness: 130 } });
  const pillY = interpolate(pillP, [0, 1], [24, 0]);
  const headP = spring({ frame: f - 18, fps, config: { damping: 14, stiffness:  90 } });
  const headY = interpolate(headP, [0, 1], [36, 0]);
  const subP  = spring({ frame: f - 32, fps, config: { damping: 16 } });

  // Accent bar grows in with slide entrance
  const barW = interpolate(enter, [0, 1], [0, 100]);

  return (
    <AbsoluteFill style={{ opacity: exit, overflow: "hidden" }}>
      {/* Screenshot: lateral slide + Ken Burns */}
      <AbsoluteFill
        style={{
          transform: `translateX(${imgX}px) scale(${zoom})`,
          transformOrigin: "center",
        }}
      >
        <Img
          src={s.img}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: s.imgPos,
          }}
        />
      </AbsoluteFill>

      {/* Bottom gradient — heavy, text-safe */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.58) 32%, rgba(0,0,0,0.08) 65%, transparent 100%)",
        }}
      />
      {/* Left gradient — readability */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to right, rgba(0,0,0,0.55) 0%, transparent 55%)",
        }}
      />

      {/* Persona accent bar */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          height: 5,
          width: `${barW}%`,
          background: s.color,
          borderRadius: "0 3px 0 0",
        }}
      />

      {/* Text overlay — bottom-left */}
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "flex-start",
          padding: "0 104px 84px",
        }}
      >
        {/* Pill badge */}
        <div
          style={{
            marginBottom: 20,
            opacity: pillP,
            transform: `translateY(${pillY}px)`,
          }}
        >
          <span
            style={{
              display: "inline-block",
              background: s.color,
              color: "#fff",
              padding: "7px 24px",
              borderRadius: 100,
              fontSize: 28,
              fontWeight: 700,
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            {s.pill}
          </span>
        </div>

        {/* Headline */}
        <div
          style={{
            color: "#fff",
            fontSize: 84,
            fontWeight: 900,
            fontFamily: "system-ui, -apple-system, sans-serif",
            lineHeight: 1.08,
            marginBottom: 22,
            whiteSpace: "pre-line",
            opacity: headP,
            transform: `translateY(${headY}px)`,
            textShadow: "0 2px 28px rgba(0,0,0,0.7)",
          }}
        >
          {s.h}
        </div>

        {/* Sub */}
        <div
          style={{
            color: "rgba(255,255,255,0.70)",
            fontSize: 33,
            fontFamily: "system-ui, sans-serif",
            opacity: subP,
          }}
        >
          {s.sub}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Outro CTA ──────────────────────────────────────────────────────────────
const Outro: React.FC<{ locale: "pt-BR" | "en-US" }> = ({ locale }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();

  const bgOp  = spring({ frame: f,      fps, config: { damping: 18 }, from: 0, to: 1 });
  const titleP = spring({ frame: f - 8,  fps, config: { damping: 14 }, from: 0, to: 1 });
  const titleY = interpolate(titleP, [0, 1], [20, 0]);
  const btnOp = spring({ frame: f - 22, fps, config: { damping: 10, stiffness: 140 }, from: 0, to: 1 });
  const btnSc = spring({ frame: f - 22, fps, config: { damping:  8, stiffness: 160 }, from: 0.75, to: 1 });
  const microP = spring({ frame: f - 40, fps, config: { damping: 16 }, from: 0, to: 1 });
  const urlP   = spring({ frame: f - 54, fps, config: { damping: 18 }, from: 0, to: 1 });

  return (
    <AbsoluteFill
      style={{
        background: BG,
        alignItems: "center",
        justifyContent: "center",
        opacity: bgOp,
      }}
    >
      {/* Warm gold radial glow */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 950px 400px at 50% 50%, ${GOLD}20 0%, transparent 70%)`,
        }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 28,
          position: "relative",
        }}
      >
        {/* Main message */}
        <div
          style={{
            fontSize: 72,
            fontWeight: 900,
            color: "#fff",
            fontFamily: "system-ui, sans-serif",
            textAlign: "center",
            lineHeight: 1.12,
            opacity: titleP,
            transform: `translateY(${titleY}px)`,
          }}
        >
          {locale === "pt-BR" ? "Comece grátis agora." : "Start free today."}
          <br />
          <span style={{ color: GOLD }}>
            {locale === "pt-BR" ? "Para o seu Mac." : "For your Mac."}
          </span>
        </div>

        {/* CTA Button */}
        <div
          style={{
            background: GOLD,
            color: BG,
            padding: "24px 68px",
            borderRadius: 16,
            fontSize: 36,
            fontWeight: 900,
            fontFamily: "system-ui, sans-serif",
            opacity: btnOp,
            transform: `scale(${btnSc})`,
          }}
        >
          {locale === "pt-BR" ? "⬇  Download Grátis para Mac" : "⬇  Download Free for Mac"}
        </div>

        {/* Micro-copy */}
        <div
          style={{
            color: "rgba(255,255,255,0.42)",
            fontSize: 24,
            fontFamily: "system-ui, sans-serif",
            opacity: microP,
            textAlign: "center",
          }}
        >
          {locale === "pt-BR"
              ? "macOS 14+ · sem conta necessária · grátis para começar"
              : "macOS 14+ · no account needed · free to start"}
        </div>

        {/* URL */}
        <div
          style={{
            color: "rgba(255,255,255,0.25)",
            fontSize: 22,
            fontFamily: "system-ui, sans-serif",
            opacity: urlP,
          }}
        >
          cafezin.pmatz.com
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── Root composition ───────────────────────────────────────────────────────
export interface PersonaHeroProps { locale: "pt-BR" | "en-US" }

export const PersonaHero: React.FC<PersonaHeroProps> = ({ locale }) => {
  const slides = locale === "pt-BR" ? SLIDES_PT : SLIDES_EN;

  return (
    <AbsoluteFill style={{ background: BG }}>
      <Audio src={staticFile("audio/bg-persona.mp3")} volume={0.60} />

      {/* Persona intro */}
      <Sequence from={0} durationInFrames={INTRO + 5}>
        <PersonaIntro locale={locale} />
      </Sequence>

      {/* Persona slides */}
      {slides.map((s, i) => (
        <Sequence key={i} from={INTRO + i * SLIDE} durationInFrames={SLIDE + 5}>
          <SlideCard s={s} />
        </Sequence>
      ))}

      {/* Outro CTA */}
      <Sequence from={INTRO + N * SLIDE} durationInFrames={OUTRO}>
        <Outro locale={locale} />
      </Sequence>
    </AbsoluteFill>
  );
};
