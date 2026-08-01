import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "@pvsmartinez/shared";
import { trackAppOpen } from "./services/analytics";

/* ── Bundled fonts (no network required in Tauri) ── */
import './fonts-latin.css';                      /* latin-only @font-face (all subsets = ~1 MB wasted) */
import './tokens.css';                         /* Design tokens — compartilhado entre desktop e mobile */
import App from "./App";

// Lazy: MobileApp pulls in tldraw/pdfjs/marked/DOMPurify/katex. Loading it
// statically bloated the desktop entry chunk (~1.3 MB) even though desktop
// never renders it. The platform is decided before first render, so the
// correct chunk resolves immediately.
const MobileApp = React.lazy(() => import("./MobileApp"));

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

type ThemeListenerWindow = Window & {
  __cafezinThemeSyncCleanup?: (() => void) | undefined;
};

const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
const handleSystemThemeChange = () => syncThemeClass();
const handleStorageThemeChange = (event: StorageEvent) => {
  if (event.key === 'cafezin-app-settings') {
    syncThemeClass();
  }
};

const themeListenerWindow = window as ThemeListenerWindow;
themeListenerWindow.__cafezinThemeSyncCleanup?.();

if (typeof systemThemeQuery.addEventListener === 'function') {
  systemThemeQuery.addEventListener('change', handleSystemThemeChange);
} else {
  type LegacyMediaQueryList = MediaQueryList & {
    addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  };
  (systemThemeQuery as LegacyMediaQueryList).addListener?.(handleSystemThemeChange);
}

window.addEventListener('storage', handleStorageThemeChange);

themeListenerWindow.__cafezinThemeSyncCleanup = () => {
  if (typeof systemThemeQuery.removeEventListener === 'function') {
    systemThemeQuery.removeEventListener('change', handleSystemThemeChange);
  } else {
    type LegacyMediaQueryList = MediaQueryList & {
      removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    };
    (systemThemeQuery as LegacyMediaQueryList).removeListener?.(handleSystemThemeChange);
  }
  window.removeEventListener('storage', handleStorageThemeChange);
  if (themeListenerWindow.__cafezinThemeSyncCleanup) {
    delete themeListenerWindow.__cafezinThemeSyncCleanup;
  }
};

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    themeListenerWindow.__cafezinThemeSyncCleanup?.();
  });
}

// Detect platform.
// Primary: TAURI_ENV_PLATFORM is automatically injected by Tauri for every build
// (ios / android / darwin / linux / windows) — no manual export needed.
// Secondary: VITE_TAURI_MOBILE=true from the build script.
// Browser builds (vite build --config vite.web.config.ts) get NO platform env —
// those are treated as web: the @tauri-apps shims are active and the desktop
// App renders, with OPFS-backed storage and network-backed AI.
const platform = import.meta.env.TAURI_ENV_PLATFORM as string | undefined;
const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const isMobile =
  platform === 'ios' ||
  platform === 'android' ||
  import.meta.env.VITE_TAURI_MOBILE === 'true' ||
  (isTauri && typeof window !== 'undefined' && window.innerWidth <= 600 && 'ontouchstart' in window);

// Fire-and-forget — analytics failures must never block the app from rendering
trackAppOpen().catch(() => {});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <React.Suspense fallback={null}>
        {isMobile ? <MobileApp /> : <App />}
      </React.Suspense>
    </ErrorBoundary>
  </React.StrictMode>,
);
