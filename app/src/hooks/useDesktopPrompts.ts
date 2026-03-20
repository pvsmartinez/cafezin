import { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { SK } from '../services/storageKeys';

const UPDATE_SUGGESTION_KEY = SK.UPDATE_SUGGESTION;
const UPDATE_TOAST_DISMISSED_KEY = SK.UPDATE_TOAST_DISMISSED;
const DESKTOP_ONBOARDING_KEY = SK.DESKTOP_ONBOARDING;
const LEGACY_SYNC_PROMPT_KEY = SK.LEGACY_SYNC_PROMPT;
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type SettingsTab = 'general' | 'ai' | 'workspace' | 'agent' | 'sync' | 'account';

export interface DesktopPromptsState {
  showUpdateReleaseModal: boolean;
  setShowUpdateReleaseModal: React.Dispatch<React.SetStateAction<boolean>>;
  updateToastVersion: string | null;
  setUpdateToastVersion: React.Dispatch<React.SetStateAction<string | null>>;
  showMobilePending: boolean;
  setShowMobilePending: React.Dispatch<React.SetStateAction<boolean>>;
  desktopOnboardingSeen: boolean;
  showDesktopOnboarding: boolean;
  handleCloseDesktopOnboarding: () => void;
  handleOpenDesktopHelp: () => void;
  handleContactUs: () => void;
}

interface UseDesktopPromptsOptions {
  splash: boolean;
  forceUpdateOpen: boolean;
  appLocale: 'en' | 'pt-BR' | undefined;
  openSettings: (tab?: SettingsTab) => void;
  compareVersions: (currentVersion: string, nextVersion: string) => number;
}

export function useDesktopPrompts({
  splash,
  forceUpdateOpen,
  appLocale,
  openSettings,
  compareVersions,
}: UseDesktopPromptsOptions): DesktopPromptsState {
  const [showUpdateReleaseModal, setShowUpdateReleaseModal] = useState(false);
  const [updateToastVersion, setUpdateToastVersion] = useState<string | null>(null);
  const [showMobilePending, setShowMobilePending] = useState(false);
  const [desktopOnboardingSeen, setDesktopOnboardingSeen] = useState(
    () => localStorage.getItem(DESKTOP_ONBOARDING_KEY) === '1',
  );
  const [showDesktopOnboarding, setShowDesktopOnboarding] = useState(false);

  useEffect(() => {
    if (!isTauri) return;

    let cancelled = false;

    async function maybeSuggestReleaseUpdate() {
      try {
        const channel = await invoke<string>('build_channel').catch(() => 'release');
        if (channel !== 'release') return;

        const [{ check }, { getVersion }] = await Promise.all([
          import('@tauri-apps/plugin-updater'),
          import('@tauri-apps/api/app'),
        ]);

        const [update, currentVersion] = await Promise.all([check(), getVersion()]);
        if (cancelled || !update?.available || !update.version) return;
        if (compareVersions(update.version, currentVersion) <= 0) return;

        const lastSuggested = localStorage.getItem(UPDATE_SUGGESTION_KEY);
        if (lastSuggested === update.version) return;

        const today = new Date().toISOString().slice(0, 10);
        const dismissed = localStorage.getItem(UPDATE_TOAST_DISMISSED_KEY);
        if (dismissed === `${update.version}:${today}`) return;

        setTimeout(() => {
          if (!cancelled) setUpdateToastVersion(update.version);
        }, 1800);
      } catch {
        // Silent fail — update suggestion should never block normal startup.
      }
    }

    void maybeSuggestReleaseUpdate();
    return () => {
      cancelled = true;
    };
  }, [compareVersions]);

  useEffect(() => {
    if (splash || forceUpdateOpen || desktopOnboardingSeen) return;
    setShowDesktopOnboarding(true);
  }, [desktopOnboardingSeen, forceUpdateOpen, splash]);

  const handleCloseDesktopOnboarding = useCallback(() => {
    localStorage.setItem(DESKTOP_ONBOARDING_KEY, '1');
    localStorage.setItem(LEGACY_SYNC_PROMPT_KEY, '1');
    setDesktopOnboardingSeen(true);
    setShowDesktopOnboarding(false);
  }, []);

  const handleOpenDesktopHelp = useCallback(() => {
    setShowDesktopOnboarding(true);
  }, []);

  const handleContactUs = useCallback(() => {
    const contactUrl = appLocale === 'pt-BR'
      ? 'https://cafezin.pmatz.com/br/contact'
      : 'https://cafezin.pmatz.com/contact';
    openUrl(contactUrl).catch(() => window.open(contactUrl, '_blank', 'noopener,noreferrer'));
  }, [appLocale]);

  useEffect(() => {
    if (!isTauri) return;
    const listeners = [
      listen('menu-help-tour', () => handleOpenDesktopHelp()),
      listen('menu-contact-us', () => handleContactUs()),
    ];
    return () => {
      listeners.forEach((listener) => listener.then((fn) => fn()).catch(() => {}));
    };
  }, [handleContactUs, handleOpenDesktopHelp]);

  useEffect(() => {
    const alreadySkipped = localStorage.getItem(LEGACY_SYNC_PROMPT_KEY);
    const alreadyConnected = localStorage.getItem(SK.SYNC_ACCOUNT_TOKEN);
    if (!desktopOnboardingSeen) return;
    if (!alreadySkipped && !alreadyConnected) {
      localStorage.setItem(LEGACY_SYNC_PROMPT_KEY, '1');
      openSettings('sync');
    }
  }, [desktopOnboardingSeen, openSettings]);

  return {
    showUpdateReleaseModal,
    setShowUpdateReleaseModal,
    updateToastVersion,
    setUpdateToastVersion,
    showMobilePending,
    setShowMobilePending,
    desktopOnboardingSeen,
    showDesktopOnboarding,
    handleCloseDesktopOnboarding,
    handleOpenDesktopHelp,
    handleContactUs,
  };
}