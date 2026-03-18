/**
 * accountService — Cafezin account state and entitlement cache.
 *
 * Calls the Supabase RPC `get_my_account_state()` and persists the result
 * in localStorage with a tiered TTL:
 *
 *   Free users:    30-minute TTL — short, status rarely changes mid-session.
 *   Premium users: 5-day grace period — tolerate short offline periods without
 *                  revoking access every time the network is unavailable.
 *
 * This is the only place that should read from Supabase for account state.
 * All app code should consume `useAccountState` (the React hook) or call
 * `getCachedAccountState()` for non-reactive reads.
 */

import { supabase } from './supabase';
import type { AccountState } from '../types';
import { FREE_ACCOUNT_STATE } from '../types';

// ── Cache config ───────────────────────────────────────────────────────────────

const CACHE_KEY       = 'cafezin-account-state-v1';
const FREE_TTL_MS     = 30 * 60 * 1000;               // 30 minutes
const PREMIUM_GRACE_MS = 5 * 24 * 60 * 60 * 1000;     // 5 days

interface CacheEntry {
  state: AccountState;
  cachedAt: number;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function readCache(): AccountState | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { state, cachedAt }: CacheEntry = JSON.parse(raw);
    const age    = Date.now() - cachedAt;
    const maxAge = state.isPremium ? PREMIUM_GRACE_MS : FREE_TTL_MS;
    return age > maxAge ? null : state;
  } catch {
    return null;
  }
}

function writeCache(state: AccountState): void {
  try {
    const entry: CacheEntry = { state, cachedAt: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage quota exceeded or private-browsing restriction — non-fatal
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns the cached account state if still valid, or null if expired / absent.
 * Safe to call synchronously from render — no network access.
 */
export function getCachedAccountState(): AccountState | null {
  return readCache();
}

/**
 * Clears the persisted cache.
 * Call this on sign-out or after a successful subscription change so the next
 * `fetchAccountState()` gets a fresh result.
 */
export function clearAccountCache(): void {
  localStorage.removeItem(CACHE_KEY);
}

/**
 * Fetches the canonical account state from Supabase and updates the cache.
 *
 * Falls back gracefully:
 *   • Not authenticated → returns FREE_ACCOUNT_STATE (clears cache)
 *   • Network / RPC error → returns cached state (even if premium grace applies)
 *   • No cache + error → returns FREE_ACCOUNT_STATE with authenticated=true
 */
export async function fetchAccountState(): Promise<AccountState> {
  try {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      clearAccountCache();
      return FREE_ACCOUNT_STATE;
    }

    const { data, error } = await supabase.rpc('get_my_account_state');

    if (error || !data) {
      // Prefer cached state on error (covers offline + network blips)
      return readCache() ?? { ...FREE_ACCOUNT_STATE, authenticated: true };
    }

    const state: AccountState = {
      authenticated:     true,
      plan:              (data.plan   as AccountState['plan'])   ?? 'free',
      status:            (data.status as AccountState['status']) ?? 'inactive',
      isPremium:         data.isPremium         ?? false,
      canUseAI:          data.canUseAI          ?? false,
      currentPeriodEnd:  data.currentPeriodEnd  ?? null,
      cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? false,
      trialEnd:          data.trialEnd          ?? null,
    };

    writeCache(state);
    return state;
  } catch {
    return readCache() ?? FREE_ACCOUNT_STATE;
  }
}

/**
 * Creates a Lemon Squeezy checkout session for the current user.
 * Returns the hosted checkout URL to open in the browser.
 * Throws if the user is not authenticated or the request fails.
 */
export async function createCheckoutUrl(): Promise<string> {
  const { data, error } = await supabase.functions.invoke('create-checkout', {
    method: 'POST',
  });
  if (error) throw error;
  if (!data?.url) throw new Error('No checkout URL returned');
  return data.url as string;
}
