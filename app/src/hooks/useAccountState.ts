/**
 * useAccountState — React hook for Cafezin account state.
 *
 * Initialises immediately from the local cache (no render-blocking network
 * request) and then refreshes from Supabase in the background.
 *
 * The `refresh` function can be called explicitly — e.g., after login or
 * after the user upgrades their plan — to force a fresh fetch.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchAccountState,
  getCachedAccountState,
  clearAccountCache,
} from '../services/accountService';
import { supabase } from '../services/supabase';
import type { AccountState } from '../types';
import { FREE_ACCOUNT_STATE } from '../types';

export interface UseAccountStateReturn {
  account: AccountState;
  /** True during the initial fetch (cache hit → immediately false). */
  loading: boolean;
  /** Force a fresh network fetch and update state. */
  refresh: () => Promise<void>;
}

const SOFT_REFRESH_INTERVAL_MS = 60 * 1000;

export function useAccountState(): UseAccountStateReturn {
  const [account, setAccount] = useState<AccountState>(
    () => getCachedAccountState() ?? FREE_ACCOUNT_STATE,
  );
  // Start as loading only when there is no cache hit (first render)
  const [loading, setLoading] = useState(() => getCachedAccountState() === null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const lastSoftRefreshRef = useRef(0);

  const runRefresh = useCallback(async (force: boolean) => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    setLoading(true);
    const request = fetchAccountState({ force })
      .then((state) => {
        setAccount(state);
      })
      .finally(() => {
        setLoading(false);
        refreshPromiseRef.current = null;
      });

    refreshPromiseRef.current = request;
    return request;
  }, []);

  const refresh = useCallback(async () => runRefresh(true), [runRefresh]);

  // Fetch in the background on mount
  useEffect(() => { void runRefresh(false); }, [runRefresh]);

  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        clearAccountCache();
        setAccount(FREE_ACCOUNT_STATE);
        setLoading(false);
        return;
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        clearAccountCache();
        lastSoftRefreshRef.current = Date.now();
        void runRefresh(true);
      }
    });

    const handleAuthUpdated = () => {
      clearAccountCache();
      lastSoftRefreshRef.current = Date.now();
      void runRefresh(true);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastSoftRefreshRef.current < SOFT_REFRESH_INTERVAL_MS) return;
      lastSoftRefreshRef.current = now;
      void runRefresh(false);
    };

    window.addEventListener('cafezin:auth-updated', handleAuthUpdated as EventListener);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      authListener.subscription.unsubscribe();
      window.removeEventListener('cafezin:auth-updated', handleAuthUpdated as EventListener);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [runRefresh]);

  useEffect(() => {
    const handleWindowFocus = () => {
      const now = Date.now();
      if (now - lastSoftRefreshRef.current < SOFT_REFRESH_INTERVAL_MS) return;
      lastSoftRefreshRef.current = now;
      void runRefresh(false);
    };

    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, [runRefresh]);

  return { account, loading, refresh };
}
