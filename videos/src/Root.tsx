import { Composition } from "remotion";
import { AppStorePreview } from "./compositions/AppStorePreview";
import { DesktopDemo } from "./compositions/DesktopDemo";

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

      {/* Desktop demo — 16:9, 30s (Google Ads / YouTube) */}
      <Composition
        id="DesktopDemo"
        component={DesktopDemo}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ locale: "pt-BR" }}
      />

      {/* Google Ads bumper — 1:1, 6s */}
      <Composition
        id="BumperAd"
        component={DesktopDemo}
        durationInFrames={180}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={{ locale: "pt-BR" }}
      />
    </>
  );
};
