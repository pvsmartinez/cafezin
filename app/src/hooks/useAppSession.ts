/**
 * useAppSession — anonymous app-session telemetry
 *
 * Fires once per day on app launch:
 *   - Generates (or reuses) a random device_id stored in localStorage.
 *   - Attaches the Supabase user_id if the user is logged in.
 *   - POSTs an 'app_session' event to the track-landing edge function.
 *
 * Failures are silently swallowed — analytics must never crash the app.
 */
import { useEffect } from 'react';
import { fetch } from '@tauri-apps/plugin-http';
import { getSession } from '../services/syncConfig';

const DEVICE_ID_KEY    = 'cafezin_device_id';
const LAST_SESSION_KEY = 'cafezin_last_session_date';

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function detectPlatform(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Win/.test(ua)) return 'windows';
  return 'mac';
}

async function logAppSession(): Promise<void> {
  const today = todayISO();
  if (localStorage.getItem(LAST_SESSION_KEY) === today) return;

  const supabaseUrl = (import.meta.env as Record<string, string>).VITE_SUPABASE_URL;
  if (!supabaseUrl) return;

  const deviceId = getOrCreateDeviceId();
  const platform = detectPlatform();
  const session  = await getSession().catch(() => null);
  const userId   = session?.user?.id ?? null;

  try {
    await fetch(`${supabaseUrl}/functions/v1/track-landing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventName: 'app_session',
        pagePath:  '/app',
        platform,
        device_id: deviceId,
        user_id:   userId,
      }),
    });
    localStorage.setItem(LAST_SESSION_KEY, today);
  } catch {
    // Silent — analytics must not crash the app
  }
}

export function useAppSession(): void {
  useEffect(() => {
    void logAppSession();
  }, []);
}
