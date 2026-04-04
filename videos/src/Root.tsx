import { Composition } from "remotion";
import { AppStorePreview } from "./compositions/AppStorePreview";
import { DesktopDemo } from "./compositions/DesktopDemo";
import { PersonaHero } from "./compositions/PersonaHero";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* App Store Preview — iOS portrait 9:16, 30s */}
      <Composition
        id="AppStorePreview"
        component={AppStorePreview}
        durationInFrames={900} // 30s @ 30fps
        fps={30}
        width={1290}
        height={2796}
        defaultProps={{ locale: "pt-BR" }}
      />
      <Composition
        id="AppStorePreview-EN"
        component={AppStorePreview}
        durationInFrames={900}
        fps={30}
        width={1290}
        height={2796}
        defaultProps={{ locale: "en-US" }}
      />

      {/* Desktop demo — 16:9, 18s (Google Ads / YouTube / landing)
          Timing: 40 intro + 3×140 slides + 80 outro = 540 frames */}
      <Composition
        id="DesktopDemo"
        component={DesktopDemo}
        durationInFrames={540}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ locale: "pt-BR" }}
      />
      <Composition
        id="DesktopDemo-EN"
        component={DesktopDemo}
        durationInFrames={540}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ locale: "en-US" }}
      />

      {/* Google Ads bumper — 1:1, 6s (plays intro + first slide) */}
      <Composition
        id="BumperAd"
        component={DesktopDemo}
        durationInFrames={180}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={{ locale: "pt-BR" }}
      />

      {/* Persona Hero — 16:9, 25.5s — landing page hero + Google Ads skippable
          Focus: writers · educators · students — AI as protagonist
          Timing: 90 intro + 3×190 slides + 105 outro = 765 frames */}
      <Composition
        id="PersonaHero"
        component={PersonaHero}
        durationInFrames={765}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ locale: "pt-BR" }}
      />
      <Composition
        id="PersonaHero-EN"
        component={PersonaHero}
        durationInFrames={765}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ locale: "en-US" }}
      />
    </>
  );
};
