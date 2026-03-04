import React, { Component, type ErrorInfo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";

// ── DEBUG: remove before release ─────────────────────────────────────────────
class DebugErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('🔴 RENDER ERROR', error, info);
    const existing = document.getElementById('__debug_overlay');
    const d = existing ?? document.createElement('div');
    if (!existing) {
      d.id = '__debug_overlay';
      d.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:#1a0000;color:#ff6b6b;font-family:monospace;font-size:13px;padding:24px;overflow:auto;z-index:99999;white-space:pre-wrap;word-break:break-all';
    }
    d.textContent = '🔴 RENDER ERROR\n\n' + error.message + '\n\n' + (error.stack ?? '') + '\n\nComponent Stack:\n' + info.componentStack;
    if (!existing) document.body.appendChild(d);
  }
  render() {
    if (this.state.error) return null;
    return this.props.children;
  }
}
// ─────────────────────────────────────────────────────────────────────────────
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
    {isMobile ? <MobileApp /> : <App />}
  </React.StrictMode>,
);
