/**
 * Converts our internal ChatMessage[] (OpenAI wire format) to the Vercel AI SDK
 * ModelMessage[] format consumed by streamText / generateText.
 *
 * Key differences from our format:
 *  - SDK uses typed `content` arrays (TextPart, ToolCallPart, ToolResultPart)
 *  - Tool-result messages require `toolName` (looked up from assistant tool_calls)
 *  - Image content uses `type: 'image'` instead of `type: 'image_url'`
 */

import type { ModelMessage } from 'ai';
import type { ChatMessage } from '../../types';

export function chatToModelMessages(messages: ChatMessage[]): ModelMessage[] {
  // Build toolCallId → toolName from assistant messages so tool-result messages
  // can include the required toolName field.
  const toolCallNames = new Map<string, string>();
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        toolCallNames.set(tc.id, tc.function.name);
      }
    }
  }

  const result: ModelMessage[] = [];

  for (const m of messages) {
    if (m.role === 'system') {
      result.push({ role: 'system', content: typeof m.content === 'string' ? m.content : '' });

    } else if (m.role === 'user') {
      if (typeof m.content === 'string') {
        result.push({ role: 'user', content: m.content });
      } else {
        const rawParts = m.content as any[];
        const parts: any[] = [];
        for (const part of rawParts) {
          if (part.type === 'text') {
            parts.push({ type: 'text', text: part.text as string });
          } else if (part.type === 'image_url') {
            const url: string = part.image_url?.url ?? '';
            parts.push({ type: 'image', image: url });
          }
        }
        result.push({ role: 'user', content: parts.length ? parts : '' } as ModelMessage);
      }

    } else if (m.role === 'assistant') {
      const textContent = typeof m.content === 'string' ? m.content : '';
      if (m.tool_calls?.length) {
        result.push({
          role: 'assistant',
          content: [
            ...(textContent ? [{ type: 'text' as const, text: textContent }] : []),
            ...m.tool_calls.map((tc) => ({
              type: 'tool-call' as const,
              toolCallId: tc.id,
              toolName: tc.function.name,
              input: (() => {
                try { return JSON.parse(tc.function.arguments || '{}'); }
                catch { return {}; }
              })(),
            })),
          ],
        } as ModelMessage);
      } else {
        result.push({ role: 'assistant', content: textContent });
      }

    } else if (m.role === 'tool') {
      const toolName = toolCallNames.get(m.tool_call_id ?? '') ?? m.name ?? 'unknown';
      result.push({
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: m.tool_call_id ?? '',
          toolName,
          output: {
            type: 'text',
            value: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          },
        }],
      } as ModelMessage);
    }
  }

  return result;
}
