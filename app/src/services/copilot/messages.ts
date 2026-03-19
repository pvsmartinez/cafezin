import type { ChatMessage } from '../../types';

/**
 * Sanitize a message array before sending to the Copilot API.
 * Removes structural problems that cause 400 Bad Request:
 *   - Consecutive assistant messages  (keep last; merges content)
 *   - Consecutive user messages       (keep last — avoids duplicate injection)
 *   - Orphan tool messages            (no matching tool_call_id in any preceding
 *                                      assistant turn — they'd cause a 400)
 *   - Dangling tool_calls             (assistant with tool_calls whose responses
 *                                      were sliced off — unresolved ones → 400)
 *   - Empty-role or undefined messages
 */
export function sanitizeLoop(msgs: ChatMessage[]): ChatMessage[] {
  if (msgs.length === 0) return msgs;

  // ── Pre-pass: strip UI-only fields that the Copilot API doesn't accept ──
  // `items` (MessageItem[]) is local display metadata stored in React state.
  // `activeFile`, `attachedImage`, `attachedImages`, and `attachedFile` are also UI-only fields.
  const stripped: ChatMessage[] = msgs.map((m) => {
    if (!m) return m;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {
      items: _items,
      activeFile: _af,
      attachedImage: _ai,
      attachedImages: _ais,
      attachedFile: _afile,
      ...clean
    } = m as any;
    return clean as ChatMessage;
  });

  // Pass 1: resolve orphan tool messages by tracking active tool_call_ids
  const activeTcIds = new Set<string>();
  const pass1: ChatMessage[] = [];
  for (const m of stripped) {
    if (!m || !m.role) continue;
    if (m.role === 'assistant') {
      activeTcIds.clear();
      if (m.tool_calls) m.tool_calls.forEach((tc) => activeTcIds.add(tc.id));
      pass1.push(m);
    } else if (m.role === 'tool') {
      if (m.tool_call_id && activeTcIds.has(m.tool_call_id)) {
        pass1.push(m);
      }
      // else: silently drop the orphan
    } else {
      if (m.role === 'user' || m.role === 'system') activeTcIds.clear();
      pass1.push(m);
    }
  }

  // Pass 2: collapse consecutive same-role messages
  const out: ChatMessage[] = [];
  for (const m of pass1) {
    const prev = out.length > 0 ? out[out.length - 1] : null;
    if (prev && prev.role === m.role && m.role === 'assistant') {
      const mergedContent = [prev.content, m.content].filter(Boolean).join('\n').trim();
      out[out.length - 1] = {
        ...m,
        content: mergedContent || '',
        tool_calls: m.tool_calls ?? prev.tool_calls,
      };
      continue;
    }
    if (prev && prev.role === m.role && m.role === 'user') {
      out[out.length - 1] = m;
      continue;
    }
    out.push(m);
  }

  // Pass 3: drop trailing assistant messages with unresolved tool_calls.
  {
    let i = out.length - 1;
    while (i >= 0) {
      const m = out[i];
      if (m.role !== 'assistant' || !m.tool_calls || m.tool_calls.length === 0) {
        i--;
        continue;
      }
      const resolvedIds = new Set<string>();
      let j = i + 1;
      while (j < out.length && out[j].role === 'tool') {
        if (out[j].tool_call_id) resolvedIds.add(out[j].tool_call_id!);
        j++;
      }
      if (!m.tool_calls.every((tc) => resolvedIds.has(tc.id))) {
        out.splice(i);
      }
      i--;
    }
  }

  return out;
}
