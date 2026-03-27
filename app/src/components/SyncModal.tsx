import { useEffect, useMemo, useState } from 'react';
import { X, Warning, ArrowsClockwise, CaretDown, CaretRight, ArrowUUpLeft } from '@phosphor-icons/react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import './SyncModal.css';

interface SyncModalProps {
  open: boolean;
  workspacePath: string;
  onConfirm: (message: string) => Promise<void>;
  onClose: () => void;
}

interface DiffResult {
  files: string[];
  diff: string;
  diff_truncated?: boolean;
}

interface Hunk {
  header: string;
  lines: string[];
  patch: string;
}

interface FileDiff {
  filePath: string;
  headerLines: string[];
  hunks: Hunk[];
}

function getFlagTone(flag: string) {
  if (flag === 'M' || flag === 'MM') return 'modified';
  if (flag === 'A' || flag === 'AM') return 'added';
  if (flag === 'D') return 'deleted';
  if (flag === '??') return 'untracked';
  if (flag === 'R') return 'renamed';
  return 'other';
}

function formatHunkCount(count: number) {
  return `${count} ${count === 1 ? 'change' : 'changes'}`;
}

function parseStatusLine(line: string): { flag: string; file: string } {
  return {
    flag: line.slice(0, 2).trim(),
    file: line.slice(3),
  };
}

function parseDiff(raw: string): FileDiff[] {
  const lines = raw.split('\n');
  const files: FileDiff[] = [];
  let currentFile: FileDiff | null = null;
  let currentHunkHeader = '';
  let currentHunkLines: string[] = [];

  const flushHunk = () => {
    if (!currentFile || !currentHunkHeader) return;
    const patch = [...currentFile.headerLines, currentHunkHeader, ...currentHunkLines].join('\n') + '\n';
    currentFile.hunks.push({
      header: currentHunkHeader,
      lines: [...currentHunkLines],
      patch,
    });
    currentHunkHeader = '';
    currentHunkLines = [];
  };

  const flushFile = () => {
    if (!currentFile) return;
    flushHunk();
    files.push(currentFile);
    currentFile = null;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flushFile();
      const match = line.match(/diff --git a\/.+ b\/(.+)$/);
      currentFile = {
        filePath: match ? match[1] : line,
        headerLines: [line],
        hunks: [],
      };
      continue;
    }

    if (!currentFile) continue;

    if (!currentHunkHeader && (line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ '))) {
      currentFile.headerLines.push(line);
      continue;
    }

    if (line.startsWith('@@ ')) {
      flushHunk();
      currentHunkHeader = line;
      continue;
    }

    if (currentHunkHeader) {
      currentHunkLines.push(line);
    }
  }

  flushFile();
  return files;
}

function StatusFlag({ flag }: { flag: string }) {
  const cls =
    flag === 'M' || flag === 'MM' ? 'sm-flag--modified' :
    flag === 'A' || flag === 'AM' ? 'sm-flag--added' :
    flag === 'D' ? 'sm-flag--deleted' :
    flag === '??' ? 'sm-flag--untracked' :
    flag === 'R' ? 'sm-flag--renamed' :
    'sm-flag--other';
  const label =
    flag === 'M' || flag === 'MM' ? 'M' :
    flag === 'A' || flag === 'AM' ? 'A' :
    flag === 'D' ? 'D' :
    flag === '??' ? 'U' :
    flag === 'R' ? 'R' :
    flag;
  return <span className={`sm-flag ${cls}`}>{label}</span>;
}

function classifyDiffLine(line: string) {
  if (line.startsWith('+')) return 'sm-diff-add';
  if (line.startsWith('-')) return 'sm-diff-del';
  return 'sm-diff-ctx';
}

function splitDiffLine(line: string) {
  if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) {
    return { gutter: line[0], text: line.slice(1) || ' ' };
  }
  return { gutter: ' ', text: line || ' ' };
}

function HunkView({
  hunk,
  reverting,
  disabled,
  onRevert,
}: {
  hunk: Hunk;
  reverting: boolean;
  disabled: boolean;
  onRevert: () => void;
}) {
  return (
    <div className="sm-hunk">
      <div className="sm-hunk-header">
        <div className="sm-hunk-header-text">
          <span className="sm-hunk-badge">Hunk</span>
          <span className="sm-hunk-label">{hunk.header}</span>
        </div>
        <button
          type="button"
          className={`sm-inline-revert-btn${reverting ? ' reverting' : ''}`}
          onClick={onRevert}
          disabled={disabled || reverting}
          title="Reverter este trecho"
        >
          <ArrowUUpLeft weight="thin" size={12} />
          <span>{reverting ? 'Reverting…' : 'Revert hunk'}</span>
        </button>
      </div>

      <div className="sm-hunk-lines">
        {hunk.lines.map((line, index) => {
          const { gutter, text } = splitDiffLine(line);
          return (
            <div key={index} className={`sm-diff-line ${classifyDiffLine(line)}`}>
              <span className="sm-diff-gutter">{gutter}</span>
              <span className="sm-diff-text">{text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FileDiffSection({
  flag,
  fileDiff,
  syncing,
  revertingFile,
  workspacePath,
  onRevertFile,
  onRefresh,
  onError,
}: {
  flag: string;
  fileDiff: FileDiff;
  syncing: boolean;
  revertingFile: boolean;
  workspacePath: string;
  onRevertFile: (file: string) => void;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(() => fileDiff.hunks.length <= 1);
  const [revertingHunks, setRevertingHunks] = useState<Set<number>>(new Set());

  useEffect(() => {
    setExpanded(fileDiff.hunks.length <= 1);
  }, [fileDiff.filePath, fileDiff.hunks.length]);

  async function handleRevertHunk(hunk: Hunk, index: number) {
    setRevertingHunks((prev) => new Set(prev).add(index));
    try {
      await invoke('git_apply_patch', { path: workspacePath, patch: hunk.patch });
      onRefresh();
    } catch (error) {
      onError(`Revert failed: ${String(error)}`);
    } finally {
      setRevertingHunks((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
  }

  return (
    <section className="sm-file-diff" data-flag={getFlagTone(flag)}>
      <div className="sm-file-diff-header">
        <button
          type="button"
          className="sm-file-diff-toggle"
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="sm-file-diff-caret">
            {expanded ? <CaretDown weight="thin" size={12} /> : <CaretRight weight="thin" size={12} />}
          </span>
          <StatusFlag flag={flag} />
          <span className="sm-file-diff-name">{fileDiff.filePath}</span>
          <span className="sm-hunk-count">{formatHunkCount(fileDiff.hunks.length)}</span>
        </button>

        <button
          type="button"
          className={`sm-file-revert-btn${revertingFile ? ' reverting' : ''}`}
          onClick={() => onRevertFile(fileDiff.filePath)}
          disabled={syncing || revertingFile}
          title="Reverter arquivo inteiro"
        >
          <ArrowUUpLeft weight="thin" size={13} />
          <span>{revertingFile ? 'Reverting…' : 'Revert file'}</span>
        </button>
      </div>

      {expanded && (
        <div className="sm-hunks">
          {fileDiff.hunks.length > 0 ? (
            fileDiff.hunks.map((hunk, index) => (
              <HunkView
                key={`${fileDiff.filePath}-${index}`}
                hunk={hunk}
                reverting={revertingHunks.has(index)}
                disabled={syncing || revertingFile}
                onRevert={() => void handleRevertHunk(hunk, index)}
              />
            ))
          ) : (
            <div className="sm-no-hunks">Nenhum trecho parseado para este arquivo.</div>
          )}
        </div>
      )}
    </section>
  );
}

export default function SyncModal({ open, workspacePath, onConfirm, onClose }: SyncModalProps) {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiffResult | null>(null);
  const [fileDiffs, setFileDiffs] = useState<FileDiff[]>([]);
  const [commitMsg, setCommitMsg] = useState('');
  const [revertingFiles, setRevertingFiles] = useState<Set<string>>(new Set());

  const fileDiffByPath = useMemo(
    () => new Map(fileDiffs.map((fileDiff) => [fileDiff.filePath, fileDiff])),
    [fileDiffs],
  );

  function fetchDiff() {
    setResult(null);
    setFileDiffs([]);
    setError(null);
    setLoading(true);
    invoke<DiffResult>('git_diff', { path: workspacePath })
      .then((next) => {
        setResult(next);
        setFileDiffs(parseDiff(next.diff));
      })
      .catch((nextError) => setError(String(nextError)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!open) return;
    setSyncing(false);
    setRevertingFiles(new Set());
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    setCommitMsg(`sync: ${timestamp}`);
    fetchDiff();
  }, [open, workspacePath]);

  async function handleRevertFile(file: string) {
    setRevertingFiles((prev) => new Set(prev).add(file));
    try {
      await invoke('git_checkout_file', { path: workspacePath, file });
      fetchDiff();
    } catch (nextError) {
      setError(`Revert failed: ${String(nextError)}`);
    } finally {
      setRevertingFiles((prev) => {
        const next = new Set(prev);
        next.delete(file);
        return next;
      });
    }
  }

  async function handleConfirm() {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    try {
      await onConfirm(commitMsg || `sync: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
      onClose();
    } catch (nextError) {
      setError(String(nextError));
      setSyncing(false);
    }
  }

  if (!open) return null;

  const hasChanges = (result?.files.length ?? 0) > 0;

  return createPortal(
    <div className="sm-overlay" onClick={(event) => { if (event.target === event.currentTarget && !syncing) onClose(); }}>
      <div className="sm-modal">
        <div className="sm-header">
          <span className="sm-title">
            <ArrowsClockwise weight="thin" size={14} />
            Sync changes
            {result && (
              <span className="sm-file-count">
                {result.files.length} file{result.files.length !== 1 ? 's' : ''}
              </span>
            )}
            {result?.diff_truncated && (
              <span className="sm-diff-truncated-badge" title="Diff maior que 100 KB; exibindo só o início">
                truncated
              </span>
            )}
          </span>
          <button type="button" className="sm-close" onClick={onClose} disabled={syncing}>
            <X weight="thin" size={14} />
          </button>
        </div>

        <div className="sm-body">
          {loading && <div className="sm-loading">Fetching changes…</div>}

          {!loading && error && (
            <div className="sm-error">
              <Warning weight="thin" size={14} />
              {error}
            </div>
          )}

          {!loading && result && (
            result.files.length === 0 ? (
              <div className="sm-empty">Nothing to sync — working tree is clean.</div>
            ) : (
              <div className="sm-file-list">
                <div className="sm-section-label">Changed files</div>
                {result.files.map((line, index) => {
                  const { flag, file } = parseStatusLine(line);
                  const fileDiff = fileDiffByPath.get(file);
                  const revertingFile = revertingFiles.has(file);

                  if (!fileDiff) {
                    return (
                      <section key={`${file}-${index}`} className="sm-file-diff" data-flag={getFlagTone(flag)}>
                        <div className="sm-file-diff-header">
                          <div className="sm-file-diff-toggle sm-file-diff-toggle--inert">
                            <span className="sm-file-diff-caret" />
                            <StatusFlag flag={flag} />
                            <span className="sm-file-diff-name">{file}</span>
                            <span className="sm-hunk-count sm-hunk-count--muted">No parsed diff</span>
                          </div>
                          {flag !== '??' && (
                            <button
                              type="button"
                              className={`sm-file-revert-btn${revertingFile ? ' reverting' : ''}`}
                              onClick={() => void handleRevertFile(file)}
                              disabled={syncing || revertingFile}
                              title="Reverter arquivo inteiro"
                            >
                              <ArrowUUpLeft weight="thin" size={13} />
                              <span>{revertingFile ? 'Reverting…' : 'Revert file'}</span>
                            </button>
                          )}
                        </div>
                      </section>
                    );
                  }

                  return (
                    <FileDiffSection
                      key={`${file}-${index}`}
                      flag={flag}
                      fileDiff={fileDiff}
                      syncing={syncing}
                      revertingFile={revertingFile}
                      workspacePath={workspacePath}
                      onRevertFile={(targetFile) => void handleRevertFile(targetFile)}
                      onRefresh={fetchDiff}
                      onError={setError}
                    />
                  );
                })}
              </div>
            )
          )}
        </div>

        <div className="sm-footer">
          <input
            className="sm-commit-input"
            value={commitMsg}
            onChange={(event) => setCommitMsg(event.target.value)}
            placeholder="Commit message…"
            disabled={syncing}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && hasChanges) {
                void handleConfirm();
              }
            }}
          />

          <div className="sm-footer-actions">
            <button type="button" className="sm-btn sm-btn-cancel" onClick={onClose} disabled={syncing}>
              Cancel
            </button>
            <button
              type="button"
              className={`sm-btn sm-btn-confirm${syncing ? ' syncing' : ''}`}
              onClick={() => void handleConfirm()}
              disabled={syncing || loading}
            >
              <ArrowsClockwise weight="thin" size={13} />
              {syncing ? 'Syncing…' : hasChanges ? 'Commit & push' : 'Push'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
