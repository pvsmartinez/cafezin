/**
 * Risk classification for agent tools.
 *
 * Three levels:
 *   low    — reads, writes, searches, canvas edits, config. Always allowed.
 *   medium — structural operations (rename, mass scaffold). Requires user permission
 *            once per session or permanently (stored in workspace config).
 *   high   — destructive/external side-effects (delete, shell, publish).
 *            Requires user permission once per session or permanently.
 *
 * Unknown tools default to 'medium' (fail-safe).
 */

export type RiskLevel = 'low' | 'medium' | 'high';

/** Canonical permission grant stored in WorkspaceConfig. */
export type RiskGrant = 'forever';

/**
 * Maps every registered tool name to its risk level.
 * Keep this in sync with the tool definitions in utils/tools/*.ts.
 */
const TOOL_RISK_MAP: Record<string, RiskLevel> = {
  // ── File reads ───────────────────────────────────────────────────────────
  list_workspace_files:   'low',
  outline_workspace:      'low',
  search_workspace_index: 'low',
  read_workspace_file:    'low',
  read_multiple_files:    'low',
  search_workspace:       'low',
  check_file:             'low',
  word_count:             'low',

  // ── File writes (core editing purpose — always allowed) ──────────────────
  write_workspace_file:   'low',
  patch_workspace_file:   'low',
  multi_patch:            'low',
  write_spreadsheet:      'low',
  read_spreadsheet:       'low',

  // ── Structural file operations ────────────────────────────────────────────
  rename_workspace_file:  'medium',
  scaffold_workspace:     'medium',

  // ── Canvas ───────────────────────────────────────────────────────────────
  list_canvas_shapes:     'low',
  canvas_op:              'low',
  canvas_screenshot:      'low',
  screenshot_preview:     'low',
  add_canvas_image:       'low',

  // ── Web / external ───────────────────────────────────────────────────────
  web_search:             'low',
  search_images:          'low',
  fetch_url:              'low',

  // ── Config / meta ─────────────────────────────────────────────────────────
  export_workspace:           'low',
  configure_export_targets:   'low',
  configure_workspace:        'low',
  remember:                   'low',
  ask_user:                   'low',
  save_desktop_task:          'low',

  // ── High-risk: destructive / external side-effects ───────────────────────
  delete_workspace_file:  'high',
  run_command:            'high',
  publish_vercel:         'high',
};

/** Return the risk level for a tool. Unknown tools default to 'medium'. */
export function getToolRiskLevel(toolName: string): RiskLevel {
  return TOOL_RISK_MAP[toolName] ?? 'medium';
}

/** Human-readable label for each risk level (pt-BR). */
export const RISK_LABELS: Record<RiskLevel, string> = {
  low:    'Risco baixo',
  medium: 'Risco médio',
  high:   'Risco alto',
};

/** Emoji badge for each risk level. */
export const RISK_BADGES: Record<RiskLevel, string> = {
  low:    '✅',
  medium: '⚠️',
  high:   '🔴',
};

/** Friendly name for display in permission prompts. */
export const TOOL_FRIENDLY_NAMES: Record<string, string> = {
  rename_workspace_file: 'Renomear arquivo',
  scaffold_workspace:    'Criar estrutura de arquivos',
  delete_workspace_file: 'Excluir arquivo/pasta',
  run_command:           'Executar comando no terminal',
  publish_vercel:        'Publicar no Vercel',
};

export function getToolFriendlyName(toolName: string): string {
  return TOOL_FRIENDLY_NAMES[toolName] ?? toolName.replace(/_/g, ' ');
}

/** All tool names at a given risk level. */
export function toolsAtRiskLevel(level: RiskLevel): string[] {
  return Object.entries(TOOL_RISK_MAP)
    .filter(([, v]) => v === level)
    .map(([k]) => k);
}
