/**
 * Tool call parsing utilities.
 *
 * Some models emit tool calls as XML text instead of the native tool_calls field.
 * Multiple fallback strategies are tried in order to maximise compatibility.
 */

// ── Network error humanization ────────────────────────────────────────────────

/** Convert raw Tauri/reqwest network errors to user-friendly messages. */
export function humanizeNetworkError(err: Error): Error {
  const msg = err.message.toLowerCase();
  if (
    msg.includes('error sending request for url') ||
    msg.includes('dns error') ||
    msg.includes('connect error') ||
    msg.includes('connection refused') ||
    msg.includes('network is unreachable')
  ) {
    return new Error('Sem conexão com a Internet — verifique sua rede e tente novamente.');
  }
  return err;
}

// ── JSON parsing helpers ──────────────────────────────────────────────────────

export function safeParseToolCallJson(raw: string): { name?: string; arguments?: unknown } | null {
  let text = raw.trim();
  if (!text) return null;

  // Strip markdown backticks if present
  text = text.replace(/^```(?:json)?\n([\s\S]*?)\n```$/g, '$1').trim();

  // Strategy 1: standard parse
  try {
    const parsed = JSON.parse(text) as any;
    const name = parsed.name || parsed.tool || parsed.tool_name || parsed.function || parsed.action;
    if (name) return { name, arguments: parsed.arguments || parsed.parameters || parsed.args || parsed };
  } catch { /* try next */ }

  // Strategy 2: replace literal newlines with \n
  try {
    const sanitised = text
      .replace(/\r\n/g, '\\n')
      .replace(/\r/g, '\\n')
      .replace(/([^\\])\n/g, '$1\\n')
      .replace(/^\n/g, '\\n');
    const parsed = JSON.parse(sanitised) as any;
    const name = parsed.name || parsed.tool || parsed.tool_name || parsed.function || parsed.action;
    if (name) return { name, arguments: parsed.arguments || parsed.parameters || parsed.args || parsed };
  } catch { /* try next */ }

  // Strategy 3: XML-like tags
  const nameMatchXml = /<name>([\s\S]*?)<\/name>/.exec(text) || /<tool_name>([\s\S]*?)<\/tool_name>/.exec(text) || /<tool>([\s\S]*?)<\/tool>/.exec(text);
  if (nameMatchXml) {
    const argsMatchXml = /<arguments>([\s\S]*?)<\/arguments>/.exec(text) || /<parameters>([\s\S]*?)<\/parameters>/.exec(text);
    let args = {};
    if (argsMatchXml) {
      try { args = JSON.parse(argsMatchXml[1].trim()); } catch { /* ignore */ }
    }
    return { name: nameMatchXml[1].trim(), arguments: args };
  }

  // Strategy 4: extract name + path from a write_workspace_file call
  const nameMatch = /"name"\s*:\s*"([^"]+)"/.exec(text) || /"tool"\s*:\s*"([^"]+)"/.exec(text);
  const pathMatch = /"path"\s*:\s*"([^"]+)"/.exec(text);
  if (nameMatch?.[1] === 'write_workspace_file' && pathMatch) {
    const contentKey = text.indexOf('"content"');
    if (contentKey !== -1) {
      const quoteStart = text.indexOf('"', contentKey + 9);
      if (quoteStart !== -1) {
        const tail = text.lastIndexOf('"}}');
        const content = tail > quoteStart
          ? text.slice(quoteStart + 1, tail)
          : text.slice(quoteStart + 1);
        const unescaped = content.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
        return {
          name: nameMatch[1],
          arguments: { path: pathMatch[1], content: unescaped },
        };
      }
    }
  }

  // Strategy 5: plain tool name
  if (/^[a-zA-Z0-9_]+$/.test(text)) {
    return { name: text, arguments: {} };
  }

  return null;
}

function buildToolArgsPreview(raw: string, maxLen = 500): string {
  const text = raw.trim();
  if (!text) return '(empty)';
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

export function parseToolArguments(
  raw: string,
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string; preview: string } {
  if (!raw.trim()) {
    return { ok: true, value: {} };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        error: 'Tool arguments must be a JSON object.',
        preview: buildToolArgsPreview(raw),
      };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      preview: buildToolArgsPreview(raw),
    };
  }
}

// ── Text-based tool call detection ───────────────────────────────────────────

export function parseTextToolCalls(text: string): Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> {
  const results: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
  let idx = 0;

  // ── 1. Match complete <tool_call>…</tool_call> or <invoke>…</invoke> blocks ──
  const re = /<(?:tool_call|invoke)([^>]*)>([\s\S]*?)<\/(?:tool_call|invoke)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const attrs = m[1];
    const content = m[2].trim();

    let nameFromAttr = '';
    const nameMatch = /name="([^"]+)"/.exec(attrs) || /name='([^']+)'/.exec(attrs);
    if (nameMatch) nameFromAttr = nameMatch[1];

    const raw = safeParseToolCallJson(content);
    const finalName = nameFromAttr || raw?.name;

    if (!finalName) { console.debug('[parseTextToolCalls] skipping unparseable block:', content.slice(0, 80)); continue; }
    const argsStr = typeof raw?.arguments === 'string' ? raw.arguments : JSON.stringify(raw?.arguments ?? {});
    console.debug('[parseTextToolCalls] found (complete):', finalName, 'args length:', argsStr.length);
    results.push({ id: `text-tc-${idx++}`, type: 'function', function: { name: finalName, arguments: argsStr } });
  }

  // ── 2. Detect a truncated (unclosed) block at the end of the text ──
  const lastOpen = Math.max(text.lastIndexOf('<tool_call'), text.lastIndexOf('<invoke'));
  const lastClose = Math.max(text.lastIndexOf('</tool_call>'), text.lastIndexOf('</invoke>'));
  if (lastOpen !== -1 && lastOpen > lastClose) {
    const fragment = text.slice(lastOpen);
    const closeBracket = fragment.indexOf('>');
    if (closeBracket !== -1) {
      const attrs = fragment.slice(0, closeBracket);
      const content = fragment.slice(closeBracket + 1).trim();

      let nameFromAttr = '';
      const nameMatch = /name="([^"]+)"/.exec(attrs) || /name='([^']+)'/.exec(attrs);
      if (nameMatch) nameFromAttr = nameMatch[1];

      const raw = safeParseToolCallJson(content);
      const finalName = nameFromAttr || raw?.name;

      if (finalName) {
        const argsStr = typeof raw?.arguments === 'string' ? raw.arguments : JSON.stringify(raw?.arguments ?? {});
        console.debug('[parseTextToolCalls] found (truncated):', finalName, 'args length:', argsStr.length);
        results.push({ id: `text-tc-${idx++}`, type: 'function', function: { name: finalName, arguments: argsStr } });
      }
    }
  }

  // ── 3. Detect markdown JSON blocks that look like tool calls ──
  if (results.length === 0) {
    const jsonRe = /```(?:json)?\n([\s\S]*?)\n```/g;
    let jsonMatch;
    while ((jsonMatch = jsonRe.exec(text)) !== null) {
      const content = jsonMatch[1].trim();
      const raw = safeParseToolCallJson(content);
      if (raw?.name) {
        const argsStr = typeof raw.arguments === 'string' ? raw.arguments : JSON.stringify(raw.arguments ?? {});
        console.debug('[parseTextToolCalls] found (markdown json):', raw.name, 'args length:', argsStr.length);
        results.push({ id: `text-tc-${idx++}`, type: 'function', function: { name: raw.name, arguments: argsStr } });
      } else {
        try {
          const parsedArr = JSON.parse(content);
          if (Array.isArray(parsedArr)) {
            for (const item of parsedArr) {
              const name = item.name || item.tool || item.tool_name || item.function || item.action;
              if (name) {
                const args = item.arguments || item.parameters || item.args || item;
                const argsStr = typeof args === 'string' ? args : JSON.stringify(args ?? {});
                console.debug('[parseTextToolCalls] found (markdown json array):', name, 'args length:', argsStr.length);
                results.push({ id: `text-tc-${idx++}`, type: 'function', function: { name, arguments: argsStr } });
              }
            }
          }
        } catch { /* ignore */ }
      }
    }
  }

  // ── 4. Detect raw JSON objects or arrays if nothing else matched ──
  if (results.length === 0) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const name = item.name || item.tool || item.tool_name || item.function || item.action;
            if (name) {
              const args = item.arguments || item.parameters || item.args || item;
              const argsStr = typeof args === 'string' ? args : JSON.stringify(args ?? {});
              console.debug('[parseTextToolCalls] found (raw json array):', name, 'args length:', argsStr.length);
              results.push({ id: `text-tc-${idx++}`, type: 'function', function: { name, arguments: argsStr } });
            }
          }
        } else {
          const name = parsed.name || parsed.tool || parsed.tool_name || parsed.function || parsed.action;
          if (name) {
            const args = parsed.arguments || parsed.parameters || parsed.args || parsed;
            const argsStr = typeof args === 'string' ? args : JSON.stringify(args ?? {});
            console.debug('[parseTextToolCalls] found (raw json object):', name, 'args length:', argsStr.length);
            results.push({ id: `text-tc-${idx++}`, type: 'function', function: { name, arguments: argsStr } });
          }
        }
      } catch { /* ignore */ }
    }
  }

  console.debug('[parseTextToolCalls] total found:', results.length);
  return results;
}
