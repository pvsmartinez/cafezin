import { fetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import { EDITOR_HEADERS } from './constants';

// ── Storage keys ──────────────────────────────────────────────────────────────

const LEGACY_OAUTH_TOKEN_KEY = 'copilot-github-oauth-token';

function normalizeOAuthClientId(clientId?: string | null): string {
  return clientId?.trim() ?? '';
}

function getOAuthTokenStorageKey(clientId?: string | null): string {
  const normalized = normalizeOAuthClientId(clientId);
  return normalized ? `${LEGACY_OAUTH_TOKEN_KEY}:${normalized}` : LEGACY_OAUTH_TOKEN_KEY;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeviceFlowState {
  userCode: string;
  verificationUri: string;
  expiresIn: number; // seconds
}

// ── Public helpers ────────────────────────────────────────────────────────────

export function getStoredOAuthToken(clientId?: string | null): string | null {
  const namespaced = localStorage.getItem(getOAuthTokenStorageKey(clientId));
  if (namespaced) return namespaced;
  return localStorage.getItem(LEGACY_OAUTH_TOKEN_KEY);
}

export function clearOAuthToken(clientId?: string | null): void {
  localStorage.removeItem(getOAuthTokenStorageKey(clientId));
  localStorage.removeItem(LEGACY_OAUTH_TOKEN_KEY);
  _sessionToken = null;
  _sessionTokenExpiry = 0;
  _tokenRefreshPending = null;
}

/**
 * Start GitHub Device Flow. Calls onState with the user_code and
 * verification_uri to display, then polls until the user authorizes.
 * Resolves when the token is stored; throws on error or timeout.
 */
export async function startDeviceFlow(
  clientId: string,
  onState: (state: DeviceFlowState) => void
): Promise<void> {
  const normalizedClientId = normalizeOAuthClientId(clientId);
  if (!normalizedClientId) {
    throw new Error('Configure o GitHub OAuth Client ID nas configurações do workspace antes de conectar o Copilot.');
  }

  const d = await invoke<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  }>('github_device_flow_init', { scope: 'copilot', clientId: normalizedClientId });

  onState({ userCode: d.user_code, verificationUri: d.verification_uri, expiresIn: d.expires_in });

  const intervalMs = (d.interval + 1) * 1000;
  const deadline = Date.now() + d.expires_in * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));

    const poll = await invoke<{
      access_token?: string;
      error?: string;
      error_description?: string;
    }>('github_device_flow_poll', { deviceCode: d.device_code, clientId: normalizedClientId });

    if (poll.access_token) {
      localStorage.setItem(getOAuthTokenStorageKey(normalizedClientId), poll.access_token);
      _sessionToken = null;
      _sessionTokenExpiry = 0;
      _tokenRefreshPending = null;
      return;
    }
    if (poll.error === 'slow_down') { await new Promise((r) => setTimeout(r, 3000)); continue; }
    if (poll.error === 'authorization_pending') continue;
    throw new Error(poll.error_description ?? poll.error ?? 'Authorization failed');
  }
  throw new Error('Device flow timed out — please try again');
}

// ── Session token (internal) ──────────────────────────────────────────────────

let _sessionToken: string | null = null;
let _sessionTokenExpiry = 0;
/**
 * In-flight token-refresh promise. Coalesces concurrent callers so only one
 * exchange request is made at a time.
 */
let _tokenRefreshPending: Promise<string> | null = null;

/**
 * Exchange the stored GitHub OAuth token for a short-lived Copilot session token.
 * Exported for use by other sub-modules (models, streaming, compression) — not
 * part of the public index.ts API.
 */
export async function getCopilotSessionToken(oauthClientId?: string | null): Promise<string> {
  const now = Date.now();
  if (_sessionToken && now < _sessionTokenExpiry - 60_000) return _sessionToken;
  if (_tokenRefreshPending) return _tokenRefreshPending;

  _tokenRefreshPending = (async () => {
    try {
      const oauthToken = getStoredOAuthToken(oauthClientId);
      if (!oauthToken) throw new Error('NOT_AUTHENTICATED');

      const res = await fetch('https://api.github.com/copilot_internal/v2/token', {
        headers: {
          Authorization: `token ${oauthToken}`,
          'Content-Type': 'application/json',
          ...EDITOR_HEADERS,
        },
      });

      if (!res.ok) {
        const body = await res.text();
        if (res.status === 401 || res.status === 403) {
          clearOAuthToken(oauthClientId);
          throw new Error('NOT_AUTHENTICATED');
        }
        throw new Error(`Copilot token exchange failed (${res.status}): ${body}`);
      }

      const data = await res.json() as { token: string; expires_at: string };
      _sessionToken = data.token;
      _sessionTokenExpiry = new Date(data.expires_at).getTime();
      return _sessionToken;
    } finally {
      _tokenRefreshPending = null;
    }
  })();

  return _tokenRefreshPending;
}
