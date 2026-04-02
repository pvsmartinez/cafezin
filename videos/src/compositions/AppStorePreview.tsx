import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig, staticFile } from "remotion";

// iPhone screenshots: pedrin/fastlane/screenshots/cafezin/IMG_3396-3399.PNG
// For Remotion, copy them to cafezin/videos/public/screenshots/
// e.g.:
//   cp ../../pedrin/fastlane/screenshots/cafezin/IMG_3396.PNG public/screenshots/01.png
//   cp ../../pedrin/fastlane/screenshots/cafezin/IMG_3397.PNG public/screenshots/02.png
//   cp ../../pedrin/fastlane/screenshots/cafezin/IMG_3398.PNG public/screenshots/03.png
//   cp ../../pedrin/fastlane/screenshots/cafezin/IMG_3399.PNG public/screenshots/04.png

const SCREENSHOTS = [
  staticFile("screenshots/01.png"),
  staticFile("screenshots/02.png"),
  staticFile("screenshots/03.png"),
  staticFile("screenshots/04.png"),
];

const CAPTIONS: Record<string, string[]> = {
  "pt-BR": [
    "Seu companion app\npara ideias fora da mesa",
    "Capture rascunhos\ne insights em segundos",
    "Anote, grave, organize\ncom IA que não te distrai",
    "Tudo sincroniza\ncom seu Cafezin no desktop",
  ],
  "en-US": [
    "Your companion app\nfor ideas away from your desk",
    "Capture drafts\nand insights in seconds",
    "Write, record, organize\nwith AI that stays out of the way",
    "Everything syncs\nwith Cafezin on your desktop",
  ],
};

const HOLD_FRAMES = 180; // 6s per screenshot
const TRANSITION_FRAMES = 30; // 1s fade

interface Props {
  locale: "pt-BR" | "en-US";
}

export const AppStorePreview: React.FC<Props> = ({ locale }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const totalPerSlide = HOLD_FRAMES + TRANSITION_FRAMES;
  const slideIndex = Math.min(
    Math.floor(frame / totalPerSlide),
    SCREENSHOTS.length - 1
  );
  const slideFrame = frame % totalPerSlide;

  const opacity = interpolate(
    slideFrame,
    [0, TRANSITION_FRAMES, HOLD_FRAMES, HOLD_FRAMES + TRANSITION_FRAMES],
    [0, 1, 1, slideIndex === SCREENSHOTS.length - 1 ? 1 : 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const captionY = spring({
    frame: slideFrame - TRANSITION_FRAMES,
    fps,
    config: { damping: 14, stiffness: 80 },
    from: 40,
    to: 0,
  });

  const captions = CAPTIONS[locale] ?? CAPTIONS["pt-BR"];

  return (
    <AbsoluteFill style={{ backgroundColor: "#1a1a1a" }}>
      <AbsoluteFill style={{ opacity }}>
        <Img
          src={SCREENSHOTS[slideIndex]}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>

      {/* Caption overlay */}
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          padding: "0 48px 140px",
          opacity: interpolate(slideFrame, [TRANSITION_FRAMES, TRANSITION_FRAMES + 20], [0, 1], {
            extrapolateRight: "clamp",
          }),
          transform: `translateY(${captionY}px)`,
        }}
      >
        <p
          style={{
            color: "#fff",
            fontSize: 52,
            fontFamily: "system-ui, -apple-system, sans-serif",
            fontWeight: 700,
            lineHeight: 1.2,
            textAlign: "center",
            textShadow: "0 2px 24px rgba(0,0,0,0.8)",
            whiteSpace: "pre-line",
            margin: 0,
          }}
        >
          {captions[slideIndex]}
        </p>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
