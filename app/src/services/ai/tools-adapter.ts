/**
 * Converts our internal ToolDefinition[] + ToolExecutor into the Vercel AI SDK
 * ToolSet format used by streamText / generateText.
 *
 * Each tool's `execute` function wraps our ToolExecutor so the SDK can invoke
 * tools automatically during its agentic loop.
 */

import { tool, jsonSchema } from 'ai';
import type { ToolDefinition, ToolExecutor } from '../../utils/tools/shared';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toVercelToolSet(defs: ToolDefinition[], execute: ToolExecutor): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {};

  for (const def of defs) {
    const name = def.function.name;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result[name] = tool<Record<string, any>, string>({
      description: def.function.description,
      inputSchema: jsonSchema<Record<string, unknown>>(
        def.function.parameters as Parameters<typeof jsonSchema>[0],
      ),
      execute: async (args) => {
        try {
          return await execute(name, args as Record<string, unknown>);
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });
  }

  return result;
}
