import type { FileTreeNode, WorkspaceConfig, Workspace } from '../types';

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
  canvas: boolean;
  spreadsheet: boolean;
  web: boolean;
}

export type AgentCapabilitySource =
  | WorkspaceConfig
  | Pick<Workspace, 'config' | 'fileTree'>
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

export function detectAgentCapabilitiesFromFileTree(fileTree?: FileTreeNode[]): AgentCapabilityState {
  const files = flattenFiles(fileTree);
  return {
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

function resolveCapability(override: boolean | undefined, detected: boolean): boolean {
  if (override === true) return true;
  if (override === false) return false;
  return detected;
}

export function getAgentCapabilityState(source?: AgentCapabilitySource): AgentCapabilityState {
  const workspaceConfig = extractConfig(source);
  const detected = detectAgentCapabilitiesFromFileTree(extractFileTree(source));
  return {
    canvas: resolveCapability(workspaceConfig?.features?.canvas?.agentTools, detected.canvas),
    spreadsheet: resolveCapability(workspaceConfig?.features?.spreadsheet?.agentTools, detected.spreadsheet),
    web: resolveCapability(workspaceConfig?.features?.web?.agentTools, detected.web),
  };
}

export function isToolEnabledByWorkspace(toolName: string, source?: AgentCapabilitySource): boolean {
  const caps = getAgentCapabilityState(source);
  if (CANVAS_AGENT_TOOL_NAMES.has(toolName)) return caps.canvas;
  if (SPREADSHEET_AGENT_TOOL_NAMES.has(toolName)) return caps.spreadsheet;
  if (WEB_AGENT_TOOL_NAMES.has(toolName)) return caps.web;
  return true;
}