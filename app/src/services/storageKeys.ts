/**
 * Central registry of all localStorage keys used by the app.
 *
 * Always import from here instead of using bare string literals.
 * This prevents typo-bugs across files and makes key auditing trivial.
 */

export const SK = {
  // ── App lifecycle ─────────────────────────────────────────────────────────
  APP_SETTINGS:           'cafezin-app-settings',
  DESKTOP_ONBOARDING:     'cafezin-desktop-onboarding-v1-seen',
  MOBILE_ONBOARDING:      'cafezin-mobile-onboarding-v1-seen',
  UPDATE_SUGGESTION:      'cafezin-last-suggested-update-version',
  UPDATE_TOAST_DISMISSED: 'cafezin-update-toast-dismissed',
  LEGACY_SYNC_PROMPT:     'cafezin-sync-onboarding-skipped',

  // ── Auth / account ────────────────────────────────────────────────────────
  SYNC_ACCOUNT_TOKEN: 'cafezin-sync-account-token',
  ACCOUNT_STATE:      'cafezin-account-state-v1',

  // ── AI provider ───────────────────────────────────────────────────────────
  AI_PROVIDER:         'cafezin-ai-provider',
  /** Legacy key — used only for Copilot model (for backward compat). */
  AI_MODEL:            'cafezin-ai-model',
  /** Per-provider prefix: append provider name to get the key. */
  AI_MODEL_PREFIX:     'cafezin-ai-model-',
  AI_MODEL_CUSTOM:     'cafezin-ai-model-custom',
  /** Per-provider prefix: append provider name to get the key. */
  AI_FAVORITES_PREFIX: 'cafezin-ai-favorites-',
  AI_CUSTOM_ENDPOINT:  'cafezin-custom-endpoint',

  // ── Provider API keys ─────────────────────────────────────────────────────
  OPENAI_KEY:    'cafezin-openai-key',
  ANTHROPIC_KEY: 'cafezin-anthropic-key',
  GROQ_KEY:      'cafezin-groq-key',
  GOOGLE_KEY:    'cafezin-google-key',
  CUSTOM_KEY:    'cafezin-custom-key',

  // ── Copilot OAuth ─────────────────────────────────────────────────────────
  /** Token for the default (global) Copilot OAuth app. */
  COPILOT_OAUTH_TOKEN: 'copilot-github-oauth-token',
  /** Prefix for workspace-specific Copilot OAuth tokens: append clientId. */
  COPILOT_OAUTH_TOKEN_PREFIX: 'copilot-github-oauth-token-',

  // ── Voice ─────────────────────────────────────────────────────────────────
  GROQ_LANG: 'cafezin-groq-lang',

  // ── API Keys (global, device-only) ───────────────────────────────────────
  VERCEL_TOKEN: 'cafezin-vercel-token',
  PEXELS_KEY:   'cafezin_pexels_key',

  // ── Workspace ─────────────────────────────────────────────────────────────
  RECENT_WORKSPACES: 'cafezin-recent-workspaces',

  // ── Sessions ──────────────────────────────────────────────────────────────
  AI_SESSION_PREFIX:         'cafezin:agent-session:',
  AI_SESSION_LEGACY:         'cafezin-last-session',
  AI_SESSION_LEGACY_MIGRATED:'cafezin-last-session-migrated',
  /** Per-workspace session prefix: append workspace path hash. */
  WS_SESSION_PREFIX:         'cafezin:ws-session:',

  // ── Mobile ────────────────────────────────────────────────────────────────
  MOBILE_LAST_WS: 'mobile-last-workspace-path',

  // ── UI state ──────────────────────────────────────────────────────────────
  EXPORT_MODAL_AI_HELPER: 'cafezin:em:aihelper',
} as const;
