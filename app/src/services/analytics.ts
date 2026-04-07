/**
 * GA4 Measurement Protocol — app-side analytics.
 *
 * Sends events directly to GA4 from inside the desktop app so Google Ads can
 * optimize toward real installs instead of landing-page button clicks.
 *
 * Events sent:
 *   - app_first_open  (once, on first ever launch — stored in localStorage)
 *   - app_open        (every launch)
 *
 * Uses tauriFetch so requests go through the Tauri HTTP plugin (required for
 * outbound HTTP in a Tauri app — browser fetch is blocked for external URLs).
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

const MEASUREMENT_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID as string;
const API_SECRET     = import.meta.env.VITE_GA4_API_SECRET as string;

const CLIENT_ID_KEY       = 'cafezin-analytics-client-id';
const FIRST_OPEN_SENT_KEY = 'cafezin-analytics-first-open-sent';

const GA4_ENDPOINT = `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getOrCreateClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

function getPlatform(): string {
  const p = import.meta.env.TAURI_ENV_PLATFORM as string | undefined;
  if (p === 'darwin') return 'mac';
  if (p === 'windows') return 'windows';
  if (p === 'linux') return 'linux';
  if (p === 'ios') return 'ios';
  if (p === 'android') return 'android';
  return p ?? 'unknown';
}

async function sendEvent(name: string, params: Record<string, string | number> = {}): Promise<void> {
  if (!MEASUREMENT_ID || !API_SECRET) return; // skip if not configured

  const body = JSON.stringify({
    client_id: getOrCreateClientId(),
    events: [{ name, params: { ...params, engagement_time_msec: 1 } }],
  });

  try {
    await tauriFetch(GA4_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch {
    // Analytics failures are non-fatal — silently ignore
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call once at app startup. Sends:
 *   - `app_first_open` if this is the first ever launch on this device
 *   - `app_open` on every launch
 */
export async function trackAppOpen(): Promise<void> {
  const platform = getPlatform();
  const version  = import.meta.env.VITE_APP_VERSION as string | undefined ?? 'unknown';

  const isFirstOpen = !localStorage.getItem(FIRST_OPEN_SENT_KEY);
  if (isFirstOpen) {
    localStorage.setItem(FIRST_OPEN_SENT_KEY, '1');
    await sendEvent('app_first_open', { platform, version });
  }

  await sendEvent('app_open', { platform, version });
}
