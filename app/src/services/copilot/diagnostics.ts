import type { ChatMessage, CopilotModel } from '../../types';
import type { ToolDefinition } from '../../utils/workspaceTools';

// ── CopilotDiagnosticError ────────────────────────────────────────────────────

/**
 * Error subclass thrown when the Copilot API returns a non-2xx response.
 * The `detail` field contains a full diagnostic dump of the request
 * (model, per-message summary, tool names, raw error body) suitable for
 * copying and pasting into a bug report or the Copilot chat itself.
 */
export class CopilotDiagnosticError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(message);
    this.name = 'CopilotDiagnosticError';
    this.detail = detail;
  }
}

// ── Request dump ──────────────────────────────────────────────────────────────

/** Full text of the most recent request sent to the Copilot API (updated before every call). */
let _lastRequestDump = '(no request made yet)';

/** Returns the full dump of the most recent Copilot API request, regardless of success/failure. */
export function getLastRequestDump(): string { return _lastRequestDump; }

/** Updates the stored request dump (called by streaming.ts before each API call). */
export function setLastRequestDump(s: string): void { _lastRequestDump = s; }

/** Build a human-readable dump of a request payload for diagnostics / copy-to-clipboard. */
export function buildRequestDump(
  messages: ChatMessage[],
  model: CopilotModel,
  tools: ToolDefinition[] | undefined,
  status?: number,
  errorBody?: string,
): string {
  const msgLines = messages.map((m, i) => {
    const tcIds = (m as any).tool_calls?.map((tc: any) => tc.id) ?? [];
    const tcId  = (m as any).tool_call_id ?? null;
    const header = `[${i}] ${m.role}${
      tcId  ? ` (tool_call_id: ${tcId})`          : ''}${
      tcIds.length ? ` (tool_calls: ${tcIds.join(', ')})` : ''}`;
    let body: string;
    if (typeof m.content === 'string') {
      body = m.content.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '[base64 image stripped]');
    } else if (Array.isArray(m.content)) {
      body = (m.content as any[]).map((p: any) =>
        p.type === 'image_url'
          ? '[image]'
          : (typeof p.text === 'string' ? p.text : JSON.stringify(p))
      ).join(' ');
    } else {
      body = String(m.content ?? '');
    }
    const tcDetail = (m as any).tool_calls?.map((tc: any) =>
      `\n    tool_call id=${tc.id} fn=${tc.function?.name} args=${tc.function?.arguments?.slice(0, 300)}`
    ).join('') ?? '';
    return `  ${header}\n    ${body.replace(/\n/g, '\n    ')}${tcDetail}`;
  });
  const toolNames = tools ? tools.map((t) => t.function?.name ?? (t as any).name).join(', ') : 'none';
  const lines = [
    `Timestamp : ${new Date().toISOString()}`,
    `Model     : ${model}`,
    `Tools     : ${toolNames}`,
    `Messages  : ${messages.length}`,
    ...msgLines,
  ];
  if (status !== undefined) lines.push(`Status    : ${status}`);
  if (errorBody)            lines.push(`Error body: ${errorBody}`);
  return lines.join('\n');
}

// ── Rate limit / quota tracking ───────────────────────────────────────────────

export interface RateLimitInfo {
  remaining: number | null;
  limit: number | null;
  /** True when the last error was a quota/budget exhaustion */
  quotaExceeded: boolean;
}

let _lastRateLimit: RateLimitInfo = { remaining: null, limit: null, quotaExceeded: false };

export function getLastRateLimit(): RateLimitInfo { return { ..._lastRateLimit }; }

/** Update the tracked rate-limit state (called by streaming.ts after each API call). */
export function updateRateLimit(patch: Partial<RateLimitInfo>): void {
  _lastRateLimit = { ..._lastRateLimit, ...patch };
}

/** Returns true when an error message indicates the user has run out of paid tokens. */
export function isQuotaError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('insufficient_quota') ||
    lower.includes('over their token budget') ||
    lower.includes('tokens_quota_exceeded') ||
    (
      (lower.includes('429') || lower.includes('402')) &&
      (lower.includes('quota') || lower.includes('budget') || lower.includes('billing') || lower.includes('premium'))
    )
  );
}
