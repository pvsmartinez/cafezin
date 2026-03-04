import React from "react";
import ReactDOM from "react-dom/client";
/* ── Bundled fonts (no network required in Tauri) ── */
import '@fontsource-variable/nunito';          /* UI: 300–900, wght axis */
import '@fontsource/vollkorn/400.css';         /* Serif: regular */
import '@fontsource/vollkorn/400-italic.css';  /* Serif: italic */
import '@fontsource/vollkorn/600.css';         /* Serif: semibold */
import '@fontsource/fira-code/400.css';        /* Mono: regular */
import '@fontsource/fira-code/500.css';        /* Mono: medium */
import './tokens.css';                         /* Design tokens — compartilhado entre desktop e mobile */
import App from "./App";
import MobileApp from "./MobileApp";

// ── Debug ErrorBoundary — catches render errors and shows them on screen ─────
// TEMPORARY — remove after blank screen is diagnosed
class DebugErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[DebugErrorBoundary]', error, info.componentStack);
  }
  override render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed', inset: 0, background: '#1a0000', color: '#ff6b6b',
          padding: 24, fontFamily: 'monospace', fontSize: 13, overflowY: 'auto',
          zIndex: 99999, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          <strong style={{ fontSize: 16, color: '#ff9o9o' }}>🔴 RENDER ERROR</strong>
          {'\n\n'}
          <strong>{this.state.error.name}: {this.state.error.message}</strong>
          {'\n\n'}
          {this.state.error.stack}
        </div>
      );
    }
    return this.props.children;
  }
}

// Detect mobile platform.
// Primary: TAURI_ENV_PLATFORM is automatically injected by Tauri for every build
// (ios / android / darwin / linux / windows) — no manual export needed.
// Secondary: VITE_TAURI_MOBILE=true from the build script.
// Fallback: narrow + touch viewport (unreliable, kept as last resort).
const platform = import.meta.env.TAURI_ENV_PLATFORM as string | undefined;
const isMobile =
  platform === 'ios' ||
  platform === 'android' ||
  import.meta.env.VITE_TAURI_MOBILE === 'true' ||
  (typeof window !== 'undefined' && window.innerWidth <= 600 && 'ontouchstart' in window);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DebugErrorBoundary>
      {isMobile ? <MobileApp /> : <App />}
    </DebugErrorBoundary>
  </React.StrictMode>,
);
