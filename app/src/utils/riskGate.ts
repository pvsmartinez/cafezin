/**
 * Risk Gate — intercepts tool calls and asks the user for permission before
 * executing medium or high-risk tools.
 *
 * Permission model:
 *   - low    : always executes, no prompt.
 *   - medium : prompts once. User chooses "this session" or "forever (workspace)".
 *   - high   : same prompt, different label & default choice.
 *
 * Granted permissions are stored in two places:
 *   - "this session" → in the provided `sessionGranted` Set (lives in a useRef).
 *   - "forever"      → in WorkspaceConfig.riskPermissions, persisted to disk via
 *                      onWorkspaceConfigChange().
 *
 * If the user declines, the tool is NOT executed and the agent receives an
 * error string so it can report back gracefully instead of looping.
 */

import type { WorkspaceConfig } from '../types';
import {
  getToolRiskLevel,
  getToolFriendlyName,
  RISK_BADGES,
  RISK_LABELS,
  type RiskLevel,
} from './toolRisk';
import type { ToolExecutor } from './tools/shared';

export interface RiskGateOptions {
  workspaceConfig?: WorkspaceConfig;
  onWorkspaceConfigChange?: (patch: Partial<WorkspaceConfig>) => void;
  /** The onAskUser callback already wired up in useAIStream. */
  onAskUser: (question: string, options?: string[]) => Promise<string>;
  /**
   * A Set that persists for the lifetime of the chat session.
   * Pass `sessionRiskGrantedRef.current` from useAIStream.
   * The gate mutates this Set directly.
   */
  sessionGranted: Set<RiskLevel>;
}

/** Options presented to the user in the permission dialog (pt-BR). */
const OPT_SESSION = 'Permitir nesta sessão';
const OPT_FOREVER = 'Permitir sempre (este workspace)';
const OPT_DENY    = 'Não permitir';

/**
 * Wraps a ToolExecutor with permission checks for medium and high risk tools.
 *
 * Usage:
 *   const gatedExecutor = applyRiskGate(rawExecutor, opts);
 *   // pass gatedExecutor to runCopilotAgent / runProviderAgent
 */
export function applyRiskGate(
  executor: ToolExecutor,
  opts: RiskGateOptions,
): ToolExecutor {
  return async (name: string, args: Record<string, unknown>): Promise<string> => {
    const risk = getToolRiskLevel(name);

    // Low-risk — always pass through.
    if (risk === 'low') return executor(name, args);

    // Check existing grants (workspace-level takes precedence, then session).
    const foreverGranted = opts.workspaceConfig?.riskPermissions?.[risk] === 'forever';
    const sessionGranted = opts.sessionGranted.has(risk);
    if (foreverGranted || sessionGranted) return executor(name, args);

    // Build the permission prompt.
    const badge       = RISK_BADGES[risk];
    const riskLabel   = RISK_LABELS[risk];
    const friendlyOp  = getToolFriendlyName(name);
    const argSummary  = buildArgSummary(name, args);
    const question = [
      `${badge} **${friendlyOp}** — ${riskLabel}`,
      argSummary,
      '',
      'Deseja permitir esta classe de operações?',
    ].filter(Boolean).join('\n');

    const answer = await opts.onAskUser(question, [OPT_SESSION, OPT_FOREVER, OPT_DENY]);

    if (!answer || answer === OPT_DENY) {
      return (
        `Operação bloqueada: o usuário não concedeu permissão para ` +
        `"${friendlyOp}" (${riskLabel}). ` +
        `Informe ao usuário e aguarde instrução.`
      );
    }

    // Grant for the current session.
    opts.sessionGranted.add(risk);

    // If "forever", persist to workspace config.
    if (answer === OPT_FOREVER) {
      const current = opts.workspaceConfig?.riskPermissions ?? {};
      opts.onWorkspaceConfigChange?.({
        riskPermissions: { ...current, [risk]: 'forever' },
      });
    }

    return executor(name, args);
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Produce a one-line human-readable summary of the most relevant argument(s)
 * for each high/medium tool, so the user knows exactly what is about to happen.
 */
function buildArgSummary(name: string, args: Record<string, unknown>): string {
  const str = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : '');

  switch (name) {
    case 'delete_workspace_file':
      return str('path') ? `Arquivo: \`${str('path')}\`` : '';
    case 'run_command':
      return str('command') ? `Comando: \`${truncate(str('command'), 80)}\`` : '';
    case 'publish_vercel':
      return str('projectName') ? `Projeto: \`${str('projectName')}\`` : '';
    case 'rename_workspace_file':
      return (str('from') && str('to'))
        ? `De: \`${str('from')}\` → Para: \`${str('to')}\``
        : '';
    case 'scaffold_workspace':
      return str('structure') ? `Estrutura com ${countLines(str('structure'))} entradas` : '';
    default:
      return '';
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function countLines(s: string): number {
  return s.split('\n').filter((l) => l.trim()).length;
}
