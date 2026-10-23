import { useEffect, useState } from 'react';
import { ArrowRight, Plus, Sparkle, X } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import type { Workspace, AIEditMark, FileTreeNode } from '../types';
import { displayFileName } from '../utils/fileType';
import { extractTitle } from '../utils/manuscript';
import { readFile } from '../services/workspace';
import './WorkspaceHome.css';

interface WorkspaceHomeProps {
  workspace: Workspace;
  onOpenFile: (filename: string) => void;
  onCreateFirstFile?: () => void;
  onActivateSync?: () => void;
  aiMarks?: AIEditMark[];
  onOpenAIReview?: () => void;
  onSwitchWorkspace?: () => void;
  onClose?: () => void;
}

interface SyncState {
  loading: boolean;
  changedCount: number;
  error: boolean;
}

// Count all non-directory nodes in the file tree
function countFiles(nodes: FileTreeNode[]): number {
  return nodes.reduce((sum, n) => sum + (n.isDirectory ? countFiles(n.children ?? []) : 1), 0);
}

function relativeTime(iso: string, locale: string): string {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}

function fileLabel(path: string): string {
  return displayFileName(path.split('/').pop() ?? path);
}

export default function WorkspaceHome({
  workspace,
  onOpenFile,
  onCreateFirstFile,
  onActivateSync,
  aiMarks = [],
  onOpenAIReview,
  onSwitchWorkspace,
  onClose,
}: WorkspaceHomeProps) {
  const { t, i18n } = useTranslation();
  const [sync, setSync] = useState<SyncState>({ loading: true, changedCount: 0, error: false });

  useEffect(() => {
    setSync({ loading: true, changedCount: 0, error: false });
    invoke<{ files: string[]; diff: string }>('git_diff', { path: workspace.path })
      .then((r) => setSync({ loading: false, changedCount: r.files.length, error: false }))
      .catch(() => setSync({ loading: false, changedCount: 0, error: true }));
  }, [workspace.path]);

  // Auto-open getting-started.md when workspace is brand new (no files opened yet)
  useEffect(() => {
    const hasGettingStarted = workspace.fileTree.some(n => !n.isDirectory && n.name === 'getting-started.md');
    if (hasGettingStarted && (workspace.config.recentFiles ?? []).length === 0) {
      onOpenFile('getting-started.md');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.path]);

  const { config } = workspace;
  const recentFiles = config.recentFiles ?? [];
  const [titles, setTitles] = useState<Record<string, string>>({});
  const recentKey = recentFiles.join('\n');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const file of recentKey ? recentKey.split('\n') : []) {
        try {
          const title = extractTitle(await readFile(workspace, file));
          if (title) next[file] = title;
        } catch { /* missing file: keep its name */ }
      }
      if (!cancelled) setTitles(next);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.path, recentKey]);
  const label = (file: string) => titles[file] ?? fileLabel(file);
  const lastFile = recentFiles[0];
  const totalFiles = countFiles(workspace.fileTree);
  const unreviewed = aiMarks.filter((m) => !m.reviewed);
  const unreviewedFiles = new Set(unreviewed.map((m) => m.fileRelPath)).size;

  const syncLabel = !workspace.hasGit
    ? null
    : sync.loading || sync.error
      ? null
      : sync.changedCount > 0
        ? t('wh.syncDirty', { count: sync.changedCount })
        : t('wh.upToDate');

  return (
    <div className="wh-root">
      {onClose && (
        <button className="wh-close-btn" onClick={onClose} title={t('wh.closeHome')}>
          <X size={14} />
        </button>
      )}
      <div className="wh-content">
        <h1 className="wh-project-name">{config.name || workspace.name}</h1>
        <div className="wh-meta">
          <span>{t('wh.textCount', { count: totalFiles })}</span>
          {config.lastEditedAt && (
            <span>{t('wh.editedAgo', { when: relativeTime(config.lastEditedAt, i18n.language) })}</span>
          )}
          {syncLabel && <span>{syncLabel}</span>}
          {!workspace.hasGit && (
            <span>
              {t('wh.localOnlyShort')}
              {onActivateSync && (
                <>
                  {' · '}
                  <button className="wh-link" onClick={onActivateSync}>{t('wh.activateBackup')}</button>
                </>
              )}
            </span>
          )}
        </div>

        <div className="wh-actions">
          {lastFile ? (
            <button className="wh-primary" onClick={() => onOpenFile(lastFile)} title={lastFile}>
              <span className="wh-primary-kicker">{t('wh.continueWriting')}</span>
              <span className="wh-primary-title">{label(lastFile)}</span>
              <ArrowRight size={18} className="wh-primary-arrow" />
            </button>
          ) : null}
          <div className="wh-secondary-actions">
            {onCreateFirstFile && (
              <button className="wh-secondary" onClick={onCreateFirstFile}>
                <Plus size={14} /> {t('wh.newText')}
              </button>
            )}
            <button
              className="wh-secondary"
              onClick={() => window.dispatchEvent(new CustomEvent('cafezin:open-ai'))}
            >
              <Sparkle size={14} /> {t('wh.askAgent')}
            </button>
          </div>
        </div>

        {unreviewed.length > 0 && (
          <div className="wh-review">
            <Sparkle weight="fill" size={14} className="wh-review-icon" />
            <span className="wh-review-text">
              {t('wh.aiEditsSummary', { count: unreviewed.length, files: unreviewedFiles })}
            </span>
            {onOpenAIReview && (
              <button className="wh-review-btn" onClick={onOpenAIReview}>{t('wh.reviewNow')}</button>
            )}
          </div>
        )}

        {recentFiles.length > 1 && (
          <section className="wh-recent">
            <div className="wh-section-label">{t('wh.recentFiles')}</div>
            <div className="wh-file-list">
              {recentFiles.slice(1).map((file) => (
                <button key={file} className="wh-file-btn" onClick={() => onOpenFile(file)} title={file}>
                  <span className="wh-file-name">{label(file)}</span>
                  {file.includes('/') && (
                    <span className="wh-file-dir">{file.split('/').slice(0, -1).join('/')}</span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {onSwitchWorkspace && (
          <button className="wh-link wh-switch" onClick={onSwitchWorkspace}>
            {t('wh.switchWorkspace')}
          </button>
        )}
      </div>
    </div>
  );
}
