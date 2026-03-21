import type { ChatMessage } from '../../types';
import type { ToolDefinition } from '../../utils/tools/shared';

export class ProviderDiagnosticError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(message);
    this.name = 'ProviderDiagnosticError';
    this.detail = detail;
  }
}

let _lastProviderRequestDump = '(no request made yet)';

export function getLastProviderRequestDump(): string {
  return _lastProviderRequestDump;
}

export function setLastProviderRequestDump(value: string): void {
  _lastProviderRequestDump = value;
}

function safeJson(value: unknown, max = 8000): string {
  try {
    const json = JSON.stringify(value, (_key, raw) => {
      if (typeof raw === 'string' && raw.startsWith('data:image/')) return '[base64 image stripped]';
      return raw;
    }, 2);
    return json.length > max ? `${json.slice(0, max)}\n[truncated]` : json;
  } catch {
    return String(value);
  }
}

function serializeErrorShape(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') {
    return { value: error };
  }

  const err = error as Record<string, unknown>;
  const cause = err.cause;

  return {
    name: typeof err.name === 'string' ? err.name : undefined,
    message: typeof err.message === 'string' ? err.message : undefined,
    stack: typeof err.stack === 'string' ? err.stack.split('\n').slice(0, 8).join('\n') : undefined,
    keys: Object.keys(err),
    entries: Object.fromEntries(
      Object.entries(err).map(([key, value]) => [
        key,
        typeof value === 'string' && value.startsWith('data:image/')
          ? '[base64 image stripped]'
          : value,
      ]),
    ),
    cause: cause && typeof cause === 'object'
      ? {
          name: typeof (cause as Record<string, unknown>).name === 'string'
            ? (cause as Record<string, unknown>).name
            : undefined,
          message: typeof (cause as Record<string, unknown>).message === 'string'
            ? (cause as Record<string, unknown>).message
            : undefined,
          keys: Object.keys(cause as Record<string, unknown>),
          entries: Object.fromEntries(
            Object.entries(cause as Record<string, unknown>).map(([key, value]) => [
              key,
              typeof value === 'string' && value.startsWith('data:image/')
                ? '[base64 image stripped]'
                : value,
            ]),
          ),
        }
      : cause,
  };
}

function contentToDebugString(content: ChatMessage['content']): string {
  if (typeof content === 'string') {
    return content.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '[base64 image stripped]');
  }
  return content.map((part) => {
    if (part.type === 'image_url') return '[image]';
    return part.text;
  }).join(' ');
}

export function buildProviderRequestDump(args: {
  provider: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  url?: string;
  statusCode?: number;
  errorBody?: string;
  requestBodyValues?: unknown;
  rawError?: unknown;
}): string {
  const msgLines = args.messages.map((message, index) => {
    return `  [${index}] ${message.role}\n    ${contentToDebugString(message.content).replace(/\n/g, '\n    ')}`;
  });

  const toolNames = args.tools?.map((tool) => tool.function.name).join(', ') || 'none';
  const lines = [
    `Timestamp : ${new Date().toISOString()}`,
    `Provider  : ${args.provider}`,
    `Model     : ${args.model}`,
    `Tools     : ${toolNames}`,
    `Messages  : ${args.messages.length}`,
    ...msgLines,
  ];

  if (args.url) lines.push(`URL       : ${args.url}`);
  if (args.statusCode !== undefined) lines.push(`Status    : ${args.statusCode}`);
  if (args.requestBodyValues !== undefined) lines.push(`Request   : ${safeJson(args.requestBodyValues)}`);
  if (args.errorBody) lines.push(`Error body: ${args.errorBody}`);
  if (args.rawError !== undefined) lines.push(`Raw error : ${safeJson(serializeErrorShape(args.rawError))}`);

  return lines.join('\n');
}

function extractMessageFromBody(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as any;
    return parsed?.error?.message ?? parsed?.message ?? parsed?.detail ?? null;
  } catch {
    return raw.trim();
  }
}

function pickMessage(error: any): string {
  const direct = typeof error?.message === 'string' ? error.message.trim() : '';
  if (direct && direct !== '[object Object]') return direct;

  const fromBody = extractMessageFromBody(
    typeof error?.responseBody === 'string'
      ? error.responseBody
      : typeof error?.cause?.responseBody === 'string'
      ? error.cause.responseBody
      : undefined,
  );
  if (fromBody) return fromBody;

  const nested = typeof error?.cause?.message === 'string' ? error.cause.message.trim() : '';
  if (nested && nested !== '[object Object]') return nested;

  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'Provider request failed.';
}

export function formatProviderError(
  error: unknown,
  context: {
    provider: string;
    model: string;
    messages: ChatMessage[];
    tools?: ToolDefinition[];
  },
): ProviderDiagnosticError {
  const err = error as any;
  const statusCode =
    typeof err?.statusCode === 'number' ? err.statusCode
    : typeof err?.cause?.statusCode === 'number' ? err.cause.statusCode
    : undefined;
  const responseBody =
    typeof err?.responseBody === 'string' ? err.responseBody
    : typeof err?.cause?.responseBody === 'string' ? err.cause.responseBody
    : undefined;
  const url =
    typeof err?.url === 'string' ? err.url
    : typeof err?.cause?.url === 'string' ? err.cause.url
    : undefined;
  const requestBodyValues =
    err?.requestBodyValues ?? err?.cause?.requestBodyValues;

  const message = pickMessage(err);
  const detail = buildProviderRequestDump({
    ...context,
    url,
    statusCode,
    errorBody: responseBody,
    requestBodyValues,
    rawError: err,
  });

  setLastProviderRequestDump(detail);
  return new ProviderDiagnosticError(message, detail);
}
