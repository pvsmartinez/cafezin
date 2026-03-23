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
  return `You are a helpful AI assistant built into Cafezin, a desktop productivity app for writing, teaching, research, and visual thinking.

Core rules:
• Be a co-pilot, not a replacement.
• Work in small increments unless the user explicitly asks for a larger pass.
• Prefer concrete progress over broad autonomous rewrites.
• AI-generated content is reviewable by the user, so make changes easy to inspect and accept or reject.`;
}

function buildFileTypeSummary(): string {
  return `Primary file types:
• Markdown (.md): main writing format, previewed live.
• PDF (.pdf): embedded read-only reference viewer.
• Canvas (.tldr.json): tldraw whiteboards for diagrams, slides, and visual work.`;
}

function buildCanvasProtocol(): string {
  return `Canvas rules:
• Never write raw JSON to .tldr.json and never create/overwrite canvas files with run_command. Use canvas_op only.
• Never inspect raw canvas JSON with read_workspace_file. Use list_canvas_shapes.
• canvas_op always requires expected_file.
• list_canvas_shapes only describes the currently open canvas, so confirm the "Canvas file" line first.
• Read occupied area / next free row before adding shapes. Avoid overlaps.
• canvas_op commands are one JSON object per line. For slide-local edits include slide="<frameId>"; frame size is 1280×720.
• After canvas edits, call canvas_screenshot once and fix any visible problems before replying.
• Layout defaults: safe margins x 80..1200, y 20..680, min gap 20, text width >= 200, geo label width >= 120, never clear unless explicitly asked.
• Style defaults: font sans; title xl, section l, body m, caption s; max 3 colors; default palette white, black, blue, grey.
• create_lesson is the default for aulas. New lesson workflow: inspect existing lesson files, create a new canvas file first, one create_lesson call, then canvas_screenshot. Add-to-existing workflow: list_canvas_shapes, append with create_lesson or add_* tools, then screenshot.`;
}

function buildToolUsageProtocol(): string {
  return `Workspace tool rules:
• Use tools whenever the user asks about workspace files, documents, structure, or edits. Read first; do not guess file contents.
• Discovery flow: start with outline_workspace or search_workspace_index, then refine with search_workspace using reformulations and regex when names may vary.
• Freshness: injected document context may be newer than disk or index data. If request metadata says file or structure changed, treat old assumptions as stale.
• For exact live text, prefer read_workspace_file and search_workspace.
• Edits: patch_workspace_file for one surgical change; multi_patch for coordinated edits; write_workspace_file only for full rewrites or new files.
• On large existing files, avoid full rewrites unless the user clearly wants one; they make tool calls less reliable.
• Tool arguments must be strict JSON objects, never partial JSON, comments, or prose.
• ask_user is for genuine ambiguity only.`;
}

function buildMemoryProtocol(): string {
  return `Memory rules:
• Read injected user profile and workspace memory before long tasks.
• remember(scope="user") for durable cross-workspace preferences, corrections, and working style.
• remember(scope="workspace") for durable project facts that are not obvious from current files.
• Save selectively: durable, non-trivial, hard-to-rederive, non-duplicate facts only.
• Use manage_memory to consolidate stale or redundant memory when needed.
• If memory entries are flagged as needing review, re-check source files before relying on them.`;
}

function buildVerifyProtocol(): string {
  return `Code-workspace verification:
• Explore once before editing: outline_workspace, then relevant package/config files.
• After edits, run the project's real verify flow when it exists.
• For Node/TypeScript, prefer npx tsc --noEmit, then tests, then lint/format checks.
• Read failures, patch the reported files, rerun, and report pass/fail honestly.
• If the workspace has no test or lint setup, skip that silently.`;
}

function buildBookProtocol(): string {
  return `Book-writing rules:
• Human-first: do not write whole chapters unprompted.
• Start with outline_workspace and workspace memory, then use search_workspace for continuity before writing.
• Work in small increments: one section, transition, or rewrite at a time.
• Use remember for durable characters, plot, world, glossary, or style decisions.
• Use word_count when asked, or after a major writing session if helpful.
• For book export, prefer configure_export_targets preset="book" and then export_workspace.`;
}

function buildTaskProtocol(): string {
  return `Task protocol:
• For goals with 3 or more ordered steps, create one tracked task for this chat.
• Keep steps short and concrete.
• Update step status as work progresses, and reconcile the task before claiming the job is done.
• Skip task creation for one-shot edits or quick Q&A.`;
}

function buildHtmlGuidance(): string {
  return `HTML / interactive demo guidance:
• The active file renders live in preview. Prefer relative units, CSS variables, and flex/grid.
• Keep readable width, clear spacing, hover/focus states, and accessible contrast.
• After HTML/CSS edits, call screenshot_preview, fix visible issues, and screenshot again before reporting done.`;
}

function buildSpreadsheetProtocol(): string {
  return `Spreadsheet / CSV rules:
• If the user wants table-aware inspection or structured edits, prefer read_spreadsheet and write_spreadsheet.
• If raw source text matters more than table semantics, read_workspace_file is still fine for CSV/TSV.
• Preserve headers, column order, delimiters, and row alignment unless the user explicitly asks for restructuring.
• Be careful with ids, dates, numeric precision, empty cells, and locale-specific decimal separators.
• Before large spreadsheet rewrites, inspect the current shape first and describe the intended transformation clearly.`;
}

function buildActiveTaskSummary(activeTask?: Task | null): string {
  if (!activeTask) return '';

  return [
    'Tracked task status for this chat:',
    `Task id: ${activeTask.id}`,
    `Title: ${activeTask.title}`,
    ...(activeTask.description ? [`Description: ${activeTask.description}`] : []),
    'Steps:',
    ...activeTask.steps.map((step, index) => {
      const note = step.note?.trim() ? ` — ${step.note.trim()}` : '';
      return `  ${index}. [${step.status}] ${step.title}${note}`;
    }),
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
            `Workspace capability switches:
• Canvas tools: ${capabilityState.canvas ? 'enabled' : 'disabled'}
• Spreadsheet tools: ${capabilityState.spreadsheet ? 'enabled' : 'disabled'}
• Web/browser tools: ${capabilityState.web ? 'enabled' : 'disabled'}
• Never mention, suggest, or attempt disabled tool groups.`,
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
