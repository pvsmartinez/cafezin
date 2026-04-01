/**
 * MCP (Model Context Protocol) client.
 *
 * Manages MCP server configs (stored in localStorage) and the lifecycle of
 * running server processes (via Tauri commands). Exposes tool definitions and
 * a call interface that feed directly into the agent loop via mcpTools.ts.
 *
 * Naming: MCP tools are prefixed `mcp__<sanitizedServerId>__<toolName>` so
 * they can coexist with built-in workspace tools without colliding.
 */

import { invoke } from '@tauri-apps/api/core';
import type { McpServerConfig } from '../types';
import type { ToolDefinition } from '../utils/tools/shared';
import { SK } from './storageKeys';

// ── Types ─────────────────────────────────────────────────────────────────────

export type McpServerStatus = 'stopped' | 'connecting' | 'connected' | 'error';

interface McpServerToolSchema {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      items?: { type: string };
    }>;
    required?: string[];
  };
}

interface RuntimeEntry {
  status: McpServerStatus;
  error?: string;
  tools: McpServerToolSchema[];
}

// ── Module-level runtime state ─────────────────────────────────────────────────

/** Per-server runtime state: status + discovered tools. */
const runtime: Map<string, RuntimeEntry> = new Map();

// ── Persistence helpers ────────────────────────────────────────────────────────

export function loadMcpServerConfigs(): McpServerConfig[] {
  try {
    const raw = localStorage.getItem(SK.MCP_SERVERS);
    if (!raw) return [];
    return JSON.parse(raw) as McpServerConfig[];
  } catch {
    return [];
  }
}

export function saveMcpServerConfigs(configs: McpServerConfig[]): void {
  localStorage.setItem(SK.MCP_SERVERS, JSON.stringify(configs));
}

// ── Naming helpers ─────────────────────────────────────────────────────────────

/** Produce a short, safe identifier fragment from a server ID (UUID). */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 12);
}

export function mcpToolPrefix(serverId: string): string {
  return `mcp__${sanitizeId(serverId)}__`;
}

export function parseMcpToolName(prefixedName: string): { serverId: string; toolName: string } | null {
  const configs = loadMcpServerConfigs();
  for (const cfg of configs) {
    const prefix = mcpToolPrefix(cfg.id);
    if (prefixedName.startsWith(prefix)) {
      return { serverId: cfg.id, toolName: prefixedName.slice(prefix.length) };
    }
  }
  return null;
}

// ── Platform check ─────────────────────────────────────────────────────────────

/** MCP requires desktop Tauri (no MAS sandbox, no iOS). */
function isMcpAvailable(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as any).__TAURI_INTERNALS__ !== 'undefined'
    && import.meta.env.VITE_TAURI_MOBILE !== 'true'
    && !import.meta.env.VITE_MAS_BUILD;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/**
 * Start a single MCP server and cache its tool definitions.
 * Idempotent — skips servers that are already connected.
 */
export async function initMcpServer(cfg: McpServerConfig): Promise<void> {
  if (!isMcpAvailable()) return;
  if (!cfg.enabled) return;
  const existing = runtime.get(cfg.id);
  if (existing?.status === 'connected') return;

  runtime.set(cfg.id, { status: 'connecting', tools: [] });

  try {
    const result = await invoke<{ tools: McpServerToolSchema[] }>('mcp_start_server', {
      serverId: cfg.id,
      command: cfg.command,
      args: cfg.args,
      envJson: cfg.env ? JSON.stringify(cfg.env) : '{}',
    });
    runtime.set(cfg.id, { status: 'connected', tools: result.tools });
  } catch (err) {
    runtime.set(cfg.id, { status: 'error', error: String(err), tools: [] });
  }
}

/**
 * Initialize all enabled MCP servers from localStorage.
 * Safe to call multiple times — already-connected servers are skipped.
 */
export async function initMcpServers(configs?: McpServerConfig[]): Promise<void> {
  if (!isMcpAvailable()) return;
  const cfgs = configs ?? loadMcpServerConfigs();
  await Promise.all(cfgs.filter((c) => c.enabled).map((c) => initMcpServer(c)));
}

/** Stop a single MCP server. */
export async function stopMcpServer(serverId: string): Promise<void> {
  if (!isMcpAvailable()) return;
  try {
    await invoke('mcp_stop_server', { serverId });
  } catch { /* best-effort */ }
  runtime.delete(serverId);
}

/** Stop all running MCP servers. */
export async function stopAllMcpServers(): Promise<void> {
  const ids = [...runtime.keys()];
  await Promise.all(ids.map((id) => stopMcpServer(id)));
}

// ── Tool call ──────────────────────────────────────────────────────────────────

/**
 * Call an MCP tool by its prefixed name (e.g. `mcp__abc123__read_file`).
 * Returns a human-readable result string for the agent.
 */
export async function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (!isMcpAvailable()) {
    return 'MCP is not available on this platform.';
  }
  try {
    const responseJson = await invoke<string>('mcp_call', {
      serverId,
      toolName,
      argsJson: JSON.stringify(args),
    });
    const resp = JSON.parse(responseJson) as {
      result?: { content?: Array<{ type: string; text?: string }> };
    };
    // MCP result.content is an array of { type, text } blocks
    const content = resp.result?.content;
    if (Array.isArray(content)) {
      return content
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text!)
        .join('\n') || '(empty response)';
    }
    return responseJson;
  } catch (err) {
    return `MCP error: ${String(err)}`;
  }
}

// ── Tool definition exposure ───────────────────────────────────────────────────

/**
 * Returns ToolDefinition[] for all tools across all connected MCP servers.
 * Used by getWorkspaceTools() so the agent loop picks them up automatically.
 */
export function getMcpToolDefs(): ToolDefinition[] {
  const configs = loadMcpServerConfigs();
  const defs: ToolDefinition[] = [];

  for (const cfg of configs) {
    if (!cfg.enabled) continue;
    const entry = runtime.get(cfg.id);
    if (!entry || entry.status !== 'connected') continue;

    const prefix = mcpToolPrefix(cfg.id);
    for (const tool of entry.tools) {
      const schema = tool.inputSchema ?? { type: 'object', properties: {}, required: [] };
      defs.push({
        type: 'function',
        function: {
          name: `${prefix}${tool.name}`,
          description: tool.description
            ? `[MCP: ${cfg.name}] ${tool.description}`
            : `[MCP: ${cfg.name}] ${tool.name}`,
          parameters: {
            type: 'object',
            properties: (schema.properties ?? {}) as ToolDefinition['function']['parameters']['properties'],
            required: schema.required,
          },
        },
      });
    }
  }

  return defs;
}

// ── Status helpers ─────────────────────────────────────────────────────────────

export function getMcpServerStatus(serverId: string): McpServerStatus {
  return runtime.get(serverId)?.status ?? 'stopped';
}

export function getMcpServerError(serverId: string): string | undefined {
  return runtime.get(serverId)?.error;
}

export function getMcpServerTools(serverId: string): McpServerToolSchema[] {
  return runtime.get(serverId)?.tools ?? [];
}
