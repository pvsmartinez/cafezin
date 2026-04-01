/**
 * MCP domain executor.
 *
 * Handles tool calls whose names start with the `mcp__` prefix.
 * Tool defs come from getMcpToolDefs() (mcpClient.ts) and are injected into
 * the agent loop via getWorkspaceTools() in workspaceTools.ts.
 */

import { callMcpTool, parseMcpToolName } from '../../services/mcpClient';
import type { DomainExecutor, ToolDefinition } from './shared';

// MCP_TOOL_DEFS is dynamically composed \u2014 the actual list lives in getMcpToolDefs().
// This constant is intentionally empty; workspaceTools.ts calls getMcpToolDefs() directly.
export const MCP_TOOL_DEFS: ToolDefinition[] = [];

export const executeMcpTools: DomainExecutor = async (name, args) => {
  if (!name.startsWith('mcp__')) return null;

  const parsed = parseMcpToolName(name);
  if (!parsed) {
    return `Unknown MCP tool: ${name}`;
  }

  return callMcpTool(parsed.serverId, parsed.toolName, args);
};
