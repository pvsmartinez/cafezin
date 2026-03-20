import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

const FORCE_UPDATE_URL =
  'https://raw.githubusercontent.com/pvsmartinez/cafezin/main/update/latest.json';

export interface ForceUpdateState {
  forceUpdateOpen: boolean;
  forceUpdateRequired: string;
  forceUpdateChannel: string;
}

export function useForceUpdateCheck(
  compareVersions: (currentVersion: string, minVersion: string) => number,
): ForceUpdateState {
  const [forceUpdateOpen, setForceUpdateOpen] = useState(false);
  const [forceUpdateRequired, setForceUpdateRequired] = useState('');
  const [forceUpdateChannel, setForceUpdateChannel] = useState('release');

  useEffect(() => {
    async function checkMinVersion() {
      try {
        const { getVersion } = await import('@tauri-apps/api/app');
        const [version, channel] = await Promise.all([
          getVersion(),
          invoke<string>('build_channel').catch(() => 'release'),
        ]);
        const response = await fetch(`${FORCE_UPDATE_URL}?t=${Date.now()}`);
        if (!response.ok) return;

        const data = (await response.json()) as { min_versions?: Record<string, string> };
        const minVersions = data.min_versions ?? {};
        const minVersion = minVersions[channel] ?? minVersions.release ?? '0.0.0';

        if (compareVersions(version, minVersion) < 0) {
          setForceUpdateChannel(channel);
          setForceUpdateRequired(minVersion);
          setForceUpdateOpen(true);
        }
      } catch {
        // Never block startup on transient network or updater failures.
      }
    }

    void checkMinVersion();
  }, [compareVersions]);

  return {
    forceUpdateOpen,
    forceUpdateRequired,
    forceUpdateChannel,
  };
}