/**
 * Shared tool-gating by user intent.
 *
 * The agentic loops send a tool list that is re-serialized on every round, so
 * trimming never-needed tools (memory/export/settings/destructive...) by the
 * current user message saves fixed tokens per round without changing behavior.
 *
 * Used by the Copilot loop (per turn, `streaming.ts`) and by the SDK loop for
 * every non-Copilot provider (once per run, `runProviderAgent.ts`).
 */

import type { ChatMessage } from '../../types';
import type { ToolDefinition } from '../../utils/tools/shared';

const EXPORT_TOOL_NAMES = new Set(['export_workspace', 'configure_export_targets']);
const MEMORY_TOOL_NAMES = new Set(['remember', 'manage_memory']);
const SETTINGS_TOOL_NAMES = new Set(['configure_workspace']);
const OPTIONAL_TASK_TOOL_NAMES = new Set(['save_desktop_task']);
const DESTRUCTIVE_TOOL_NAMES = new Set(['rename_workspace_file', 'delete_workspace_file', 'scaffold_workspace']);

// Prefixes of synthetic user messages injected by the canvas/preview screenshot
// machinery — they must NOT be mistaken for genuine user intent when filtering tools.
const SYNTHETIC_USER_MSG_PREFIXES = [
  'canvas screenshot after',
  'html preview screenshot',
  'current canvas state',
];

function toPlainText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((part) => (part.type === 'text' ? part.text : '[image]'))
    .join(' ');
}

export interface ToolIntent {
  hasInjectedContext: boolean;
  isGreetingOnly: boolean;
  isReviewOrEdit: boolean;
  isSearchOrResearch: boolean;
  isExport: boolean;
  isMemory: boolean;
  isSettings: boolean;
  isTask: boolean;
  wantsDangerousMutation: boolean;
}

export function inferToolIntent(messages: ChatMessage[]): ToolIntent {
  // Skip synthetic vision-injection user messages (canvas/preview screenshots injected
  // into the loop as user turns) — they contain no user intent and would cause tools
  // like `remember` and `save_desktop_task` to be filtered out for all subsequent rounds.
  const lastUser = [...messages].reverse().find((message) => {
    if (message.role !== 'user') return false;
    const text = toPlainText(message.content).toLowerCase().trimStart();
    return !SYNTHETIC_USER_MSG_PREFIXES.some((prefix) => text.startsWith(prefix));
  });
  const prompt = toPlainText(lastUser?.content ?? '').trim();
  const normalized = prompt.toLowerCase();
  const hasInjectedContext =
    normalized.includes('[context: user sent this prompt while') ||
    normalized.includes('[attached file:') ||
    normalized.includes('[attached selection:');

  return {
    hasInjectedContext,
    isGreetingOnly: /^(hi|hello|hey|oi|ola|olá|bom dia|boa tarde|boa noite|yo|sup)[!. ]*$/i.test(prompt),
    isReviewOrEdit:
      /\b(review|revise|revisar|rewrite|edit|improve|improve it|melhor|polish|refine|fix|corrig|coeso|engajan|coes[oa])\b/i.test(prompt),
    isSearchOrResearch:
      /\b(search|find|look for|buscar|procura|onde|where|consisten|cross[- ]reference|compare|compare with|pesquis)\b/i.test(prompt),
    isExport:
      /\b(export|publish|deploy|build|gerar pdf|subir|publicar)\b/i.test(prompt),
    isMemory:
      /\b(remember|memory|memor|lembra|lembre|perfil|preference|preferencia)\b/i.test(prompt),
    isSettings:
      /\b(setting|settings|config|configura|workspace config|configure workspace)\b/i.test(prompt),
    isTask:
      /\b(task|todo|plan|steps|plano|etapas|track)\b/i.test(prompt),
    wantsDangerousMutation:
      /\b(rename|renome|delete|remove|apaga|exclui|scaffold|novo workspace|new workspace)\b/i.test(prompt),
  };
}

/**
 * Returns the tools worth shipping for the given conversation. Greetings (no
 * injected context) get NO tools at all; otherwise memory/export/settings/task
 * and destructive tools are dropped unless the user's latest message implies
 * that domain.
 */
export function filterToolsByIntent(
  tools: ToolDefinition[],
  messages: ChatMessage[],
): ToolDefinition[] {
  const intent = inferToolIntent(messages);
  if (intent.isGreetingOnly && !intent.hasInjectedContext) return [];

  return tools.filter((tool) => {
    const name = tool.function.name;
    if (!intent.isExport && EXPORT_TOOL_NAMES.has(name)) return false;
    if (!intent.isMemory && MEMORY_TOOL_NAMES.has(name)) return false;
    if (!intent.isSettings && SETTINGS_TOOL_NAMES.has(name)) return false;
    if (!intent.isTask && OPTIONAL_TASK_TOOL_NAMES.has(name)) return false;
    if (!intent.wantsDangerousMutation && DESTRUCTIVE_TOOL_NAMES.has(name)) return false;
    return true;
  });
}
