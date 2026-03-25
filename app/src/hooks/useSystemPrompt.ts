import { useMemo, useState, useEffect, useCallback } from 'react';
import { homeDir } from '@tauri-apps/api/path';
import { exists, readTextFile } from '../services/fs';
import { buildWorkspaceMemoryPromptText } from '../services/memoryMetadata';
import {
  CUSTOM_EXPORT_INJECTION_SPEC,
  CUSTOM_EXPORT_PROTOCOL,
  getCustomExportConfig,
  type ChatMessage,
  type Task,
  type WorkspaceConfig,
  type WorkspaceExportConfig,
} from '../types';
import type { Workspace } from '../types';
import { getAgentCapabilityState, getAgentWorkspaceProfile } from '../utils/agentCapabilities';
import {
  buildAgentGuidanceDigest,
  summarizeWorkspaceFiles,
  truncateDocumentContext,
} from '../utils/agentPromptContext';

function buildExportSystemSummary(workspaceExportConfig?: WorkspaceExportConfig): string {
  const configuredTargets = workspaceExportConfig?.targets ?? [];
  const configuredSummary = configuredTargets.length === 0
    ? 'Configured export targets: none yet.'
    : `Configured export targets (${configuredTargets.length}):\n${configuredTargets.map((target) => {
      const parts = [
        `- ${target.name}`,
        `format=${target.format}`,
        `enabled=${target.enabled ? 'yes' : 'no'}`,
        `outputDir=${target.outputDir}`,
      ];
      if (target.includeFiles?.length) parts.push(`includeFiles=${target.includeFiles.join(', ')}`);
      else if (target.include.length) parts.push(`include=${target.include.join(', ')}`);
      if (target.excludeFiles?.length) parts.push(`excludeFiles=${target.excludeFiles.join(', ')}`);
      if (target.description) parts.push(`description=${target.description}`);
      if (target.merge) parts.push(`merge=${target.mergeName?.trim() || 'merged'}`);
      const customConfig = getCustomExportConfig(target);
      if (customConfig?.command) parts.push(`custom.command=${customConfig.command}`);
      if (customConfig?.mode) parts.push(`custom.mode=${customConfig.mode}`);
      if (target.gitPublish) {
        parts.push(`gitRemote=${target.gitPublish.remote || 'origin'}`);
        if (target.gitPublish.branch) parts.push(`gitBranch=${target.gitPublish.branch}`);
      }
      return parts.join(' | ');
    }).join('\n')}`;

  return `Export system in Cafezin:\n`
    + `• Before export/publish/deploy, inspect targets with configure_export_targets(action="list").\n`
    + `• Formats: pdf, canvas-png, canvas-pdf, zip, git-publish, custom.\n`
    + `• includeFiles beats include extensions; excludeFiles applies afterwards.\n`
    + `• Prefer reusing an existing target. If none fits, add or update one, then run export_workspace.\n`
    + `• custom targets run a workspace-root command. Progress lines start with ${CUSTOM_EXPORT_PROTOCOL.progressPrefix}; artifact lines start with ${CUSTOM_EXPORT_PROTOCOL.artifactPrefix}. Placeholders include ${CUSTOM_EXPORT_INJECTION_SPEC.placeholders.join(', ')} plus quoted and batch variants.\n`
    + configuredSummary;
}

function buildCoreAppSummary(): string {
  return `You are the Cafezin AI assistant — a thoughtful co-pilot for writers, educators, researchers, and knowledge workers.

Cafezin is a local-first desktop productivity workspace: Markdown documents, tldraw visual canvases, spreadsheets, and code files — all stored on the user's machine, no cloud backend.

Identity and work style:
• Co-pilot, not author. Suggest, draft, scaffold — but the user makes every decision.
• Read before writing. Inspect files and structure before editing anything.
• Work in small, inspectable increments. Prefer surgical edits over full rewrites.
• Surface progress concisely: one clear sentence per completed action, then invite review.
• Never fabricate file contents, types, or code — always read the actual files first.
• AI-generated text is marked for review — make every change easy to inspect, accept, or reject.`;
}

function buildFileTypeSummary(): string {
  return `Primary file types:
• Markdown (.md): main writing format, previewed live.
• PDF (.pdf): use read_workspace_file to extract and read text from any page. Read-only (cannot write back to PDF).
• Canvas (.tldr.json): tldraw whiteboards for slides, diagrams, and visual work. Use canvas_op only — never write raw JSON.
• Spreadsheet (.csv, .tsv, .xlsx): tabular data. Use read_spreadsheet / write_spreadsheet.
• Code (.ts, .tsx, .js, .py, .sh): edited with the code pane.

For detailed rules per file type, call read_skill with the relevant skill name before working on that type.`;
}

function buildCanvasProtocol(): string {
  return `Canvas — critical rules (call read_skill("canvas") for full command reference before canvas work):
• Only canvas_op modifies canvases — never write raw JSON to .tldr.json.
• Only list_canvas_shapes inspects canvases — never read_workspace_file on .tldr.json.
• canvas_op always requires expected_file.
• list_canvas_shapes only shows the currently open canvas — confirm "Canvas file:" before editing.
• After canvas edits, call canvas_screenshot once and fix visible problems before replying.`;
}

function buildToolUsageProtocol(): string {
  return `Workspace tool rules:
• Use tools whenever the user asks about files, documents, structure, or edits. Read first — never guess file contents.
• Discovery: start with outline_workspace or search_workspace_index, then refine with search_workspace (exact words, identifiers, or /regex/ patterns).
• Freshness: injected document context may lag behind unsaved edits. If content may have changed, read_workspace_file for the live version.
• SESSION STALENESS: earlier messages reflect the workspace at the time they were written. Schemas, rules, and data structures can change between sessions. The file wins over any old session message.
• Edits: patch_workspace_file for one surgical change; multi_patch for coordinated multi-file edits; write_workspace_file only for full rewrites or new files.
• On large files, avoid full rewrites — they are harder to verify and increase error surface.
• Tool arguments must be strict JSON objects — no partial JSON, comments, or prose.
• ask_user for genuine ambiguity only — one question per call.
• FOCUS: complete the user's most recent request before touching anything else. Note unrelated issues in one sentence and move on.`;
}

function buildMemoryProtocol(): string {
  return `Memory rules:
• The memory digest injected at the bottom of this prompt is the source of truth — read it before any long task.
• BREAKING CHANGES: when schemas, rules, or data structures change, update workspace memory immediately with the NEW version.
• remember(scope="user") for cross-workspace preferences and corrections. remember(scope="workspace") for project facts not obvious from files.
• Before saving, check the digest — if the fact is already there, skip it. Duplicates are the #1 memory problem.
• Do NOT save: transient notes, derivable facts, obvious context, unconfirmed guesses, or step plans (use tasks for those).
• For deeper memory management rules, call read_skill("memory").`;
}

function buildVerifyProtocol(): string {
  return `Code workspace: call read_skill("code") before editing code files — it contains the full verification flow (tsc, tests, lint) and editing rules.`;
}

function buildBookProtocol(): string {
  return `Long-form writing: call read_skill("book") before a writing session — it covers the full workflow: workspace exploration, incremental drafting, continuity search, memory use for characters and plot, and export.`;
}

function buildTaskProtocol(): string {
  return `Task protocol:
• For goals with 3+ ordered steps, create ONE tracked task. Skip for one-shot edits or Q&A.
• Mark a step [in-progress] BEFORE starting, [done] IMMEDIATELY after. Never batch updates.
• When a tracked task exists, check its step list first. Never recreate a task that already exists — it survives context summarization.
• Before reporting done, reconcile every step (none should remain [pending] or [in-progress]).
• For full task creation and lifecycle details, call read_skill("tasks").`;
}

function buildHtmlGuidance(): string {
  return `HTML / interactive demo: call read_skill("html") — it covers layout best practices, asset rules, JavaScript patterns, and the screenshot_preview verification loop.`;
}

function buildSpreadsheetProtocol(): string {
  return `Spreadsheet: call read_skill("spreadsheet") before working with CSV/TSV/XLSX files — it contains tool selection rules, cell-level editing patterns, and data integrity guidelines.`;
}

function buildActiveTaskSummary(activeTask?: Task | null): string {
  if (!activeTask) return '';

  const allDone = activeTask.steps.every((s) => s.status === 'done' || s.status === 'skipped');
  const doneCount = activeTask.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const progress = `${doneCount}/${activeTask.steps.length} steps complete`;
  const statusLine = allDone ? '✓ COMPLETE' : 'IN PROGRESS';

  return [
    '═══════════════════════════════════════',
    `ACTIVE TASK [${statusLine}] — ${progress}`,
    '═══════════════════════════════════════',
    `Title: ${activeTask.title}`,
    ...(activeTask.description ? [`Description: ${activeTask.description}`] : []),
    `Task id: ${activeTask.id}`,
    'Steps:',
    ...activeTask.steps.map((step, index) => {
      const note = step.note?.trim() ? ` — ${step.note.trim()}` : '';
      const marker = step.status === 'done' ? '✓' : step.status === 'in-progress' ? '▶' : step.status === 'skipped' ? '—' : ' ';
      return `  ${marker} ${index}. [${step.status}] ${step.title}${note}`;
    }),
    '═══════════════════════════════════════',
    allDone
      ? 'All steps done. Confirm with the user before closing this task.'
      : 'Mark each step [in-progress] before starting it, and [done] immediately after. Do not batch updates.',
  ].join('\n');
}

function summarizeMarkdownForPrompt(content: string, maxChars: number): string {
  const digest = buildAgentGuidanceDigest(content, maxChars);
  return digest || content.trim().slice(0, maxChars);
}

// ── Memory loader ─────────────────────────────────────────────────────────────
/** Loads and keeps .cafezin/memory.md in sync whenever the workspace changes. */
export function useWorkspaceMemory(
  workspacePath: string | undefined,
  refreshToken = 0,
): [string, (v: string) => void] {
  const [memoryContent, setMemoryContent] = useState('');
  const reloadMemory = useCallback((markdownOverride?: string) => {
    if (!workspacePath) {
      setMemoryContent('');
      return;
    }
    void buildWorkspaceMemoryPromptText(workspacePath, markdownOverride)
      .then(setMemoryContent)
      .catch(() => setMemoryContent(typeof markdownOverride === 'string' ? markdownOverride : ''));
  }, [workspacePath]);

  useEffect(() => {
    if (!workspacePath) { setMemoryContent(''); return; }
    const memPath = `${workspacePath}/.cafezin/memory.md`;
    exists(memPath).then((found) => {
      if (!found) { setMemoryContent(''); return; }
      reloadMemory();
    }).catch(() => setMemoryContent(''));
  }, [workspacePath, refreshToken, reloadMemory]);

  const handleMemoryWritten = useCallback((newMarkdown: string) => {
    reloadMemory(newMarkdown);
  }, [reloadMemory]);

  return [memoryContent, handleMemoryWritten];
}
// ── User profile loader ────────────────────────────────────────────
/**
 * Loads ~/.cafezin/user-profile.md — global user memory that persists across
 * all workspaces. Returned setter is called by the remember(scope="user") tool.
 */
export function useUserProfile(): [string, (v: string) => void] {
  const [profileContent, setProfileContent] = useState('');
  useEffect(() => {
    homeDir()
      .then(async (home) => {
        const profilePath = `${home.replace(/\/$/, '')}/.cafezin/user-profile.md`;
        const found = await exists(profilePath).catch(() => false);
        if (!found) { setProfileContent(''); return; }
        const text = await readTextFile(profilePath).catch(() => '');
        setProfileContent(text);
      })
      .catch(() => setProfileContent(''));
  }, []); // runs once on mount — user profile is global, not workspace-scoped
  return [profileContent, setProfileContent];
}
// ── Model hint ────────────────────────────────────────────────────────────────
export function modelHint(id: string): string {
  if (/claude.*opus/i.test(id))   return 'You are running as Claude Opus — exceptionally strong at long-form reasoning, creative writing, and nuanced instruction following.';
  if (/claude.*sonnet/i.test(id)) return 'You are running as Claude Sonnet — excellent at creative writing, editing, and multi-step workspace tasks.';
  if (/claude.*haiku/i.test(id))  return 'You are running as Claude Haiku — fast and efficient; great for quick edits and concise responses.';
  if (/^o[1-9]/i.test(id))        return `You are running as ${id} — a deep-reasoning model. You excel at complex multi-step planning. Note: you cannot process images.`;
  if (/gpt-4o/i.test(id))         return `You are running as ${id} — fast, vision-capable, well-rounded for writing and tool use.`;
  if (/gpt-4\.1/i.test(id))       return `You are running as ${id} — strong instruction following and long-context document work.`;
  if (/gemini/i.test(id))         return `You are running as ${id} — very large context window; great for long documents.`;
  return `You are running as ${id}.`;
}

// ── useSystemPrompt ───────────────────────────────────────────────────────────
interface UseSystemPromptParams {
  model: string;
  workspace: Workspace | null | undefined;
  workspacePath: string | undefined;
  documentContext: string;
  agentContext: string;
  activeFile: string | undefined;
  memoryContent: string;
  userProfileContent: string;
  activeTask?: Task | null;
  workspaceExportConfig?: WorkspaceExportConfig;
  workspaceConfig?: WorkspaceConfig;
}

export function useSystemPrompt({
  model,
  workspace,
  documentContext,
  agentContext,
  activeFile,
  memoryContent,
  userProfileContent,
  activeTask,
  workspaceExportConfig,
}: UseSystemPromptParams): ChatMessage {
  const hasTools = !!workspace;
  const capabilityState = getAgentCapabilityState(workspace);
  const workspaceProfile = getAgentWorkspaceProfile(workspace);

  const workspaceFileList = useMemo(() => summarizeWorkspaceFiles(workspace?.fileTree, {
    activeFile,
    recentFiles: workspace?.config?.recentFiles,
    workspaceIndex: workspace?.workspaceIndex,
  }), [workspace?.fileTree, workspace?.config?.recentFiles, workspace?.workspaceIndex, activeFile]);

  const workspaceGuidance = useMemo(() => buildAgentGuidanceDigest(
    workspace?.agentInstructionSources ?? agentContext,
  ), [workspace?.agentInstructionSources, agentContext]);

  const truncatedDocumentContext = useMemo(
    () => truncateDocumentContext(documentContext, activeFile),
    [documentContext, activeFile],
  );
  const summarizedUserProfile = useMemo(
    () => userProfileContent ? summarizeMarkdownForPrompt(userProfileContent, 1400) : '',
    [userProfileContent],
  );
  const summarizedMemory = useMemo(
    () => memoryContent ? summarizeMarkdownForPrompt(memoryContent, 2200) : '',
    [memoryContent],
  );

  return useMemo<ChatMessage>(() => ({
    role: 'system',
    content: [
      // ── Model identity ────────────────────────────────────────
      modelHint(model),

      // ── What this app is ─────────────────────────────────────
      buildCoreAppSummary(),

      // ── Session startup ──────────────────────────────────────
      hasTools
        ? `Session startup — apply at the start of a substantive request (skip for greetings or one-line Q&A):
• If the request involves files and you haven't explored the workspace yet, call outline_workspace or list_workspace_files before making assumptions.
• Workspace memory and user profile are injected at the bottom of this prompt — read them before any long task.
• If the user says "continue where we left off" or references a past session, call read_workspace_file(path=".cafezin/copilot-log.jsonl") and find archive entries (entryType:"archive") to restore context.
• Load skill protocols just-in-time: call read_skill("canvas") immediately before canvas work, read_skill("book") before a writing session, read_skill("code") before editing code, read_skill("export") before running an export, etc. Never load skills preemptively — only when you are about to use them.`
        : '',

      // ── Language preference ───────────────────────────────────
      (() => {
        const lang = workspace?.config?.preferredLanguage ?? 'pt-BR';
        if (lang === 'pt-BR') {
          return 'Language: the user\'s primary language is Brazilian Portuguese (pt-BR). Always detect the language of each incoming message and reply in that same language. When the message is ambiguous or language-neutral, default to Brazilian Portuguese.';
        }
        return `Language: the user has configured this workspace to use ${lang}. Reply in ${lang} unless the message is clearly written in a different language, in which case mirror that language.`;
      })(),

      'Response formatting: Cafezin renders assistant replies as Markdown in the AI panel. Prefer well-structured Markdown by default when it improves readability: headings, bullet lists, numbered lists, tables, blockquotes, and fenced code blocks. Do not wrap the entire answer in a single code fence. For very short replies, plain sentences are fine.',

      // ── File types ────────────────────────────────────────────
      buildFileTypeSummary(),

      // ── Canvas / visual editing ───────────────────────────────
      capabilityState.canvas ? buildCanvasProtocol() : '',

      capabilityState.spreadsheet ? buildSpreadsheetProtocol() : '',

      hasTools ? buildExportSystemSummary(workspaceExportConfig ?? workspace?.config?.exportConfig) : '',
      hasTools ? buildActiveTaskSummary(activeTask) : '',

      hasTools
        ? [
            buildToolUsageProtocol(),
            buildMemoryProtocol(),
            ...(workspaceProfile.codeWorkspace ? [buildVerifyProtocol()] : []),
            ...(workspaceProfile.longFormWriting ? [buildBookProtocol()] : []),
            buildTaskProtocol(),
            `Workspace capability switches (configured in Agent Settings):
• Canvas tools: ${capabilityState.canvas ? 'enabled' : 'disabled — to enable, open [Agent Settings](cafezin://settings?tab=agent)'}
• Spreadsheet tools: ${capabilityState.spreadsheet ? 'enabled' : 'disabled — to enable, open [Agent Settings](cafezin://settings?tab=agent)'}
• Web/browser tools: ${capabilityState.web ? 'enabled' : 'disabled — to enable, open [Agent Settings](cafezin://settings?tab=agent)'}
• If a user asks you to do something that requires a disabled tool group, tell them the capability is disabled and suggest they open [Agent Settings](cafezin://settings?tab=agent) to enable it. Never attempt to use disabled tool groups.`,
          ].join('\n\n')
        : 'No workspace is currently open, so file tools are unavailable.',

      workspaceFileList ? `\nWorkspace files:\n${workspaceFileList}` : '',
      summarizedUserProfile ? `\nUser profile digest:\n${summarizedUserProfile}` : '',
      summarizedMemory ? `\nWorkspace memory digest:\n${summarizedMemory}` : '',
      workspaceGuidance ? `\nWorkspace guidance:\n${workspaceGuidance}` : '',
      truncatedDocumentContext ? `\nCurrent document context:\n${truncatedDocumentContext}` : '',

      // ── HTML / interactive demo guidance ──────────────────────
      capabilityState.web && activeFile && (activeFile.endsWith('.html') || activeFile.endsWith('.htm'))
        ? buildHtmlGuidance()
        : '',
    ].filter(Boolean).join('\n\n'),
  }), [hasTools, model, workspaceFileList, summarizedUserProfile, summarizedMemory, workspaceGuidance, truncatedDocumentContext, activeFile, workspace?.config, activeTask, capabilityState.canvas, capabilityState.spreadsheet, capabilityState.web, workspaceProfile.codeWorkspace, workspaceProfile.longFormWriting]);
}
