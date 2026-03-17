import { useState } from 'react';
import { ArrowClockwise, Check, Copy, Play } from '@phosphor-icons/react';
import { invoke } from '@tauri-apps/api/core';

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
const RUNNABLE_LANGS = new Set(['bash', 'sh', 'zsh', 'shell', 'python', 'py']);

interface CodeBlockProps {
  lang: string;
  code: string;
  workspacePath?: string;
}

export function CodeBlock({ lang, code, workspacePath }: CodeBlockProps) {
  const [output, setOutput] = useState<{ stdout: string; stderr: string; exit_code: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  async function runCode() {
    setRunning(true);
    setOutput(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; exit_code: number }>(
        'shell_run',
        { cmd: code, cwd: workspacePath ?? '.' },
      );
      setOutput(result);
    } catch (err) {
      setOutput({ stdout: '', stderr: String(err), exit_code: -1 });
    } finally {
      setRunning(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const canRun = RUNNABLE_LANGS.has(lang.toLowerCase());

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
          {canRun && (
            <button className="ai-code-run-btn" onClick={runCode} disabled={running}>
              {running
                ? <ArrowClockwise weight="thin" size={13} />
                : <><Play weight="thin" size={13} />{' Run'}</>}
            </button>
          )}
        </div>
      </div>
      <pre className="ai-code-pre"><code>{code}</code></pre>
      {output && (
        <div className={`ai-code-output ${output.exit_code !== 0 ? 'ai-code-output--error' : ''}`}>
          {output.stdout && <pre className="ai-code-stdout">{output.stdout}</pre>}
          {output.stderr && <pre className="ai-code-stderr">{output.stderr}</pre>}
          <span className="ai-code-exit">exit {output.exit_code}</span>
        </div>
      )}
    </div>
  );
}
