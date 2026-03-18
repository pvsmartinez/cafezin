/**
 * useAccountState — React hook for Cafezin account state.
 *
 * Initialises immediately from the local cache (no render-blocking network
 * request) and then refreshes from Supabase in the background.
 *
 * The `refresh` function can be called explicitly — e.g., after login or
 * after the user upgrades their plan — to force a fresh fetch.
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchAccountState, getCachedAccountState } from '../services/accountService';
import type { AccountState } from '../types';
import { FREE_ACCOUNT_STATE } from '../types';

export interface UseAccountStateReturn {
  account: AccountState;
  /** True during the initial fetch (cache hit → immediately false). */
  loading: boolean;
  /** Force a fresh network fetch and update state. */
  refresh: () => Promise<void>;
}

export function useAccountState(): UseAccountStateReturn {
  const [account, setAccount] = useState<AccountState>(
    () => getCachedAccountState() ?? FREE_ACCOUNT_STATE,
  );
  // Start as loading only when there is no cache hit (first render)
  const [loading, setLoading] = useState(() => getCachedAccountState() === null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const state = await fetchAccountState();
    setAccount(state);
    setLoading(false);
  }, []);

  // Fetch in the background on mount
  useEffect(() => { void refresh(); }, [refresh]);

  return { account, loading, refresh };
}
