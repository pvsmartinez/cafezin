import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Diagnostic } from '@codemirror/lint';

export interface TsDiagnosticResult {
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
}

const EMPTY: TsDiagnosticResult = { diagnostics: [], errorCount: 0, warningCount: 0 };

function sameDiagnostics(left: Diagnostic[], right: Diagnostic[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index];
    const rightItem = right[index];
    if (
      leftItem.from !== rightItem.from ||
      leftItem.to !== rightItem.to ||
      leftItem.severity !== rightItem.severity ||
      leftItem.message !== rightItem.message
    ) {
      return false;
    }
  }
  return true;
}

function sameDiagnosticResult(left: TsDiagnosticResult, right: TsDiagnosticResult): boolean {
  return (
    left.errorCount === right.errorCount &&
    left.warningCount === right.warningCount &&
    sameDiagnostics(left.diagnostics, right.diagnostics)
  );
}

// Augmented PATH so tsc is found inside Tauri app bundles (limited PATH env)
const PATH_EXPORT =
  'export PATH="/opt/homebrew/bin:/opt/homebrew/opt/node@20/bin:/usr/local/bin:/usr/local/opt/node@20/bin:$PATH"';

// Build the shell command that runs tsc, preferring the local node_modules binary
const TSC_CMD = [
  PATH_EXPORT,
  'TSC="${PWD}/node_modules/.bin/tsc"; [ -x "$TSC" ] || TSC="tsc"',
  '"$TSC" --noEmit --pretty false 2>&1',
].join('; ');

/** Parse `tsc --pretty false` output into CodeMirror Diagnostic objects.
 *  Only returns diagnostics that belong to `activeRelPath`. */
function parseTscOutput(
  output: string,
  activeRelPath: string,
  content: string,
): TsDiagnosticResult {
  const diagnostics: Diagnostic[] = [];
  let errorCount = 0;
  let warningCount = 0;

  const lines = content.split('\n');
  // tsc --pretty false format: path/to/file.ts(line,col): error TS####: message
  const re = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.+)$/gm;
  // Normalise slashes + strip leading "./"
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');
  const activePath = norm(activeRelPath);

  let match: RegExpExecArray | null;
  while ((match = re.exec(output)) !== null) {
    const [, file, lineStr, colStr, severity, , message] = match;
    if (norm(file) !== activePath) continue;

    const lineNum = parseInt(lineStr, 10); // 1-based
    const colNum = parseInt(colStr, 10);   // 1-based

    // Character offset from start of document
    let from = 0;
    for (let i = 0; i < lineNum - 1 && i < lines.length; i++) {
      from += lines[i].length + 1; // +1 for '\n'
    }
    from += colNum - 1;

    // Extend 'to' to the end of the current token (stop at whitespace)
    const lineContent = lines[lineNum - 1] ?? '';
    let tokenEnd = colNum - 1;
    while (tokenEnd < lineContent.length && !/\s/.test(lineContent[tokenEnd])) {
      tokenEnd++;
    }
    const to = from + Math.max(1, tokenEnd - (colNum - 1));

    if (severity === 'error') errorCount++;
    else warningCount++;

    diagnostics.push({
      from,
      to,
      severity: severity as 'error' | 'warning',
      message,
    });
  }

  return { diagnostics, errorCount, warningCount };
}

/**
 * Runs `tsc --noEmit` in the workspace root and returns CodeMirror
 * Diagnostic objects for the currently active file.
 *
 * @param content     Current editor content (used to compute char offsets)
 * @param filePath    Workspace-relative path to the active file (e.g. "src/App.tsx")
 * @param workspacePath  Absolute path to workspace root (tsc runs from here)
 * @param enabled     Should be true only for .ts / .tsx / .js / .jsx files
 */
export function useTsDiagnostics(
  content: string,
  filePath: string | null,
  workspacePath: string | null,
  enabled: boolean,
  dirty: boolean,
): TsDiagnosticResult {
  const [result, setResult] = useState<TsDiagnosticResult>(EMPTY);
  const resultRef = useRef<TsDiagnosticResult>(EMPTY);
  const reqIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep latest content in a ref so the debounced callback reads the freshest value
  const contentRef = useRef(content);
  contentRef.current = content;

  useEffect(() => {
    if (!enabled || dirty || !filePath || !workspacePath) {
      if (!sameDiagnosticResult(resultRef.current, EMPTY)) {
        resultRef.current = EMPTY;
        setResult(EMPTY);
      }
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    const reqId = ++reqIdRef.current;

    timerRef.current = setTimeout(async () => {
      try {
        const res = await invoke<{ stdout: string; stderr: string; exit_code: number }>(
          'shell_run',
          { cmd: TSC_CMD, cwd: workspacePath },
        );
        // Ignore stale results if another run started since this one was queued
        if (reqId !== reqIdRef.current) return;
        const output = res.stdout + (res.stderr ? '\n' + res.stderr : '');
        const nextResult = parseTscOutput(output, filePath, contentRef.current);
        if (sameDiagnosticResult(resultRef.current, nextResult)) return;
        resultRef.current = nextResult;
        setResult(nextResult);
      } catch {
        if (reqId !== reqIdRef.current) return;
        if (sameDiagnosticResult(resultRef.current, EMPTY)) return;
        resultRef.current = EMPTY;
        setResult(EMPTY);
      }
    }, 900);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [dirty, enabled, filePath, workspacePath]);

  return result;
}
