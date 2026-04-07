/**
 * aiTrial — device-scoped free AI trial.
 *
 * Each device gets 1 free AI response before the premium gate appears.
 * The device identity reuses the existing `cafezin_device_id` key so the
 * trial is tied to the same anonymous ID used for analytics.
 *
 * Deliberate design choices:
 *   • localStorage-based: simple, no network required, survives app relaunches.
 *   • Not crypto-hardened: clearing localStorage resets it. That's fine — a
 *     user who clears app storage to get extra free calls was not going to pay.
 *   • Granularity: 1 full response (not tokens), so the user experiences a
 *     meaningful interaction before being asked to upgrade.
 */

const TRIAL_USED_KEY = 'cafezin_ai_trial_used';

/** True when the device has already consumed its one free AI response. */
export function isTrialUsed(): boolean {
  return localStorage.getItem(TRIAL_USED_KEY) === 'true';
}

/** Mark the trial as consumed. Call this after the first successful response. */
export function markTrialUsed(): void {
  localStorage.setItem(TRIAL_USED_KEY, 'true');
}
