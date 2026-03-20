import { useEffect, useMemo, useState } from 'react';
import type { AppSettings } from '../types';
import { APP_SETTINGS_KEY, DEFAULT_APP_SETTINGS } from '../types';
import { setupI18n } from '../i18n';

export function loadAppSettings(): AppSettings {
  try {
    const saved = localStorage.getItem(APP_SETTINGS_KEY);
    if (saved) return { ...DEFAULT_APP_SETTINGS, ...JSON.parse(saved) };
  } catch {
    // ignore invalid persisted settings and fall back to defaults
  }
  return DEFAULT_APP_SETTINGS;
}

function getSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export interface AppShellState {
  initSettings: AppSettings;
  splash: boolean;
  splashVisible: boolean;
  appSettings: AppSettings;
  setAppSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  systemTheme: 'dark' | 'light';
  resolvedTheme: 'dark' | 'light';
  isDarkTheme: boolean;
  sidebarMode: 'explorer' | 'search';
  setSidebarMode: React.Dispatch<React.SetStateAction<'explorer' | 'search'>>;
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  homeVisible: boolean;
  setHomeVisible: React.Dispatch<React.SetStateAction<boolean>>;
  terminalOpen: boolean;
  setTerminalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  terminalHeight: number;
  setTerminalHeight: React.Dispatch<React.SetStateAction<number>>;
  terminalRequestCd: string | undefined;
  setTerminalRequestCd: React.Dispatch<React.SetStateAction<string | undefined>>;
  terminalRequestRun: string | undefined;
  setTerminalRequestRun: React.Dispatch<React.SetStateAction<string | undefined>>;
  focusMode: boolean;
  setFocusMode: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useAppShellState(): AppShellState {
  const initSettings = useMemo(loadAppSettings, []);

  const [splash, setSplash] = useState(true);
  const [splashVisible, setSplashVisible] = useState(true);
  const [appSettings, setAppSettings] = useState<AppSettings>(() => initSettings);
  const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>(() => getSystemTheme());
  const [sidebarMode, setSidebarMode] = useState<'explorer' | 'search'>('explorer');
  const [sidebarOpen, setSidebarOpen] = useState(initSettings.sidebarOpenDefault);
  const [homeVisible, setHomeVisible] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(240);
  const [terminalRequestCd, setTerminalRequestCd] = useState<string | undefined>();
  const [terminalRequestRun, setTerminalRequestRun] = useState<string | undefined>();
  const [focusMode, setFocusMode] = useState(false);

  const resolvedTheme = appSettings.theme === 'system' ? systemTheme : appSettings.theme;
  const isDarkTheme = resolvedTheme === 'dark';

  useEffect(() => {
    const hideSplashTimer = setTimeout(() => setSplashVisible(false), 700);
    const removeSplashTimer = setTimeout(() => setSplash(false), 1060);
    return () => {
      clearTimeout(hideSplashTimer);
      clearTimeout(removeSplashTimer);
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const updateTheme = (event?: MediaQueryListEvent) => {
      setSystemTheme(event?.matches ?? mediaQuery.matches ? 'dark' : 'light');
    };

    updateTheme();

    if ('addEventListener' in mediaQuery) {
      mediaQuery.addEventListener('change', updateTheme);
      return () => mediaQuery.removeEventListener('change', updateTheme);
    }

    const legacyMediaQuery = mediaQuery as MediaQueryList & {
      addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
      removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    };
    legacyMediaQuery.addListener?.(updateTheme);
    return () => legacyMediaQuery.removeListener?.(updateTheme);
  }, []);

  useEffect(() => {
    setupI18n(appSettings.locale);
  }, [appSettings.locale]);

  return {
    initSettings,
    splash,
    splashVisible,
    appSettings,
    setAppSettings,
    systemTheme,
    resolvedTheme,
    isDarkTheme,
    sidebarMode,
    setSidebarMode,
    sidebarOpen,
    setSidebarOpen,
    homeVisible,
    setHomeVisible,
    terminalOpen,
    setTerminalOpen,
    terminalHeight,
    setTerminalHeight,
    terminalRequestCd,
    setTerminalRequestCd,
    terminalRequestRun,
    setTerminalRequestRun,
    focusMode,
    setFocusMode,
  };
}