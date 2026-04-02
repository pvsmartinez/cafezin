import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig, staticFile } from "remotion";

// Desktop screenshots: cafezin/landing/screen-*.png
// Copy to cafezin/videos/public/desktop/
//   cp ../../landing/screen-editor.png public/desktop/editor.png
//   cp ../../landing/screen-canvas.png public/desktop/canvas.png
//   cp ../../landing/screen-settings.png public/desktop/settings.png

const SLIDES = [
  { img: staticFile("desktop/editor.png"), title: "Markdown editor", sub: "Write without leaving your flow" },
  { img: staticFile("desktop/canvas.png"), title: "Visual canvas", sub: "Connect ideas, build slides" },
  { img: staticFile("desktop/settings.png"), title: "Your AI, your keys", sub: "GPT-4o · Claude · Gemini · Groq" },
];

const SLIDES_PT: typeof SLIDES = [
  { img: staticFile("desktop/editor.png"), title: "Editor Markdown", sub: "Escreva sem sair do fluxo" },
  { img: staticFile("desktop/canvas.png"), title: "Canvas visual", sub: "Conecte ideias, crie slides" },
  { img: staticFile("desktop/settings.png"), title: "Sua IA, suas chaves", sub: "GPT-4o · Claude · Gemini · Groq" },
];

const HOLD = 200;
const TRANS = 30;

interface Props {
  locale: "pt-BR" | "en-US";
}

export const DesktopDemo: React.FC<Props> = ({ locale }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const slides = locale === "pt-BR" ? SLIDES_PT : SLIDES;
  const perSlide = HOLD + TRANS;
  const idx = Math.min(Math.floor(frame / perSlide), slides.length - 1);
  const sf = frame % perSlide;

  const opacity = interpolate(
    sf,
    [0, TRANS, HOLD, HOLD + TRANS],
    [0, 1, 1, idx === slides.length - 1 ? 1 : 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const scale = interpolate(sf, [0, HOLD + TRANS], [1.04, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const titleY = spring({ frame: sf - TRANS, fps, config: { damping: 12 }, from: 30, to: 0 });

  return (
    <AbsoluteFill style={{ backgroundColor: "#111" }}>
      <AbsoluteFill style={{ opacity }}>
        <Img
          src={slides[idx].img}
          style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})` }}
        />
        {/* dark gradient bottom */}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 50%)" }} />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          padding: "0 80px 80px",
          opacity: interpolate(sf, [TRANS, TRANS + 15], [0, 1], { extrapolateRight: "clamp" }),
          transform: `translateY(${titleY}px)`,
        }}
      >
        <h2 style={{ color: "#fff", fontSize: 64, fontWeight: 800, fontFamily: "system-ui, sans-serif", margin: "0 0 12px" }}>
          {slides[idx].title}
        </h2>
        <p style={{ color: "rgba(255,255,255,0.75)", fontSize: 36, fontFamily: "system-ui, sans-serif", margin: 0 }}>
          {slides[idx].sub}
        </p>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
