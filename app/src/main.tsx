import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "@pvsmartinez/shared";

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

function applyThemeClass(theme: 'dark' | 'light') {
  const isLight = theme === 'light';
  document.documentElement.classList.toggle('theme-light', isLight);
  document.body.classList.toggle('theme-light', isLight);
}

// Apply saved theme class synchronously before first render so the browser
// paints Frame 0 with the correct palette — prevents flash of dark content
// when the user has configured light mode.
try {
  const saved = localStorage.getItem('cafezin-app-settings');
  if (saved && JSON.parse(saved).theme === 'light') {
    applyThemeClass('light');
  }
} catch { /* ignore malformed JSON or missing localStorage */ }

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
    <ErrorBoundary>
      {isMobile ? <MobileApp /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>,
);
