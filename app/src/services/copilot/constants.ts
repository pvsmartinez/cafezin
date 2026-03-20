export const COPILOT_API_URL = 'https://api.githubcopilot.com/chat/completions';
export const CHAT_COMPLETIONS_BLOCKED_MODELS = new Set(['gpt-5.4', 'gpt-5.4-mini']);
export const CHAT_COMPLETIONS_RUNTIME_BLOCKLIST_KEY = 'cafezin-copilot-blocked-chat-models';
export const COPILOT_MODELS_CHANGED_EVENT = 'cafezin-copilot-models-changed';

export const EDITOR_HEADERS = {
  'User-Agent': 'Cafezin/1.0',
  'Editor-Version': 'vscode/1.95.3',       // must be a recognized IDE name for copilot_internal auth
  'Editor-Plugin-Version': 'cafezin/1.0',  // identifies this app specifically
};

/**
 * Legacy / superseded model ID prefixes to hide from the picker.
 * Entries are matched as exact IDs or as prefix + '-' (so 'gpt-4' blocks
 * 'gpt-4' exactly but NOT 'gpt-4o', 'gpt-4.1', etc.).
 */
export const BLOCKED_PREFIXES = [
  'gpt-3.5',
  'gpt-4-32k',
  'gpt-4-turbo',
  'gpt-4-0',           // gpt-4-0314, gpt-4-0613
  'gpt-4-1106',
  'gpt-4-vision',
  'o1-mini',
  'o1-preview',
  'text-davinci',
  'text-embedding',
  'code-search',
  'claude-3-',         // entire claude 3.x generation (3-haiku, 3-sonnet, 3-5-*, 3-7-*)
];

export const BLOCKED_EXACT = new Set(['gpt-4', 'o1-mini']);
