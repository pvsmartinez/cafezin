/**
 * Converts an RTF string to plain text by stripping all control codes.
 *
 * Uses a stack-based parser to correctly skip destination groups
 * ({\fonttbl...}, {\colortbl...}, {\*\...}, {\pict...}, etc.)
 * while preserving paragraph breaks, tabs, and hex-encoded characters.
 */

/** Control words whose groups should be entirely skipped. */
const SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict',
  'object', 'fldinst', 'listtable', 'listoverridetable',
  'rsidtbl', 'themedata', 'colorschememapping', 'datastore',
  'latentstyles', 'generator', 'mmathPr', 'wgrffmtfilter',
  'pgptbl', 'txstyle',
]);

export function rtfToText(rtf: string): string {
  const output: string[] = [];

  // skipStack[i] = true means we're inside a group marked for skipping.
  // Inherits parent state so nested groups are also skipped.
  const skipStack: boolean[] = [false];

  let i = 0;
  const len = rtf.length;

  const isSkipping = () => skipStack[skipStack.length - 1];

  while (i < len) {
    const ch = rtf[i];

    // ── Group open ──────────────────────────────────────────────────────────
    if (ch === '{') {
      // New group inherits parent skip state
      skipStack.push(isSkipping());
      i++;
      continue;
    }

    // ── Group close ─────────────────────────────────────────────────────────
    if (ch === '}') {
      if (skipStack.length > 1) skipStack.pop();
      i++;
      continue;
    }

    // ── Control word / symbol ───────────────────────────────────────────────
    if (ch === '\\') {
      i++;
      if (i >= len) break;

      const next = rtf[i];

      // {\*\destination} — mark current group to skip
      if (next === '*') {
        skipStack[skipStack.length - 1] = true;
        i++;
        continue;
      }

      // \' hex char
      if (next === "'") {
        i++;
        const hex = rtf.slice(i, i + 2);
        i += 2;
        if (!isSkipping()) {
          const code = parseInt(hex, 16);
          if (!isNaN(code)) output.push(String.fromCharCode(code));
        }
        continue;
      }

      // Escaped literal: \{ \} \\
      if (next === '{' || next === '}' || next === '\\') {
        if (!isSkipping()) output.push(next);
        i++;
        continue;
      }

      // \\n / \\r — paragraph mark
      if (next === '\n' || next === '\r') {
        if (!isSkipping()) output.push('\n');
        i++;
        continue;
      }

      // \\- optional hyphen — ignore
      if (next === '-') {
        i++;
        continue;
      }

      // \\~ non-breaking space
      if (next === '~') {
        if (!isSkipping()) output.push('\u00a0');
        i++;
        continue;
      }

      // Read control word: \word[-][digits][ ]
      if (/[a-zA-Z]/.test(next)) {
        let j = i;
        while (j < len && /[a-zA-Z]/.test(rtf[j])) j++;
        const word = rtf.slice(i, j);

        // Skip optional numeric parameter (may be negative)
        if (j < len && rtf[j] === '-') j++;
        while (j < len && /[0-9]/.test(rtf[j])) j++;

        // Consume optional trailing space delimiter (not a line break)
        if (j < len && rtf[j] === ' ') j++;

        i = j;

        // Skip-destination control words mark the current group as hidden
        if (SKIP_DESTINATIONS.has(word)) {
          skipStack[skipStack.length - 1] = true;
          continue;
        }

        if (isSkipping()) continue;

        switch (word) {
          case 'par':
          case 'pard':
            output.push('\n');
            break;
          case 'line':
            output.push('\n');
            break;
          case 'tab':
            output.push('\t');
            break;
          case 'sect':
            output.push('\n\n');
            break;
          case 'page':
            output.push('\n\n');
            break;
          case 'bullet':
            output.push('• ');
            break;
          case 'endash':
            output.push('–');
            break;
          case 'emdash':
            output.push('—');
            break;
          case 'lquote':
            output.push('\u2018');
            break;
          case 'rquote':
            output.push('\u2019');
            break;
          case 'ldblquote':
            output.push('\u201C');
            break;
          case 'rdblquote':
            output.push('\u201D');
            break;
          // All other control words (formatting etc.) — ignore
        }
        continue;
      }

      // Unknown backslash sequence — skip
      i++;
      continue;
    }

    // ── Regular character ───────────────────────────────────────────────────
    if (!isSkipping()) {
      // Skip \r (RTF uses \r\n as line separators between control words)
      if (ch !== '\r') output.push(ch);
    }
    i++;
  }

  return output
    .join('')
    .replace(/\n{3,}/g, '\n\n') // max two consecutive blank lines
    .replace(/[ \t]+\n/g, '\n') // trailing spaces before newlines
    .replace(/\n[ \t]+/g, '\n') // leading spaces after newlines
    .trim();
}
