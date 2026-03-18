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

function getSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: 'system' | 'dark' | 'light'): 'dark' | 'light' {
  return theme === 'system' ? getSystemTheme() : theme;
}

function readStoredTheme(): 'system' | 'dark' | 'light' {
  try {
    const saved = localStorage.getItem('cafezin-app-settings');
    const parsedTheme = saved ? JSON.parse(saved).theme as 'system' | 'dark' | 'light' | undefined : undefined;
    return parsedTheme ?? 'system';
  } catch {
    return 'system';
  }
}

function syncThemeClass() {
  applyThemeClass(resolveTheme(readStoredTheme()));
}

// Apply saved theme class synchronously before first render so the browser
// paints Frame 0 with the correct palette — prevents flash of dark content
// when the user has configured light mode.
syncThemeClass();

const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
const handleSystemThemeChange = () => syncThemeClass();

if (typeof systemThemeQuery.addEventListener === 'function') {
  systemThemeQuery.addEventListener('change', handleSystemThemeChange);
} else {
  type LegacyMediaQueryList = MediaQueryList & {
    addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  };
  (systemThemeQuery as LegacyMediaQueryList).addListener?.(handleSystemThemeChange);
}

window.addEventListener('storage', (event) => {
  if (event.key === 'cafezin-app-settings') {
    syncThemeClass();
  }
});

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
