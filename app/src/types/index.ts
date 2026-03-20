/** A single part in a multipart (vision) message sent to the API. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string }; // arguments is a JSON string
}

export interface ToolActivity {
  callId: string;
  /** '__thinking__' for model reasoning text, otherwise the tool function name */
  name: string;
  args: Record<string, unknown>;
  result?: string;
  error?: string;
  /** 'tool' (default) or 'thinking' for model reasoning emitted before a tool call */
  kind?: 'tool' | 'thinking';
  /** Model reasoning text captured before a tool call (when kind === 'thinking') */
  thinkingText?: string;
  /** Zero-based agent loop round this activity belongs to */
  round?: number;
}

/** One item in an ordered message stream: either a text chunk or a tool call. */
export type MessageItem =
  | { type: 'text'; content: string }
  | { type: 'tool'; activity: ToolActivity };

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  /**
   * Message content: a plain string for text-only messages, or a ContentPart[]
   * array for multipart messages (e.g. vision requests with image_url + text).
   */
  content: string | ContentPart[];
  /** Present on assistant messages that request tool calls */
  tool_calls?: ToolCall[];
  /** Present on tool-result messages (role === 'tool') */
  tool_call_id?: string;
  /** Tool function name — required by some API providers on tool messages */
  name?: string;
  /** Ordered stream items (text + tool calls in arrival order) */
  items?: MessageItem[];
  /** UI-only: the active file path when this message was sent. Stripped before sending to the API. */
  activeFile?: string;
  /** UI-only: base64 data URL of a user-attached image. Merged into multipart content before sending. */
  attachedImage?: string;
  /** UI-only: base64 data URLs of user-attached images. Merged into multipart content before sending. */
  attachedImages?: string[];
  /** UI-only: filename of a user-attached non-image file. Content is injected into the API message. */
  attachedFile?: string;
  /** UI-only: label for a captured in-app selection attached as extra context. */
  attachedSelectionLabel?: string;
}

export interface AISelectionContext {
  source: 'editor' | 'canvas' | 'spreadsheet';
  label: string;
  content: string;
}

export interface AITextRevert {
  beforeText: string;
  afterText: string;
  contextBefore?: string;
  contextAfter?: string;
}

export interface AISpreadsheetTarget {
  kind: 'cell' | 'row' | 'column' | 'header';
  sheetName: string;
  row?: number;
  col?: number;
}

export interface AIRecordedTextMark {
  text: string;
  revert?: AITextRevert;
  spreadsheetTarget?: AISpreadsheetTarget;
}

export interface AgentInstructionSource {
  path: string;
  content: string;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface CopilotStreamChunk {
  choices: Array<{
    delta: { content?: string; tool_calls?: Array<{
      index: number;
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }> };
    finish_reason: string | null;
  }>;
  /** Present only in the final usage chunk when stream_options.include_usage is true */
  usage?: TokenUsage;
}

// ── Export / Build config ─────────────────────────────────────────────────────

/** What to produce from a set of source files. */
export type ExportFormat =
  | 'pdf'         // markdown → PDF (jsPDF, pure JS)
  | 'canvas-png'  // each canvas file → PNG (via tldraw)
  | 'canvas-pdf'  // each canvas → PDF, one page per slide/frame
  | 'zip'         // bundle matching files into a .zip (JSZip, pure JS)
  | 'git-publish' // git add -A + commit + push, useful for deploy-by-git workflows
  | 'custom';     // run an arbitrary shell command (desktop only)

export type CustomExportExecutionMode = 'auto' | 'batch' | 'per-file';

export interface CustomExportProgressMessage {
  done?: number;
  total?: number;
  label?: string;
  phase?: string;
  detail?: string;
}

export interface CustomExportProtocol {
  progressPrefix: 'CAFEZIN_PROGRESS';
  artifactPrefix: 'CAFEZIN_ARTIFACT';
  acceptedFormats: Array<'ratio' | 'percent' | 'json' | 'text'>;
}

export interface CustomExportInjectionSpec {
  placeholders: string[];
  quotedPlaceholders: string[];
  batchPlaceholders: string[];
}

export interface CustomExportArtifactMessage {
  path: string;
  label?: string;
}

export interface CustomExportConfig {
  /** Shell command run with the workspace root as cwd. */
  command: string;
  /** How Cafezin should invoke the command. */
  mode?: CustomExportExecutionMode;
}

const LEGACY_CUSTOM_COMMAND_KEY = ['custom', 'Command'].join('');
const LEGACY_CUSTOM_MODE_KEY = ['custom', 'Command', 'Mode'].join('');

export interface ExportTarget {
  id: string;
  name: string;
  /** Human/AI readable description of what this target produces */
  description?: string;
  /**
   * File extensions to match (without leading dot), e.g. ["md"] or ["tldr.json"].
   * Ignored when `includeFiles` is set.
   */
  include: string[];
  /**
   * Pin specific files (relative paths from workspace root).
   * When non-empty this takes priority over `include` extensions.
   * e.g. ["notes/chapter1.md", "notes/chapter2.md"]
   */
  includeFiles?: string[];
  /**
   * Relative paths to skip even if matched by `include` extensions.
   * e.g. ["drafts/scratch.md"]
   */
  excludeFiles?: string[];
  format: ExportFormat;
  /** Output directory relative to workspace root, e.g. "dist" */
  outputDir: string;
  /**
   * For 'git-publish' format: stage all changes, optionally create a commit,
   * then push to the configured remote / branch.
   */
  gitPublish?: {
    /** Commit message template. Supports {{workspace}}, {{target}}, {{date}}, {{datetime}}. */
    commitMessage?: string;
    /** Git remote name. Defaults to "origin" when omitted. */
    remote?: string;
    /** Optional branch name. Leave empty to push the current branch/upstream. */
    branch?: string;
    /** Default true: if there are no staged changes, skip commit and still attempt push. */
    skipCommitWhenNoChanges?: boolean;
  };
  /** For 'custom' format: the Cafezin ↔ script integration contract. */
  custom?: CustomExportConfig;
  /**
   * When set, a "Publish to Vercel" button appears after a successful export.
   * The Vercel token is read from workspace vercelConfig > global cafezin-vercel-token.
   */
  vercelPublish?: {
    /** Vercel project name (e.g. "santacruz" → deploys to santacruz.vercel.app) */
    projectName: string;
  };
  enabled: boolean;
  /**
   * Merge all matched files into a single output instead of one per file.
   * Supported for: pdf (concatenated markdown), canvas-pdf (all frames across canvases).
   */
  merge?: boolean;
  /** Filename (without extension) for the merged output. Default: 'merged' */
  mergeName?: string;

  // ── PDF-only options ────────────────────────────────────────────────────────

  /**
   * Path (workspace-relative) to a .css file whose contents are appended after
   * the default PDF styles, allowing full overrides (fonts, page size, colors…).
   * e.g. "styles/book.css"
   */
  pdfCssFile?: string;
  /**
   * When set, a title page is prepended to the PDF before the content.
   * All fields are optional — omit any you don't want.
   */
  titlePage?: {
    title?: string;
    subtitle?: string;
    author?: string;
    version?: string;
  };
  /**
   * Generate a Table of Contents from H1/H2 headings in the merged content.
   * Only meaningful when merge: true. Inserted after the title page (if any).
   */
  toc?: boolean;
  /**
   * Automatically version the output file instead of overwriting it.
   * - 'timestamp' → appends _YYYY-MM-DD  (e.g. manuscript_2026-02-28.pdf)
   * - 'counter'   → appends _v1, _v2 …   (e.g. manuscript_v3.pdf)
   */
  versionOutput?: 'timestamp' | 'counter';
  /**
   * Pre-export markdown transformations applied to each file's content
   * before it is rendered (merge or single-file).
   */
  preProcess?: {
    /** Strip YAML front-matter blocks (---...---) */
    stripFrontmatter?: boolean;
    /** Remove ### Draft … sections (until next same-level heading or EOF) */
    stripDraftSections?: boolean;
    /** Remove <details>…</details> HTML blocks */
    stripDetails?: boolean;
  };
}

export interface WorkspaceExportConfig {
  targets: ExportTarget[];
}

export const CUSTOM_EXPORT_PROTOCOL: CustomExportProtocol = {
  progressPrefix: 'CAFEZIN_PROGRESS',
  artifactPrefix: 'CAFEZIN_ARTIFACT',
  acceptedFormats: ['ratio', 'percent', 'json', 'text'],
};

export const CUSTOM_EXPORT_INJECTION_SPEC: CustomExportInjectionSpec = {
  placeholders: ['{{input}}', '{{input_abs}}', '{{output}}', '{{output_abs}}', '{{workspace}}', '{{output_dir}}'],
  quotedPlaceholders: ['{{input_q}}', '{{input_abs_q}}', '{{output_q}}', '{{output_abs_q}}', '{{workspace_q}}', '{{output_dir_q}}'],
  batchPlaceholders: ['{{inputs}}', '{{inputs_q}}', '{{inputs_abs}}', '{{inputs_abs_q}}', '{{files_count}}'],
};

function getLegacyCustomExportFields(target: ExportTarget): {
  command?: string;
  mode?: CustomExportExecutionMode;
} {
  const record = target as ExportTarget & Record<string, unknown>;
  return {
    command: typeof record[LEGACY_CUSTOM_COMMAND_KEY] === 'string'
      ? record[LEGACY_CUSTOM_COMMAND_KEY] as string
      : undefined,
    mode: record[LEGACY_CUSTOM_MODE_KEY] as CustomExportExecutionMode | undefined,
  };
}

export function getCustomExportConfig(target: ExportTarget): CustomExportConfig | undefined {
  const legacy = getLegacyCustomExportFields(target);
  if (target.custom?.command?.trim()) {
    return {
      command: target.custom.command,
      mode: target.custom.mode ?? legacy.mode,
    };
  }

  if (legacy.command?.trim()) {
    return {
      command: legacy.command,
      mode: legacy.mode,
    };
  }

  return undefined;
}

export function normalizeExportTarget(target: ExportTarget): ExportTarget {
  const record = target as ExportTarget & Record<string, unknown>;
  const { custom: _rawCustom, ...rest } = record;
  const custom = getCustomExportConfig(target);
  delete rest[LEGACY_CUSTOM_COMMAND_KEY];
  delete rest[LEGACY_CUSTOM_MODE_KEY];
  return {
    ...rest,
    custom: custom?.command?.trim()
      ? {
          command: custom.command.trim(),
          mode: custom.mode,
        }
      : undefined,
  };
}

export function normalizeWorkspaceExportConfig(
  exportConfig?: WorkspaceExportConfig,
): WorkspaceExportConfig | undefined {
  if (!exportConfig) return undefined;
  return {
    ...exportConfig,
    targets: exportConfig.targets.map(normalizeExportTarget),
  };
}

/** Vercel publish config stored per-workspace (overrides global token) */
export interface VercelWorkspaceConfig {
  /** Override the global Vercel token for this workspace */
  token?: string;
  /** Vercel team/org ID — leave empty for personal accounts */
  teamId?: string;
  /**
   * Demo Hub: deploy multiple HTML demo projects as sub-paths of a single
   * Vercel project.  Each immediate subfolder under `sourceDir` becomes a
   * route, e.g. demos/aula1/ → project.vercel.app/aula1
   */
  demoHub?: {
    /** Vercel project name, e.g. "meu-curso" → deploys to meu-curso.vercel.app */
    projectName: string;
    /**
     * Workspace-relative path of the folder whose sub-directories are the
     * individual demos.  Defaults to workspace root ("") when omitted.
     * Example: "demos" means workspace/demos/aula1 → /aula1
     */
    sourceDir?: string;
  };
}

/** GitHub OAuth App settings scoped to a workspace. */
export interface GitHubOAuthWorkspaceConfig {
  /** Public OAuth App client ID used for Copilot device-flow login. */
  clientId?: string;
}

/** Optional per-workspace capabilities that enhance built-in file types. */
export interface WorkspaceFeatureConfig {
  /** Markdown-specific render features such as Mermaid diagrams. Undefined = automatic based on workspace files. */
  markdown?: {
    mermaid?: boolean;
  };
  /** Canvas-specific workspace capabilities. */
  canvas?: {
    /** Enable canvas-specific agent tools such as canvas_op and screenshots. Defaults to true. */
    agentTools?: boolean;
  };
  /** Spreadsheet-specific workspace capabilities. */
  spreadsheet?: {
    /** Enable structured spreadsheet tools such as read_spreadsheet and write_spreadsheet. Defaults to true. */
    agentTools?: boolean;
  };
  /** Web / browser capabilities for the agent. */
  web?: {
    /** Enable web search, URL fetch, preview and shell/web tools. Defaults to true. */
    agentTools?: boolean;
  };
  /** Reserved for future code-editor capabilities. */
  code?: Record<string, boolean>;
}

/** A custom action button shown at the bottom of the sidebar. */
export interface SidebarButton {
  id: string;
  /** Short label displayed on the button, e.g. "⊡ Export" */
  label: string;
  /** Shell command run with the workspace root as cwd */
  command: string;
  /** Optional tooltip / description */
  description?: string;
}

export interface WorkspaceConfig {
  name: string;
  lastOpenedFile?: string;
  preferredModel?: string;
  /**
   * Language tag for AI responses in this workspace.
   * E.g. "pt-BR" (default), "en-US", "es", "fr".
   * When set, overrides the app-level default in the Copilot system prompt.
   */
  preferredLanguage?: string;
  /** Up to 5 most-recently opened files (relative paths) */
  recentFiles?: string[];
  /** ISO timestamp of the last auto-save */
  lastEditedAt?: string;
  /** Export / Build targets, persisted in the workspace config file */
  exportConfig?: WorkspaceExportConfig;
  /** Custom action buttons shown at the bottom of the sidebar */
  sidebarButtons?: SidebarButton[];
  /** Relative path of the voice-dump inbox file (default: 00_Inbox/raw_transcripts.md) */
  inboxFile?: string;
  /** Vercel publish config — workspace-level override (token, teamId) */
  vercelConfig?: VercelWorkspaceConfig;
  /** GitHub OAuth App config used by Copilot in this workspace. */
  githubOAuth?: GitHubOAuthWorkspaceConfig;
  /** Optional feature flags / capabilities enabled only for this workspace. */
  features?: WorkspaceFeatureConfig;
  /**
   * Git branch used for sync. Defaults to the remote's default branch (usually main/master).
   * Set on desktop via Settings → Workspace. Mobile uses this branch when cloning/pulling.
   */
  gitBranch?: string;
  /**
   * Permanently granted risk-gate permissions for this workspace.
   * Keys are risk levels ('medium' | 'high'); value is always 'forever'.
   * When set, the risk gate skips the user-confirmation prompt for that level.
   */
  riskPermissions?: Record<string, 'forever'>;
}

/** A span of text inserted by the AI and not yet reviewed by the human. */
export interface AIEditMark {
  id: string;
  /** Relative path from workspace root */
  fileRelPath: string;
  /** The exact text that was inserted (for text files: the literal text; for canvas: a label/description) */
  text: string;
  /** AI model that generated it */
  model: string;
  insertedAt: string; // ISO
  reviewed: boolean;
  reviewedAt?: string;
  decision?: 'accepted' | 'rejected' | 'edited';
  revert?: AITextRevert;
  spreadsheetTarget?: AISpreadsheetTarget;
  /** Canvas-only: tldraw shape IDs that were created by this AI action */
  canvasShapeIds?: string[];
}

// ── Workspace file index ──────────────────────────────────────────────────────

/** Per-file metadata entry stored in the workspace index. */
export interface WorkspaceIndexEntry {
  path: string;    // relative path from workspace root
  size: number;    // bytes
  mtime: number;   // Unix ms timestamp
  outline: string; // cached structural outline text
}

/** Persisted lightweight index of all indexable files in the workspace. */
export interface WorkspaceIndex {
  version: number;
  builtAt: string; // ISO 8601
  entries: WorkspaceIndexEntry[];
}

export interface Workspace {
  path: string;         // absolute path to workspace folder
  name: string;
  config: WorkspaceConfig;
  agentContext?: string; // contents of AGENT.md if present
  agentInstructionSources?: AgentInstructionSource[];
  files: string[];       // .md filenames (relative) – kept for compat
  fileTree: FileTreeNode[]; // full recursive tree of the workspace
  /** True when the workspace folder has a git remote configured (origin). */
  hasGit: boolean;
  /** Lightweight per-file metadata index (loaded from .cafezin/workspace-index.json). */
  workspaceIndex?: WorkspaceIndex;
}

export interface RecentWorkspace {
  path: string;
  name: string;
  lastOpened: string;
  /** ISO timestamp of the last file edit — persisted at open time from workspace config */
  lastEditedAt?: string;
  /** Cached git status from last open. undefined = unknown (old entry). */
  hasGit?: boolean;
  /** Git remote origin URL — used to match against cloud workspaces in the picker. */
  gitRemote?: string;
}

export interface FileTreeNode {
  name: string;
  /** Relative path from workspace root (e.g. "src/lib/utils.ts") */
  path: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
}

export type CopilotModel = string; // resolved dynamically from /models endpoint

export interface CopilotModelInfo {
  id: string;
  name: string;
  /** Billing multiplier from the API (0 = free, 1 = standard, 2 = 2× premium, …) */
  multiplier: number;
  /** True when multiplier > 1 */
  isPremium: boolean;
  vendor?: string;
  /** Whether the model accepts image_url content (false for o-series reasoning models) */
  supportsVision: boolean;
  /** Optional token metadata when the Copilot /models endpoint provides it. */
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

/** Application-level settings persisted in localStorage. */
export interface AppSettings {
  theme: 'system' | 'dark' | 'light';
  /** Editor font size in px */
  editorFontSize: number;
  /** Autosave debounce delay in ms */
  autosaveDelay: number;
  /** Show word count in header */
  showWordCount: boolean;
  /** Enable AI edit highlights by default */
  aiHighlightDefault: boolean;
  /** Show sidebar on startup */
  sidebarOpenDefault: boolean;
  /** Run Prettier on manual save (Cmd/Ctrl+S) for JS/TS/JSON/CSS/HTML */
  formatOnSave: boolean;
  /** Show the integrated terminal panel (advanced / power-user feature) */
  showTerminal: boolean;
  /** UI language — undefined means auto-detect from navigator.language */
  locale?: 'en' | 'pt-BR';
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  editorFontSize: 14,
  autosaveDelay: 1000,
  showWordCount: true,
  aiHighlightDefault: true,
  sidebarOpenDefault: true,
  formatOnSave: true,
  showTerminal: false,
};

export const APP_SETTINGS_KEY = 'cafezin-app-settings';

export const DEFAULT_MODEL: CopilotModel = 'gpt-5-mini';

/** Static fallback shown before the API responds (or if it fails).
 * IDs must match what GitHub Copilot's /models endpoint returns.
 * Keep in sync with: https://docs.github.com/en/copilot/reference/ai-models/supported-models
 * Rule: only keep the latest minor version per model family.
 * Last updated: 2026-03-09
 */
export const FALLBACK_MODELS: CopilotModelInfo[] = [
  // Free / 0× tier (multiplier 0)
  { id: 'gpt-4o',               name: 'GPT-4o',               multiplier: 0,    isPremium: false, vendor: 'OpenAI',    supportsVision: true  },
  { id: 'gpt-4.1',              name: 'GPT-4.1',              multiplier: 0,    isPremium: false, vendor: 'OpenAI',    supportsVision: true  },
  { id: 'gpt-5-mini',           name: 'GPT-5 mini',           multiplier: 0,    isPremium: false, vendor: 'OpenAI',    supportsVision: true  },
  { id: 'raptor-mini',          name: 'Raptor mini',          multiplier: 0,    isPremium: false, vendor: 'GitHub',    supportsVision: true  },
  // Low cost (0.25–0.33× tier)
  { id: 'grok-code-fast-1',     name: 'Grok Code Fast 1',     multiplier: 0.25, isPremium: false, vendor: 'xAI',       supportsVision: false },
  { id: 'claude-haiku-4-5',     name: 'Claude Haiku 4.5',     multiplier: 0.33, isPremium: false, vendor: 'Anthropic', supportsVision: true  },
  { id: 'gemini-3-flash',       name: 'Gemini 3 Flash',       multiplier: 0.33, isPremium: false, vendor: 'Google',    supportsVision: true  },
  { id: 'gpt-5.1-codex-mini',   name: 'GPT-5.1-Codex-Mini',   multiplier: 0.33, isPremium: false, vendor: 'OpenAI',    supportsVision: false },
  // Standard / 1× tier
  { id: 'gpt-5.1',              name: 'GPT-5.1',              multiplier: 1,    isPremium: false, vendor: 'OpenAI',    supportsVision: true  },
  { id: 'gpt-5.1-codex',        name: 'GPT-5.1-Codex',        multiplier: 1,    isPremium: false, vendor: 'OpenAI',    supportsVision: false },
  { id: 'gpt-5.1-codex-max',    name: 'GPT-5.1-Codex-Max',    multiplier: 1,    isPremium: false, vendor: 'OpenAI',    supportsVision: false },
  { id: 'gpt-5.2',              name: 'GPT-5.2',              multiplier: 1,    isPremium: false, vendor: 'OpenAI',    supportsVision: true  },
  { id: 'claude-sonnet-4-6',    name: 'Claude Sonnet 4.6',    multiplier: 1,    isPremium: false, vendor: 'Anthropic', supportsVision: true  },
  { id: 'gemini-3-pro',         name: 'Gemini 3 Pro',         multiplier: 1,    isPremium: false, vendor: 'Google',    supportsVision: true  },
  { id: 'gemini-3.1-pro',       name: 'Gemini 3.1 Pro',       multiplier: 1,    isPremium: false, vendor: 'Google',    supportsVision: true  },
  { id: 'gpt-5.2-codex',        name: 'GPT-5.2-Codex',        multiplier: 1,    isPremium: false, vendor: 'OpenAI',    supportsVision: false },
  { id: 'gpt-5.3-codex',        name: 'GPT-5.3-Codex',        multiplier: 1,    isPremium: false, vendor: 'OpenAI',    supportsVision: false },
  // Premium / >1× tier
  { id: 'claude-opus-4-6',      name: 'Claude Opus 4.6',      multiplier: 3,    isPremium: true,  vendor: 'Anthropic', supportsVision: true  },
];

// ── Account / Subscription / Entitlements ─────────────────────────────────────
// These types mirror the Supabase get_my_account_state() RPC response.

export type SubscriptionPlan = 'free' | 'premium';
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'inactive';

/** Canonical account state fetched from Supabase and cached locally. */
export interface AccountState {
  /** True when the user is authenticated with Cafezin (Supabase). */
  authenticated: boolean;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  /** True when plan = 'premium' and status is active/trialing and not expired. */
  isPremium: boolean;
  /**
   * Master capability flag — always check this before any AI call.
   * Currently equivalent to isPremium; kept separate so we can add trial/grace
   * logic without touching every callsite.
   */
  canUseAI: boolean;
  /** ISO timestamp of the end of the current billing period, or null. */
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  trialEnd?: string | null;
}

/** Unauthenticated / free default — safe to use as the initial state. */
export const FREE_ACCOUNT_STATE: AccountState = {
  authenticated: false,
  plan: 'free',
  status: 'inactive',
  isPremium: false,
  canUseAI: false,
};

// ── Task / plan model ─────────────────────────────────────────────────────────

export type TaskStepStatus = 'pending' | 'in-progress' | 'done' | 'skipped';

export interface TaskStep {
  title: string;
  status: TaskStepStatus;
  /** Optional note added when the step is completed or skipped. */
  note?: string;
}

/**
 * A multi-step task created by the agent to track progress through a complex
 * user request. Persisted to `.cafezin/tasks.json` in the workspace.
 */
export interface Task {
  /** Stable ID, e.g. `task-1710000000`. */
  id: string;
  title: string;
  description?: string;
  /** Agent tab that owns this task. Undefined if created from the default tab. */
  agentId?: string;
  steps: TaskStep[];
  createdAt: string;       // ISO timestamp
  completedAt?: string;    // set when all steps are done/skipped
}

