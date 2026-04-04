import React from "react";
import {
  AbsoluteFill, Audio, Img, interpolate, spring,
  useCurrentFrame, useVideoConfig, staticFile, Sequence,
} from "remotion";

// ── Brand ─────────────────────────────────────────────────────────────────
const GOLD = "#d4a853";
const BG   = "#0c0b09";

// ── Timing @ 30 fps ────────────────────────────────────────────────────────
// Intro: 40f | Each slide: 140f (110 hold + 30 trans) | Outro: 80f
// Total: 40 + 3×140 + 80 = 540 frames = 18 s
const INTRO = 40;
const HOLD  = 110;
const TRANS =  30;
const SLIDE = HOLD + TRANS;   // 140 frames per slot
const N     =   3;
const OUTRO =  80;

// ── Slide data ─────────────────────────────────────────────────────────────
interface SlideData {
  img: string; pill: string; h: string; sub: string; color: string;
}
const PT: SlideData[] = [
  { img: staticFile("desktop/editor.png"),   pill: "✍️  IA no seu projeto real",  h: "Escreva mais.\nPense com clareza.", sub: "Sem sair do fluxo. Sem perder a voz.",     color: GOLD },
  { img: staticFile("desktop/canvas.png"),   pill: "🎞  Slides & Canvas",         h: "Ideias viram slides.\nSem sair do app.",  sub: "Canvas visual · frames · exportação", color: "#9c6fe4" },
  { img: staticFile("desktop/settings.png"), pill: "⚙  Sua IA, suas chaves",      h: "GPT-4o · Claude\nGemini · Groq",    sub: "Zero lock-in. Seus arquivos, local.",      color: "#3db89a" },
];
const EN: SlideData[] = [
  { img: staticFile("desktop/editor.png"),   pill: "✍️  AI inside your real project", h: "Write more.\nThink clearer.",      sub: "Stay in flow. Keep your voice.",          color: GOLD },
  { img: staticFile("desktop/canvas.png"),   pill: "🎞  Slides & Canvas",             h: "Ideas become slides.\nInstantly.", sub: "Visual canvas · frames · export",         color: "#9c6fe4" },
  { img: staticFile("desktop/settings.png"), pill: "⚙  Your AI, your keys",           h: "GPT-4o · Claude\nGemini · Groq",  sub: "Zero vendor lock-in. Local files.",       color: "#3db89a" },
];

// ── Slide card ─────────────────────────────────────────────────────────────
const SlideCard: React.FC<{ s: SlideData }> = ({ s }) => {
  const f   = useCurrentFrame();           // local frame inside Sequence
  const { fps } = useVideoConfig();

  // Screenshot enters sliding from right + scale flattens
  const enter = spring({ frame: f, fps, config: { damping: 22, stiffness: 65 } });
  const imgX  = interpolate(enter, [0, 1], [180, 0]);

  // Ken Burns: slow zoom-out over the slide lifetime
  const zoom = interpolate(f, [0, HOLD + TRANS], [1.1, 1.01], { extrapolateRight: "clamp" });

  // Exit: fade out last TRANS frames
  const exit = interpolate(f, [HOLD, HOLD + TRANS], [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Staggered text entrances
  const pillP = spring({ frame: f -  6, fps, config: { damping: 14, stiffness: 130 } });
  const pillY = interpolate(pillP, [0, 1], [24, 0]);
  const headP = spring({ frame: f - 18, fps, config: { damping: 14, stiffness:  90 } });
  const headY = interpolate(headP, [0, 1], [36, 0]);
  const subP  = spring({ frame: f - 30, fps, config: { damping: 16 } });

  // Accent bar grows with slide entrance
  const barW = interpolate(enter, [0, 1], [0, 100]);

  return (
    <AbsoluteFill style={{ opacity: exit, overflow: "hidden" }}>
      {/* Screenshot with lateral slide + ken burns */}
      <AbsoluteFill style={{ transform: `translateX(${imgX}px) scale(${zoom})`, transformOrigin: "center" }}>
        <Img src={s.img} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>

      {/* Cinematic overlays */}
      <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(0,0,0,0.93) 0%, rgba(0,0,0,0.55) 30%, rgba(0,0,0,0.06) 65%, transparent 100%)" }} />
      <AbsoluteFill style={{ background: "linear-gradient(to right, rgba(0,0,0,0.45) 0%, transparent 55%)" }} />

      {/* Brand accent bar */}
      <div style={{ position: "absolute", bottom: 0, left: 0, height: 5, width: `${barW}%`, background: s.color, borderRadius: "0 3px 0 0" }} />

      {/* Text */}
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-start", padding: "0 104px 84px" }}>
        {/* Pill badge */}
        <div style={{ marginBottom: 20, opacity: pillP, transform: `translateY(${pillY}px)` }}>
          <span style={{ display: "inline-block", background: s.color, color: "#fff", padding: "7px 22px", borderRadius: 100, fontSize: 26, fontWeight: 700, fontFamily: "system-ui, -apple-system, sans-serif" }}>
            {s.pill}
          </span>
        </div>

        {/* Headline */}
        <div style={{ color: "#fff", fontSize: 82, fontWeight: 900, fontFamily: "system-ui, -apple-system, sans-serif", lineHeight: 1.08, marginBottom: 22, whiteSpace: "pre-line", opacity: headP, transform: `translateY(${headY}px)`, textShadow: "0 2px 24px rgba(0,0,0,0.6)" }}>
          {s.h}
        </div>

        {/* Sub */}
        <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 33, fontFamily: "system-ui, sans-serif", opacity: subP }}>
          {s.sub}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Intro: logo burst ──────────────────────────────────────────────────────
const Intro: React.FC = () => {
  const f   = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sc     = spring({ frame: f,      fps, config: { damping: 14, stiffness: 90 }, from: 0.6, to: 1 });
  const op     = spring({ frame: f,      fps, config: { damping: 12 }, from: 0, to: 1 });
  const tagOp  = spring({ frame: f - 12, fps, config: { damping: 12 }, from: 0, to: 1 });
  const tagY   = interpolate(tagOp, [0, 1], [16, 0]);
  const exitOp = interpolate(f, [INTRO - 14, INTRO], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: BG, alignItems: "center", justifyContent: "center", opacity: exitOp }}>
      <div style={{ textAlign: "center", opacity: op, transform: `scale(${sc})` }}>
        <div style={{ fontSize: 110, fontWeight: 900, color: GOLD, fontFamily: "system-ui, -apple-system, sans-serif", letterSpacing: "-0.03em" }}>
          Cafezin
        </div>
        <div style={{ fontSize: 36, color: "rgba(255,255,255,0.5)", fontFamily: "system-ui, sans-serif", marginTop: 14, opacity: tagOp, transform: `translateY(${tagY}px)` }}>
          O workspace de IA para criadores
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── Outro: CTA ────────────────────────────────────────────────────────────
const Outro: React.FC = () => {
  const f   = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bgOp  = spring({ frame: f,      fps, config: { damping: 18 }, from: 0, to: 1 });
  const btnOp = spring({ frame: f - 18, fps, config: { damping: 10, stiffness: 140 }, from: 0, to: 1 });
  const btnSc = spring({ frame: f - 18, fps, config: { damping:  8, stiffness: 160 }, from: 0.75, to: 1 });
  const urlOp = spring({ frame: f - 34, fps, config: { damping: 14 }, from: 0, to: 1 });

  return (
    <AbsoluteFill style={{ background: BG, alignItems: "center", justifyContent: "center", opacity: bgOp }}>
      {/* Radial glow */}
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse 900px 350px at 50% 50%, ${GOLD}1c 0%, transparent 70%)` }} />

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 32, position: "relative" }}>
        <div style={{ fontSize: 74, fontWeight: 900, color: "#fff", fontFamily: "system-ui, sans-serif", textAlign: "center", lineHeight: 1.15 }}>
          Comece a escrever hoje.
          <br /><span style={{ color: GOLD }}>Grátis para sempre.</span>
        </div>

        <div style={{ background: GOLD, color: BG, padding: "24px 68px", borderRadius: 16, fontSize: 36, fontWeight: 900, fontFamily: "system-ui, sans-serif", opacity: btnOp, transform: `scale(${btnSc})` }}>
          ⬇  Download grátis para Mac
        </div>

        <div style={{ color: "rgba(255,255,255,0.32)", fontSize: 26, fontFamily: "system-ui, sans-serif", opacity: urlOp }}>
          cafezin.pmatz.com
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── Root composition ───────────────────────────────────────────────────────
interface Props { locale: "pt-BR" | "en-US" }

export const DesktopDemo: React.FC<Props> = ({ locale }) => {
  const slides = locale === "pt-BR" ? PT : EN;

  return (
    <AbsoluteFill style={{ background: BG }}>
      {/* Background ambient music */}
      <Audio src={staticFile("audio/bg.mp3")} volume={0.35} />

      {/* Intro */}
      <Sequence from={0} durationInFrames={INTRO + 5}>
        <Intro />
      </Sequence>

      {/* Slides */}
      {slides.map((s, i) => (
        <Sequence key={i} from={INTRO + i * SLIDE} durationInFrames={SLIDE + 5}>
          <SlideCard s={s} />
        </Sequence>
      ))}

      {/* Outro */}
      <Sequence from={INTRO + N * SLIDE} durationInFrames={OUTRO}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
};
