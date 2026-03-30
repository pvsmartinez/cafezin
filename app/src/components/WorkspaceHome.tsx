import React, { useEffect, useState } from 'react';
import { Play, CloudSlash, Plus, FolderSimple, Sparkle, Cloud } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import type { Workspace, AIEditMark, FileTreeNode } from '../types';
import './WorkspaceHome.css';
import { timeAgo } from '../utils/timeAgo';
import { WORKSPACE_TYPES, type WorkspaceType } from '../utils/workspaceTypes';

interface WorkspaceHomeProps {
  workspace: Workspace;
  onOpenFile: (filename: string) => void;
  onCreateFirstFile?: () => void;
  onActivateSync?: () => void;
  onWorkspaceTypeChange?: (type: WorkspaceType) => void;
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

// File-type icon (same logic as Sidebar)
function fileIcon(name: string): React.ReactNode {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['md', 'mdx'].includes(ext)) return '◎';
  if (['ts', 'tsx'].includes(ext)) return 'TS';
  if (['js', 'jsx', 'mjs'].includes(ext)) return 'JS';
  if (['json', 'jsonc'].includes(ext)) return '{}';
  if (['css', 'scss', 'less'].includes(ext)) return '#';
  if (['html', 'htm'].includes(ext)) return '<>';
  if (['rs'].includes(ext)) return '⛭';
  if (['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv', 'avi'].includes(ext)) return <Play weight="thin" size={11} />;
  if (ext === 'gif') return 'GIF';
  if (['png', 'jpg', 'jpeg', 'svg', 'webp', 'bmp', 'ico', 'avif'].includes(ext)) return '⬡';
  if (ext === 'pdf') return '⬡';
  return '·';
}

export default function WorkspaceHome({ workspace, onOpenFile, onCreateFirstFile, onActivateSync, onWorkspaceTypeChange, aiMarks = [], onSwitchWorkspace, onClose }: WorkspaceHomeProps) {
  const { t } = useTranslation();
  const [sync, setSync] = useState<SyncState>({ loading: true, changedCount: 0, error: false });

  useEffect(() => {
    setSync({ loading: true, changedCount: 0, error: false });
    invoke<{ files: string[]; diff: string }>('git_diff', { path: workspace.path })
      .then((r) => setSync({ loading: false, changedCount: r.files.length, error: false }))
      .catch(() => setSync({ loading: false, changedCount: 0, error: true }));
  }, [workspace.path]);

  const { config } = workspace;
  const recentFiles = config.recentFiles ?? [];
  const lastEditedAt = config.lastEditedAt;
  const totalFiles = countFiles(workspace.fileTree);

  // Pick a greeting based on time of day
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? t('wh.goodMorning') :
    hour < 17 ? t('wh.goodAfternoon') :
    t('wh.goodEvening');

  const currentType = workspace.config.workspaceType as WorkspaceType | undefined;
  const currentTypeInfo = WORKSPACE_TYPES.find((wt) => wt.id === currentType);

  return (
    <div className="wh-root">
      {onClose && (
        <button className="wh-close-btn" onClick={onClose} title="Fechar home">✕</button>
      )}
      <div className="wh-content">

        {/* Project name */}
        <div className="wh-greeting">{greeting}</div>
        <h1 className="wh-project-name">{workspace.name}</h1>
        <div className="wh-path">{workspace.path}</div>
        {onSwitchWorkspace && (
          <button className="wh-switch-btn" onClick={onSwitchWorkspace}>
            ⊘ {t('wh.switchWorkspace')}
          </button>
        )}
        {/* Workspace concept callout — only in empty state */}
        {totalFiles === 0 && (
          <div className="wh-concept-callout">
            <span className="wh-concept-callout-icon">📁</span>
            <div>
              <strong>{t('wh.conceptCalloutTitle')}</strong>
              {t('wh.conceptCalloutBody')}
            </div>
          </div>
        )}
        {/* Workspace type selector — only when workspace has files (empty state shows full cards) */}
        {totalFiles > 0 && (
          <div className="wh-type-section">
            <div className="wh-section-label">{t('wh.workspaceType')}</div>
            <div className="wh-type-pills">
              {WORKSPACE_TYPES.map((wt) => (
                <button
                  key={wt.id}
                  className={`wh-type-pill${currentType === wt.id ? ' wh-type-pill--active' : ''}`}
                  onClick={() => onWorkspaceTypeChange?.(wt.id)}
                  title={t(wt.skillsKey)}
                >
                  <span className="wh-type-pill-icon">{wt.icon}</span>
                  <span className="wh-type-pill-label">{t(wt.labelKey)}</span>
                </button>
              ))}
            </div>
            {currentTypeInfo && (
              <div className="wh-type-skills">
                {t('wh.activeSkills')} {t(currentTypeInfo.skillsKey)}
              </div>
            )}
          </div>
        )}

        {/* What is a workspace */}
        <div className="wh-concept">
          <span className="wh-concept-item">
            <FolderSimple weight="thin" size={13} />
            {t('wh.conceptFolder')}
          </span>
          <span className="wh-concept-sep">·</span>
          <span className="wh-concept-item">
            <Sparkle weight="thin" size={13} />
            {t('wh.conceptAgent')}
          </span>
          <span className="wh-concept-sep">·</span>
          <span className="wh-concept-item">
            <Cloud weight="thin" size={13} />
            {t('wh.conceptSync')}
          </span>
        </div>

        {totalFiles === 0 && onCreateFirstFile && (
          <div className="wh-empty-hero">
            <div className="wh-empty-kicker">{t('wh.emptyKicker')}</div>
            <div className="wh-type-cards-empty">
              {WORKSPACE_TYPES.map((wt) => (
                <button
                  key={wt.id}
                  className={`wh-type-card-empty${currentType === wt.id ? ' wh-type-card-empty--active' : ''}`}
                  onClick={() => onWorkspaceTypeChange?.(wt.id)}
                >
                  <span className="wh-type-card-icon">{wt.icon}</span>
                  <span className="wh-type-card-label">{t(wt.labelKey)}</span>
                  <span className="wh-type-card-desc">{t(wt.skillsKey)}</span>
                </button>
              ))}
            </div>
            <p className="wh-empty-coexist">{t('wh.emptyCoexist')}</p>
            <button className="wh-create-first-btn" onClick={onCreateFirstFile}>
              <Plus weight="bold" size={14} />
              <span>{t('wh.createFirstFile')}</span>
            </button>
          </div>
        )}

        {/* Local-only warning — shown when workspace has no git remote */}
        {!workspace.hasGit && (
          <div className="wh-local-banner">
            <CloudSlash weight="thin" size={14} className="wh-local-banner-icon" />
            <div>
            <strong>{t('wh.localBannerTitle')}</strong>
            <span>{t('wh.localBannerDesc')}</span>
            {onActivateSync && (
              <div style={{ marginTop: 8 }}>
                <button className="wh-local-banner-sync-btn" onClick={onActivateSync}>
                  {t('wh.activateSync')}
                </button>
              </div>
            )}
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="wh-stats">
          {/* Last edited */}
          <div className="wh-stat">
            <span className="wh-stat-label">{t('wh.lastEdited')}</span>
            <span className="wh-stat-value">
              {lastEditedAt ? timeAgo(lastEditedAt) : '—'}
            </span>
          </div>

          {/* Sync status */}
          <div className="wh-stat">
            <span className="wh-stat-label">{t('wh.syncStatus')}</span>
            {!workspace.hasGit ? (
              <span className="wh-stat-value wh-sync error">{t('wh.localOnly')}</span>
            ) : (
              <span
                className={`wh-stat-value wh-sync${
                  sync.loading ? ' loading' :
                  sync.error   ? ' error' :
                  sync.changedCount > 0 ? ' dirty' :
                  ' clean'
                }`}
              >
                {sync.loading
                  ? '…'
                  : sync.error
                  ? t('wh.unavailable')
                  : sync.changedCount > 0
                  ? t('wh.syncDirty', { count: sync.changedCount })
                  : t('wh.upToDate')}
              </span>
            )}
          </div>

          {/* File count */}
          <div className="wh-stat">
            <span className="wh-stat-label">{t('wh.files')}</span>
            <span className="wh-stat-value">{totalFiles}</span>
          </div>
        </div>

        {/* Recent files */}
        {recentFiles.length > 0 && (
          <div className="wh-recent">
            <div className="wh-section-label">{t('wh.recentFiles')}</div>
            <div className="wh-file-list">
              {recentFiles.map((file) => (
                <button
                  key={file}
                  className="wh-file-btn"
                  onClick={() => onOpenFile(file)}
                  title={file}
                >
                  <span className="wh-file-icon">{fileIcon(file)}</span>
                  <span className="wh-file-name">{file.split('/').pop()}</span>
                  {file.includes('/') && (
                    <span className="wh-file-dir">{file.split('/').slice(0, -1).join('/')}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Agent context badge */}
        {workspace.agentContext && (
          <div className="wh-agent-note">
            <span className="wh-agent-icon">✦</span>
            {t('wh.agentContextLoaded')}
          </div>
        )}

        {/* AI edits section */}
        {(() => {
          const unreviewed = aiMarks.filter((m) => !m.reviewed);
          if (unreviewed.length === 0) return null;
          const byFile = new Map<string, number>();
          for (const m of unreviewed) {
            byFile.set(m.fileRelPath, (byFile.get(m.fileRelPath) ?? 0) + 1);
          }
          return (
            <div className="wh-ai-section">
              <div className="wh-section-label">
                {t('wh.aiEditsPending')}
                <span className="wh-ai-total">{unreviewed.length}</span>
              </div>
              <div className="wh-ai-file-list">
                {Array.from(byFile.entries()).map(([file, count]) => (
                  <button
                    key={file}
                    className="wh-ai-file-btn"
                    onClick={() => {
                      onOpenFile(file);
                    }}
                    title={file}
                  >
                    <span className="wh-ai-file-icon">✦</span>
                    <span className="wh-ai-file-name">{file.split('/').pop()}</span>
                    <span className="wh-ai-file-dir">
                      {file.split('/').slice(0, -1).join('/') || '/'}
                    </span>
                    <span className="wh-ai-file-count">{count}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
