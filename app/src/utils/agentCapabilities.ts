import type { FileTreeNode, WorkspaceConfig, Workspace, WorkspaceIndex } from '../types';

export const CANVAS_AGENT_TOOL_NAMES = new Set([
  'list_canvas_shapes',
  'canvas_op',
  'canvas_screenshot',
  'add_canvas_image',
]);

export const SPREADSHEET_AGENT_TOOL_NAMES = new Set([
  'read_spreadsheet',
  'write_spreadsheet',
]);

export const WEB_AGENT_TOOL_NAMES = new Set([
  'web_search',
  'search_images',
  'fetch_url',
  'run_command',
  'screenshot_preview',
  'publish_vercel',
]);

export interface AgentCapabilityState {
  markdownMermaid: boolean;
  canvas: boolean;
  spreadsheet: boolean;
  web: boolean;
}

export interface AgentWorkspaceProfile {
  longFormWriting: boolean;
  spreadsheetCentric: boolean;
  codeWorkspace: boolean;
}

export type AgentCapabilitySource =
  | WorkspaceConfig
  | Pick<Workspace, 'config' | 'fileTree' | 'workspaceIndex'>
  | null
  | undefined;

function flattenFiles(nodes: FileTreeNode[] | undefined): string[] {
  if (!nodes) return [];
  const files: string[] = [];
  for (const node of nodes) {
    if (node.isDirectory) files.push(...flattenFiles(node.children));
    else files.push(node.path.toLowerCase());
  }
  return files;
}

function countFilesByPredicate(files: string[], predicate: (path: string) => boolean): number {
  let count = 0;
  for (const path of files) {
    if (predicate(path)) count += 1;
  }
  return count;
}

export function detectAgentCapabilitiesFromFileTree(fileTree?: FileTreeNode[]): AgentCapabilityState {
  const files = flattenFiles(fileTree);
  return {
    markdownMermaid: false,
    canvas: files.some((path) => path.endsWith('.tldr.json')),
    spreadsheet: files.some((path) => /\.(csv|tsv|xlsx|xls|ods|xlsm|xlsb)$/i.test(path)),
    web: files.some((path) => /\.(html|htm)$/i.test(path)),
  };
}

function extractConfig(source?: AgentCapabilitySource): WorkspaceConfig | undefined {
  if (!source) return undefined;
  if ('config' in source) return source.config;
  return source;
}

function extractFileTree(source?: AgentCapabilitySource): FileTreeNode[] | undefined {
  if (!source || !('fileTree' in source)) return undefined;
  return source.fileTree;
}

function extractWorkspaceIndex(source?: AgentCapabilitySource): WorkspaceIndex | undefined {
  if (!source || !('workspaceIndex' in source)) return undefined;
  return source.workspaceIndex;
}

function detectMarkdownMermaidFromIndex(index?: WorkspaceIndex): boolean {
  if (!index) return false;
  return index.entries.some((entry) => /\.(md|mdx)$/i.test(entry.path) && entry.outline.includes('[mermaid]'));
}

function resolveCapability(override: boolean | undefined, detected: boolean): boolean {
  if (override === true) return true;
  if (override === false) return false;
  return detected;
}

export function getAgentCapabilityState(source?: AgentCapabilitySource): AgentCapabilityState {
  const workspaceConfig = extractConfig(source);
  const detected = detectAgentCapabilitiesFromFileTree(extractFileTree(source));
  return {
    markdownMermaid: resolveCapability(
      workspaceConfig?.features?.markdown?.mermaid,
      detectMarkdownMermaidFromIndex(extractWorkspaceIndex(source)) || detected.markdownMermaid,
    ),
    canvas: resolveCapability(workspaceConfig?.features?.canvas?.agentTools, detected.canvas),
    spreadsheet: resolveCapability(workspaceConfig?.features?.spreadsheet?.agentTools, detected.spreadsheet),
    web: resolveCapability(workspaceConfig?.features?.web?.agentTools, detected.web),
  };
}

export function getAgentWorkspaceProfile(source?: AgentCapabilitySource): AgentWorkspaceProfile {
  const files = flattenFiles(extractFileTree(source));
  const markdownCount = countFilesByPredicate(files, (path) => /\.(md|mdx|txt)$/i.test(path));
  const spreadsheetCount = countFilesByPredicate(files, (path) => /\.(csv|tsv|xlsx|xls|ods|xlsm|xlsb)$/i.test(path));
  const codeCount = countFilesByPredicate(files, (path) => /\.(ts|tsx|js|jsx|py|rs|java|go|rb|php|c|cc|cpp|h|hpp|css|scss|sql)$/i.test(path));
  const codeProjectMarkers = countFilesByPredicate(files, (path) =>
    /(^|\/)(package\.json|tsconfig\.json|pyproject\.toml|cargo\.toml|makefile|vite\.config\.[^/]+|next\.config\.[^/]+|requirements\.txt)$/i.test(path),
  );
  const chapterLikeMarkdown = countFilesByPredicate(files, (path) =>
    /\.(md|mdx|txt)$/i.test(path) && /(chapter|cap(?:itulo)?[-_ ]?\d+|manuscript|outline|notes|roteiro|aula[-_ ]?\d+)/i.test(path),
  );

  return {
    longFormWriting:
      markdownCount >= 6 && (chapterLikeMarkdown >= 2 || markdownCount >= codeCount + spreadsheetCount),
    spreadsheetCentric:
      spreadsheetCount >= 1 && spreadsheetCount >= markdownCount && spreadsheetCount >= Math.max(1, codeCount / 2),
    codeWorkspace:
      codeProjectMarkers >= 1 || codeCount >= 8,
  };
}

export function isToolEnabledByWorkspace(toolName: string, source?: AgentCapabilitySource): boolean {
  const caps = getAgentCapabilityState(source);
  if (CANVAS_AGENT_TOOL_NAMES.has(toolName)) return caps.canvas;
  if (SPREADSHEET_AGENT_TOOL_NAMES.has(toolName)) return caps.spreadsheet;
  if (WEB_AGENT_TOOL_NAMES.has(toolName)) return caps.web;
  return true;
}
