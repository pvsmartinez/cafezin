/**
 * aiTrial — device-scoped free AI trial.
 *
 * Each device gets 3 free AI responses before the premium gate appears.
 * The device identity reuses the existing `cafezin_device_id` key so the
 * trial is tied to the same anonymous ID used for analytics.
 *
 * Deliberate design choices:
 *   • localStorage-based: simple, no network required, survives app relaunches.
 *   • Not crypto-hardened: clearing localStorage resets it. That's fine — a
 *     user who clears app storage to get extra free calls was not going to pay.
 *   • Granularity: 1 full response (not tokens), so the user experiences a
 *     meaningful interaction before being asked to upgrade.
 *   • Backwards compat: legacy boolean 'true' value counts as trial exhausted.
 */

import { SK } from './storageKeys';

const TRIAL_USED_KEY = 'cafezin_ai_trial_used';
const TRIAL_LIMIT = 3;

/** Number of free responses remaining on this device. */
export function getTrialRemaining(): number {
  const stored = localStorage.getItem(TRIAL_USED_KEY);
  // Backwards compat: legacy value was 'true' (boolean string) → treat as exhausted
  if (stored === 'true') return 0;
  const used = parseInt(stored ?? '0', 10);
  return Math.max(0, TRIAL_LIMIT - used);
}

/** True when the device has consumed all free trial responses. */
export function isTrialUsed(): boolean {
  return getTrialRemaining() === 0;
}

/** Increment trial usage counter. Call this after each successful response. */
export function markTrialUsed(): void {
  const stored = localStorage.getItem(TRIAL_USED_KEY);
  if (stored === 'true') return; // already exhausted in legacy format
  const used = parseInt(stored ?? '0', 10);
  localStorage.setItem(TRIAL_USED_KEY, String(used + 1));
}

/**
 * Stable anonymous device identifier for the trial path.
 * Generated once and persisted in localStorage — no account needed.
 * Sent as X-Trial-Token to the ai-proxy edge function.
 */
export function getDeviceTrialToken(): string {
  const key = SK.TRIAL_DEVICE_ID;
  let token = localStorage.getItem(key);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(key, token);
  }
  return token;
}
