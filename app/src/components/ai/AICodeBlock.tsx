import { useState } from 'react';
import { Check, Copy } from '@phosphor-icons/react';

// ── Segment parser ────────────────────────────────────────────────────────────
export type MsgSegment =
  | { type: 'text'; content: string }
  | { type: 'code'; lang: string; code: string };

export function parseSegments(raw: string): MsgSegment[] {
  // Create the regex inside the function so each call gets a fresh stateless
  // instance — a module-level /g regex retains lastIndex across calls, which
  // causes skipped matches when parseSegments is called concurrently or rapidly.
  const CODE_BLOCK_RE = /```(\w*)\n?([\s\S]*?)```/g;
  const segments: MsgSegment[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = CODE_BLOCK_RE.exec(raw)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: 'text', content: raw.slice(lastIdx, match.index) });
    }
    segments.push({ type: 'code', lang: match[1] ?? '', code: match[2] ?? '' });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < raw.length) {
    segments.push({ type: 'text', content: raw.slice(lastIdx) });
  }
  return segments;
}

// ── Code block component ──────────────────────────────────────────────────────
interface CodeBlockProps {
  lang: string;
  code: string;
  /** Unused — kept for call-site compatibility (execution was removed). */
  workspacePath?: string;
}

export function CodeBlock({ lang, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="ai-code-block">
      <div className="ai-code-block-header">
        {lang && <span className="ai-code-lang">{lang}</span>}
        <div className="ai-code-actions">
          <button className="ai-code-copy-btn" onClick={() => void handleCopy()}>
            {copied
              ? <><Check weight="bold" size={13} />{' Copied'}</>
              : <><Copy weight="thin" size={13} />{' Copy'}</>}
          </button>
        </div>
      </div>
      <pre className="ai-code-pre"><code>{code}</code></pre>
    </div>
  );
}
