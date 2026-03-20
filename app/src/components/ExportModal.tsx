/**
 * ExportModal — workspace Build / Export settings.
 *
 * Inspired by Unity's Build Settings:  define named targets, configure them,
 * run one or all.  Config is persisted in <workspace>/.cafezin/config.json
 * via the saveWorkspaceConfig service.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { X, Plus, Play, Trash, CaretDown, CaretUp, CheckCircle, WarningCircle, CircleNotch, FolderOpen, CloudArrowUp, Sparkle } from '@phosphor-icons/react';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import { runExportTarget, listAllFiles, resolveFiles, ExportCancelledError, type ExportProgressInfo, type ExportResult } from '../utils/exportWorkspace';
import { deployToVercel, resolveVercelToken } from '../services/publishVercel';
import { saveWorkspaceConfig } from '../services/workspace';
import {
  CUSTOM_EXPORT_INJECTION_SPEC,
  CUSTOM_EXPORT_PROTOCOL,
  getCustomExportConfig,
  normalizeExportTarget,
  normalizeWorkspaceExportConfig,
  type CustomExportExecutionMode,
  type Workspace,
  type ExportTarget,
  type ExportFormat,
  type WorkspaceExportConfig,
} from '../types';
import type { Editor } from 'tldraw';
import { SK } from '../services/storageKeys';
import './ExportModal.css';

// ── Helpers ────────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 9); }

const DEFAULT_GIT_PUBLISH = {
  commitMessage: 'Publish from Cafezin — {{datetime}}',
  remote: 'origin',
  branch: '',
  skipCommitWhenNoChanges: true,
} as const;

const FORMAT_LABELS: Record<ExportFormat, string> = {
  'pdf':        'Markdown → PDF',
  'canvas-png': 'Canvas → PNG',
  'canvas-pdf': 'Canvas → PDF (slides)',
  'zip':        'Zip bundle',
  'git-publish':'Git publish',
  'custom':     'Custom command',
};

const FORMAT_BADGE_COLOR: Record<ExportFormat, string> = {
  'pdf':        'red',
  'canvas-png': 'blue',
  'canvas-pdf': 'purple',
  'zip':        'orange',
  'git-publish':'blue',
  'custom':     'grey',
};

const DEFAULT_TARGET: Omit<ExportTarget, 'id' | 'name'> = {
  include: ['md'],
  format: 'pdf',
  outputDir: 'dist',
  enabled: true,
};

const FORMAT_DEFAULTS: Record<ExportFormat, { include: string[]; outputDir: string }> = {
  'pdf':         { include: ['md', 'mdx'],          outputDir: 'dist' },
  'canvas-png':  { include: ['tldr.json'],          outputDir: 'dist' },
  'canvas-pdf':  { include: ['tldr.json'],          outputDir: 'dist' },
  'zip':         { include: ['html', 'css', 'js'],  outputDir: 'dist' },
  'git-publish': { include: [],                     outputDir: '.' },
  'custom':      { include: [],                     outputDir: 'dist' },
};

type RunStatus = 'idle' | 'running' | 'done' | 'error' | 'canceled';

interface TargetStatus {
  status: RunStatus;
  result?: ExportResult;
  progress?: ExportProgressInfo;
  startedAt?: number;
  updatedAt?: number;
  finishedAt?: number;
  cancelRequested?: boolean;
}

type PublishStatus = 'idle' | 'deploying' | 'done' | 'error';

interface TargetPublishStatus {
  status: PublishStatus;
  url?: string;
  error?: string;
}

// ── Component ──────────────────────────────────────────────────────────────────

interface ExportModalProps {
  workspace: Workspace;
  onWorkspaceChange: (ws: Workspace) => void;
  canvasEditorRef: React.RefObject<Editor | null>;
  activeCanvasRel?: string | null;
  /** Called before exporting a canvas: switches to that file and waits for editor mount */
  onOpenFileForExport: (relPath: string) => Promise<void>;
  /** Called after each canvas export to restore the previous tab */
  onRestoreAfterExport: () => void;
  onClose: () => void;
  /** Called when the user wants to open AI with a pre-filled prompt */
  onOpenAI?: (prompt: string) => void;
  onExportLockStateChange?: (state: { title: string; detail?: string; cancelRequested?: boolean } | null) => void;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

function describeProgress(progress?: ExportProgressInfo): string {
  if (!progress) return 'Preparing export…';
  return progress.detail ?? progress.label;
}

function splitProgressDetail(progress?: ExportProgressInfo): { summary: string; log?: string } {
  const detail = describeProgress(progress);
  const marker = ' Last output: ';
  const index = detail.indexOf(marker);
  if (index === -1) return { summary: detail };
  return {
    summary: detail.slice(0, index),
    log: detail.slice(index + marker.length),
  };
}

function getSlowExportHint(target: ExportTarget): string {
  if (target.format === 'custom') {
    return 'Taking longer than usual. Custom commands can be slow when the script processes many files or emits a lot of logs.';
  }
  if (target.format === 'pdf') {
    return 'Taking longer than usual. Large documents, many pages or heavy Markdown rendering can do this.';
  }
  if (target.format === 'zip') {
    return 'Taking longer than usual. Large bundles or many matched files can do this.';
  }
  return 'Taking longer than usual. Large canvases, many pages or broad include rules can do this.';
}

export default function ExportModal({
  workspace,
  onWorkspaceChange,
  canvasEditorRef,
  activeCanvasRel,
  onOpenFileForExport,
  onRestoreAfterExport,
  onClose,
  onOpenAI,
  onExportLockStateChange,
}: ExportModalProps) {
  const savedConfig = normalizeWorkspaceExportConfig(workspace.config.exportConfig);
  const [targets, setTargets] = useState<ExportTarget[]>(savedConfig?.targets ?? []);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Map<string, TargetStatus>>(new Map());
  const [publishStatuses, setPublishStatuses] = useState<Map<string, TargetPublishStatus>>(new Map());
  // Async file-count per target: targetId → number
  const [fileCounts, setFileCounts] = useState<Map<string, number>>(new Map());
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [closeRequested, setCloseRequested] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [aiHelperDismissed, setAiHelperDismissed] = useState(
    () => localStorage.getItem(SK.EXPORT_MODAL_AI_HELPER) === '1',
  );
  const cancelControllersRef = useRef(new Map<string, { cancelled: boolean }>());

  function getAIPrompt(): string {
    if (targets.length === 0) {
      return 'Estou abrindo as configurações de Export do Cafezin pela primeira vez. Pode me ajudar a entender quais targets de export fazem sentido criar para o meu workspace?';
    }
    const expanded = targets.find((t) => t.id === expandedId);
    const ref = expanded ?? targets[0];
    const prompts: Record<ExportFormat, string> = {
      'pdf': `Estou configurando um target de export "${ref.name}" (Markdown → PDF) no Cafezin. Como posso configurar os campos Include, Output dir e Custom command para produzir um PDF bem formatado?`,
      'canvas-png': `Estou configurando um target de export de canvas para PNG no Cafezin. Como funciona o export de arquivos .tldr.json? Quais dicas você tem para este formato?`,
      'canvas-pdf': `Estou configurando um target de export de canvas para PDF (slides) no Cafezin. Como funcionam os slides no tldraw e como otimizar este export?`,
      'zip': `Estou configurando um target de export tipo Zip bundle no Cafezin. Que tipos de arquivo fazem sentido incluir? Como usar o custom command para processar o bundle?`,
      'git-publish': `Estou configurando um target de Git publish no Cafezin. Como funciona? O que preciso no repositório para isso funcionar?`,
      'custom': `Estou configurando um target de Custom command no Cafezin. Quais variáveis e placeholders estão disponíveis no comando? Como testar antes de rodar?`,
    };
    return prompts[ref.format] ?? prompts['custom'];
  }

  // ── Async file-count preview ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const allFiles = await listAllFiles(workspace.path);
        if (cancelled) return;
        const counts = new Map<string, number>();
        for (const t of targets) {
          if (t.format === 'git-publish') continue;
          counts.set(t.id, resolveFiles(allFiles, t).length);
        }
        setFileCounts(counts);
      } catch { /* best-effort */ }
    }
    refresh();
    return () => { cancelled = true; };
  // Depend only on the file-selection fields that affect which files are matched
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(targets.map(t => ({ id: t.id, format: t.format, include: t.include, includeFiles: t.includeFiles, excludeFiles: t.excludeFiles })))]);

  useEffect(() => {
    const hasRunning = Array.from(statuses.values()).some((status) => status.status === 'running');
    if (!hasRunning) return undefined;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [statuses]);

  useEffect(() => {
    if (!closeRequested) return;
    const hasRunning = Array.from(statuses.values()).some((status) => status.status === 'running');
    if (hasRunning) return;
    setCloseRequested(false);
    onClose();
  }, [closeRequested, onClose, statuses]);

  useEffect(() => () => {
    cancelControllersRef.current.forEach((controller) => {
      controller.cancelled = true;
    });
    cancelControllersRef.current.clear();
  }, []);

  useEffect(() => {
    const canvasRun = targets.find((target) => {
      if (target.format !== 'canvas-png' && target.format !== 'canvas-pdf') return false;
      return statuses.get(target.id)?.status === 'running';
    });
    if (!canvasRun) {
      onExportLockStateChange?.(null);
      return;
    }
    const status = statuses.get(canvasRun.id);
    onExportLockStateChange?.({
      title: `Exporting ${canvasRun.name}`,
      detail: describeProgress(status?.progress),
      cancelRequested: status?.cancelRequested,
    });
  }, [onExportLockStateChange, statuses, targets]);

  // ── Persist helpers ─────────────────────────────────────────────────────────
  const persist = useCallback(async (nextTargets: ExportTarget[]) => {
    const exportConfig: WorkspaceExportConfig = {
      targets: nextTargets.map(normalizeExportTarget),
    };
    const updated: Workspace = {
      ...workspace,
      config: { ...workspace.config, exportConfig },
    };
    onWorkspaceChange(updated);
    await saveWorkspaceConfig(updated);
  }, [workspace, onWorkspaceChange]);

  const updateTargets = useCallback((next: ExportTarget[]) => {
    setTargets(next);
    persist(next);
  }, [persist]);

  // ── CRUD ─────────────────────────────────────────────────────────────────────
  function addTarget() {
    const id = uid();
    const n: ExportTarget = normalizeExportTarget({ id, name: 'New target', ...DEFAULT_TARGET });
    const next = [...targets, n];
    setTargets(next);
    setExpandedId(id);
    persist(next); // use derived `next`, not stale `targets` closure
  }

  function addGitPublishTarget() {
    const id = uid();
    const n: ExportTarget = {
      id,
      name: 'Git Publish',
      description: 'Stage all changes, create a commit when needed, and push so Git-based deploys run automatically.',
      include: [],
      format: 'git-publish',
      outputDir: '.',
      gitPublish: { ...DEFAULT_GIT_PUBLISH },
      enabled: true,
    };
    const next = [...targets, normalizeExportTarget(n)];
    setTargets(next);
    setExpandedId(id);
    persist(next);
  }

  function deleteTarget(id: string) {
    const next = targets.filter((t) => t.id !== id);
    updateTargets(next);
    if (expandedId === id) setExpandedId(null);
  }

  function updateTarget(id: string, patch: Partial<ExportTarget>) {
    const next = targets.map((t) => t.id === id ? normalizeExportTarget({ ...t, ...patch }) : t);
    updateTargets(next);
  }

  // ── Run ───────────────────────────────────────────────────────────────────────
  function setStatus(id: string, s: TargetStatus) {
    setStatuses((prev) => new Map(prev).set(id, s));
  }

  function requestCancel(targetId: string) {
    const controller = cancelControllersRef.current.get(targetId);
    if (!controller) return;
    controller.cancelled = true;
    setStatuses((prev) => {
      const current = prev.get(targetId);
      if (!current) return prev;
      return new Map(prev).set(targetId, {
        ...current,
        cancelRequested: true,
        updatedAt: Date.now(),
      });
    });
  }

  function handleRequestClose() {
    const runningIds = Array.from(statuses.entries())
      .filter(([, status]) => status.status === 'running')
      .map(([id]) => id);
    if (runningIds.length === 0) {
      onClose();
      return;
    }
    setCloseRequested(true);
    runningIds.forEach((id) => requestCancel(id));
  }

  async function runTarget(target: ExportTarget): Promise<'done' | 'canceled' | 'error'> {
    const controller = { cancelled: false };
    cancelControllersRef.current.set(target.id, controller);
    const startedAt = Date.now();
    setStatus(target.id, {
      status: 'running',
      startedAt,
      updatedAt: startedAt,
      progress: {
        done: 0,
        total: 1,
        label: target.name,
        phase: 'queued',
        detail: 'Preparing export…',
      },
    });
    try {
      const result = await runExportTarget({
        workspacePath: workspace.path,
        workspaceConfig: workspace.config,
        target,
        canvasEditorRef: canvasEditorRef,
        activeCanvasRel,
        onOpenFileForExport,
        onRestoreAfterExport,
        shouldCancel: () => controller.cancelled,
        onProgress: (progress) => {
          setStatus(target.id, {
            status: 'running',
            progress,
            startedAt,
            updatedAt: Date.now(),
            cancelRequested: controller.cancelled,
          });
        },
      });
      setStatus(target.id, {
        status: result.errors.length > 0 ? 'error' : 'done',
        result,
        progress: {
          done: Math.max(1, result.outputs.length || 1),
          total: Math.max(1, result.outputs.length || 1),
          label: target.name,
          phase: 'finished',
          detail: result.errors.length > 0 ? 'Finished with issues.' : 'Finished successfully.',
        },
        startedAt,
        updatedAt: Date.now(),
        finishedAt: Date.now(),
      });
      return result.errors.length > 0 ? 'error' : 'done';
    } catch (e) {
      const isCanceled = e instanceof ExportCancelledError || String(e).includes('Export canceled by user.');
      setStatus(target.id, {
        status: isCanceled ? 'canceled' : 'error',
        result: {
          targetId: target.id,
          outputs: [],
          errors: isCanceled ? [] : [String(e)],
          summary: isCanceled ? 'Export canceled by user.' : undefined,
          elapsed: Date.now() - startedAt,
        },
        progress: {
          done: 0,
          total: 1,
          label: target.name,
          phase: isCanceled ? 'canceled' : 'error',
          detail: isCanceled ? 'Stopping after the last safe checkpoint.' : 'Export failed.',
        },
        startedAt,
        updatedAt: Date.now(),
        finishedAt: Date.now(),
        cancelRequested: controller.cancelled,
      });
      return isCanceled ? 'canceled' : 'error';
    } finally {
      cancelControllersRef.current.delete(target.id);
    }
  }

  async function runAll() {
    if (isRunningAll) return;
    setIsRunningAll(true);
    try {
      for (const t of targets.filter((t) => t.enabled)) {
        const outcome = await runTarget(t);
        if (outcome === 'canceled') break;
      }
    } finally {
      setIsRunningAll(false);
    }
  }

  async function handlePublish(target: ExportTarget) {
    const token = resolveVercelToken(workspace.config.vercelConfig?.token);
    if (!token) {
      setPublishStatuses((prev) => new Map(prev).set(target.id, {
        status: 'error',
        error: 'Token Vercel não configurado. Acesse Settings → API Keys.',
      }));
      return;
    }
    if (!target.vercelPublish?.projectName) {
      setPublishStatuses((prev) => new Map(prev).set(target.id, {
        status: 'error',
        error: 'Nome do projeto Vercel não configurado neste target.',
      }));
      return;
    }
    setPublishStatuses((prev) => new Map(prev).set(target.id, { status: 'deploying' }));
    try {
      const result = await deployToVercel({
        token,
        projectName: target.vercelPublish.projectName,
        teamId: workspace.config.vercelConfig?.teamId,
        dirPath: `${workspace.path}/${target.outputDir}`,
      });
      setPublishStatuses((prev) => new Map(prev).set(target.id, {
        status: 'done',
        url: result.url,
      }));
    } catch (e) {
      setPublishStatuses((prev) => new Map(prev).set(target.id, {
        status: 'error',
        error: String(e),
      }));
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  const enabledCount = targets.filter((t) => t.enabled).length;

  return (
    <div className="em-backdrop" onClick={(e) => { if (e.target === e.currentTarget) handleRequestClose(); }}>
      <div className="em-modal">

        {/* Header */}
        <div className="em-header">
          <span className="em-title">Export / Build Settings</span>
          <button className="em-close" onClick={handleRequestClose} title={closeRequested ? 'Stopping exports before closing' : 'Close'}><X weight="bold" /></button>
        </div>

        {/* Target list */}
        <div className="em-body">
          {targets.length === 0 && (
            <div className="em-empty">
              No export targets yet. Add one below to define what your workspace produces.
            </div>
          )}

          {targets.map((target) => {
            const s = statuses.get(target.id);
            const customConfig = getCustomExportConfig(target);
            const isExpanded = expandedId === target.id;
            const gitPublish = { ...DEFAULT_GIT_PUBLISH, ...(target.gitPublish ?? {}) };
            const targetOutLabel = target.format === 'git-publish'
              ? (gitPublish.branch?.trim() ? `${gitPublish.remote?.trim() || 'origin'}/${gitPublish.branch.trim()}` : `${gitPublish.remote?.trim() || 'origin'} push`)
              : `${target.outputDir}/`;
            const elapsedMs = s?.startedAt
              ? ((s.status === 'running' ? clockNow : (s.finishedAt ?? clockNow)) - s.startedAt)
              : 0;
            const staleMs = s?.updatedAt ? clockNow - s.updatedAt : 0;
            const isSlow = s?.status === 'running' && elapsedMs > 15_000;
            const isStalled = s?.status === 'running' && staleMs > 10_000;
            const progressPercent = s?.progress
              ? Math.max(3, Math.min(100, Math.round((s.progress.done / Math.max(1, s.progress.total)) * 100)))
              : 0;
            const progressText = splitProgressDetail(s?.progress);

            return (
              <div key={target.id} className={`em-target${isExpanded ? ' expanded' : ''}`}>
                {/* Row */}
                <div className="em-target-row">
                  <input
                    type="checkbox"
                    className="em-checkbox"
                    checked={target.enabled}
                    onChange={(e) => updateTarget(target.id, { enabled: e.target.checked })}
                    title="Enable this target in Export All"
                  />
                  <span
                    className="em-target-name"
                    onDoubleClick={() => {
                      const n = prompt('Rename target:', target.name);
                      if (n?.trim()) updateTarget(target.id, { name: n.trim() });
                    }}
                    title="Double-click to rename"
                  >
                    {target.name}
                  </span>
                  <span className={`em-badge em-badge--${FORMAT_BADGE_COLOR[target.format]}`}>
                    {FORMAT_LABELS[target.format]}
                  </span>
                  <span className="em-target-out" title={target.format === 'git-publish' ? 'Git destination' : 'Output directory'}>{targetOutLabel}</span>
                  {target.format !== 'git-publish' && fileCounts.has(target.id) && (
                    <span className="em-file-count" title="Files matched by this target">
                      {fileCounts.get(target.id)} file{fileCounts.get(target.id) !== 1 ? 's' : ''}
                    </span>
                  )}

                  <StatusChip status={s} />

                  <button
                    className={`em-run-btn${s?.status === 'running' ? ' em-run-btn--cancel' : ''}`}
                    onClick={() => {
                      if (s?.status === 'running') requestCancel(target.id);
                      else void runTarget(target);
                    }}
                    title={s?.status === 'running' ? 'Cancel this export' : 'Run this target'}
                  >
                    {s?.status === 'running'
                      ? <CircleNotch className="em-spin" />
                      : <Play weight="fill" />
                    }
                    {s?.status === 'running' ? (s.cancelRequested ? 'Stopping…' : 'Cancel') : 'Run'}
                  </button>

                  <button
                    className="em-icon-btn"
                    onClick={() => setExpandedId(isExpanded ? null : target.id)}
                    title={isExpanded ? 'Collapse' : 'Edit settings'}
                  >
                    {isExpanded ? <CaretUp /> : <CaretDown />}
                  </button>
                  <button
                    className="em-icon-btn em-icon-btn--danger"
                    onClick={() => deleteTarget(target.id)}
                    title="Delete target"
                  >
                    <Trash />
                  </button>
                </div>

                {/* Progress bar while canvas files are being processed */}
                {s?.status === 'running' && s.progress && (
                  <>
                    <div className="em-progress-wrap">
                      <div
                        className="em-progress-bar"
                        style={{ width: `${progressPercent}%` }}
                      />
                      <div className="em-progress-label">
                        <span className="em-progress-summary">{progressText.summary}</span>
                        {progressText.log && (
                          <span className="em-progress-log">{progressText.log}</span>
                        )}
                      </div>
                    </div>
                    <div className="em-progress-meta">
                      <span>{formatElapsed(elapsedMs)} elapsed</span>
                      <span>{Math.min(s.progress.done, s.progress.total)}/{s.progress.total} file{s.progress.total === 1 ? '' : 's'}</span>
                      {s.cancelRequested && (
                        <span className="em-progress-warning">Stopping after the current safe step…</span>
                      )}
                      {!s.cancelRequested && isStalled && (
                        <span className="em-progress-warning">No new progress for a while. This target may be stuck.</span>
                      )}
                      {!s.cancelRequested && !isStalled && isSlow && (
                        <span className="em-progress-warning">{getSlowExportHint(target)}</span>
                      )}
                    </div>
                  </>
                )}

                {/* Result row after completion */}
                {s?.result && (
                  <div className={`em-result${s.status === 'error' ? ' em-result--error' : ''}`}>
                    {s.result.summary && (
                      <div className="em-result-row">
                        <span>{s.result.summary}</span>
                      </div>
                    )}
                    {s.result.outputs.length > 0 && (
                      <div className="em-result-row">
                        <span>✓ {s.result.outputs.length} file{s.result.outputs.length !== 1 ? 's' : ''} → {s.result.outputs.join(', ')} ({s.result.elapsed}ms)</span>
                        <button
                          className="em-reveal-btn"
                          title="Open generated file"
                          onClick={() => {
                            const outputPath = `${workspace.path}/${s.result!.outputs[0]}`;
                            openPath(outputPath).catch(() => revealItemInDir(outputPath));
                          }}
                        >
                          <FolderOpen weight="fill" size={13} />
                          Open
                        </button>

                        {/* Vercel publish button */}
                        {target.vercelPublish && s.status === 'done' && (() => {
                          const ps = publishStatuses.get(target.id);
                          return (
                            <button
                              className="em-reveal-btn em-publish-btn"
                              title={`Publish ${target.outputDir}/ to Vercel project "${target.vercelPublish.projectName}"`}
                              onClick={() => handlePublish(target)}
                              disabled={ps?.status === 'deploying'}
                            >
                              {ps?.status === 'deploying'
                                ? <CircleNotch className="em-spin" size={13} />
                                : <CloudArrowUp weight="fill" size={13} />}
                              {ps?.status === 'deploying' ? 'Publicando…' : 'Publicar'}
                            </button>
                          );
                        })()}
                      </div>
                    )}

                    {/* Publish result */}
                    {(() => {
                      const ps = publishStatuses.get(target.id);
                      if (!ps || ps.status === 'idle') return null;
                      if (ps.status === 'done' && ps.url) return (
                        <div className="em-result-row">
                          <span>☁ Publicado: <a href={ps.url} target="_blank" rel="noreferrer">{ps.url}</a></span>
                        </div>
                      );
                      if (ps.status === 'error') return (
                        <span className="em-result-error">☁ {ps.error}</span>
                      );
                      return null;
                    })()}
                    {s.result.errors.map((e, i) => (
                      <span key={i} className="em-result-error">{e}</span>
                    ))}
                  </div>
                )}

                {/* Expanded config */}
                {isExpanded && (
                  <div className="em-config">
                    <div className="em-field">
                      <label>Name</label>
                      <input
                        value={target.name}
                        onChange={(e) => updateTarget(target.id, { name: e.target.value })}
                      />
                    </div>
                    <div className="em-field">
                      <label>Description <span className="em-hint">(optional — helps AI understand this target)</span></label>
                      <input
                        placeholder="e.g. Course handout for Chapter 3 students"
                        value={target.description ?? ''}
                        onChange={(e) => updateTarget(target.id, { description: e.target.value || undefined })}
                      />
                    </div>
                    <div className="em-field">
                      <label>Format</label>
                      <select
                        value={target.format}
                        onChange={(e) => {
                          const f = e.target.value as ExportFormat;
                          updateTarget(target.id, {
                            format: f,
                            include: FORMAT_DEFAULTS[f].include,
                            outputDir: FORMAT_DEFAULTS[f].outputDir,
                            gitPublish: f === 'git-publish' ? { ...DEFAULT_GIT_PUBLISH, ...(target.gitPublish ?? {}) } : target.gitPublish,
                            vercelPublish: f === 'git-publish' ? undefined : target.vercelPublish,
                          });
                        }}
                      >
                        {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((f) => (
                          <option key={f} value={f}>{FORMAT_LABELS[f]}</option>
                        ))}
                      </select>
                    </div>

                    {/* File selection —————————————————————————————— */}
                    {target.format !== 'git-publish' && (
                      <>
                        <div className="em-section-label">File selection</div>
                        <div className="em-field">
                          <label>Pinned files <span className="em-hint">(one per line — overrides extensions below when set)</span></label>
                          <textarea
                            className="em-monaco"
                            rows={3}
                            placeholder={`notes/chapter1.md\nnotes/chapter2.md`}
                            value={(target.includeFiles ?? []).join('\n')}
                            onChange={(e) => {
                              const lines = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
                              updateTarget(target.id, { includeFiles: lines.length ? lines : undefined });
                            }}
                          />
                          <span className="em-hint">Leave empty to use extension matching instead.</span>
                        </div>
                        <div className="em-field">
                          <label>Match extensions <span className="em-hint">(comma-separated, no dot — ignored when Pinned files is set)</span></label>
                          <input
                            placeholder="md, tldr.json, html …"
                            value={target.include.join(', ')}
                            onChange={(e) =>
                              updateTarget(target.id, {
                                include: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                              })
                            }
                          />
                        </div>
                        <div className="em-field">
                          <label>Exclude files <span className="em-hint">(one per line)</span></label>
                          <textarea
                            className="em-monaco"
                            rows={2}
                            placeholder="drafts/scratch.md"
                            value={(target.excludeFiles ?? []).join('\n')}
                            onChange={(e) => {
                              const lines = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
                              updateTarget(target.id, { excludeFiles: lines.length ? lines : undefined });
                            }}
                          />
                        </div>
                      </>
                    )}

                    {/* Output ————————————————————————————————————— */}
                    {target.format !== 'git-publish' && (
                      <>
                        <div className="em-section-label">Output</div>
                        <div className="em-field">
                          <label>Output directory</label>
                          <input
                            placeholder="dist"
                            value={target.outputDir}
                            onChange={(e) => updateTarget(target.id, { outputDir: e.target.value || 'dist' })}
                          />
                        </div>
                      </>
                    )}
                    {(target.format === 'pdf' || target.format === 'canvas-pdf') && (
                      <div className="em-field em-field--row">
                        <label>
                          <input
                            type="checkbox"
                            checked={target.merge ?? false}
                            onChange={(e) => updateTarget(target.id, { merge: e.target.checked || undefined })}
                          />
                          {' '}Merge into one file
                        </label>
                        {target.merge && (
                          <input
                            className="em-inline-input"
                            placeholder="merged"
                            value={target.mergeName ?? ''}
                            onChange={(e) => updateTarget(target.id, { mergeName: e.target.value || undefined })}
                          />
                        )}
                        <span className="em-hint">
                          {target.format === 'pdf' ? 'Combines all matched markdown into one PDF.' : 'Packs all canvas frames into one PDF.'}
                          {target.merge && ` Output: ${target.mergeName?.trim() || 'merged'}.pdf`}
                        </span>
                      </div>
                    )}
                    {target.format === 'zip' && (
                      <div className="em-field">
                        <label>Zip file name</label>
                        <input
                          placeholder="export"
                          value={target.mergeName ?? ''}
                          onChange={(e) => updateTarget(target.id, { mergeName: e.target.value || undefined })}
                        />
                      </div>
                    )}

                    {target.format === 'custom' && (
                      <>
                        <div className="em-field">
                          <label>Command</label>
                          <input
                            className="em-mono"
                            placeholder="pandoc {{input}} -o {{output}}.pdf"
                            value={customConfig?.command ?? ''}
                            onChange={(e) => updateTarget(target.id, {
                              custom: {
                                command: e.target.value,
                                mode: customConfig?.mode,
                              },
                            })}
                          />
                        </div>
                        <div className="em-field">
                          <label>Execution mode</label>
                          <select
                            value={customConfig?.mode ?? 'auto'}
                            onChange={(e) => updateTarget(target.id, {
                              custom: {
                                command: customConfig?.command ?? '',
                                mode: e.target.value === 'auto'
                                  ? undefined
                                  : e.target.value as CustomExportExecutionMode,
                              },
                            })}
                          >
                            <option value="auto">Auto</option>
                            <option value="batch">Batch once</option>
                            <option value="per-file">Once per file</option>
                          </select>
                          <span className="em-hint">
                            Auto detects per-file placeholders like {'{{input}}'} / {'{{output}}'}. Batch runs the command once for the whole target. Per-file forces one run per matched file.
                          </span>
                        </div>
                        <span className="em-hint">
                          Placeholders: {CUSTOM_EXPORT_INJECTION_SPEC.placeholders.join(', ')}.
                          Quoted variants: {CUSTOM_EXPORT_INJECTION_SPEC.quotedPlaceholders.join(', ')}.
                          Batch placeholders: {CUSTOM_EXPORT_INJECTION_SPEC.batchPlaceholders.join(', ')}.
                          Runs from the workspace root using your login shell when possible.
                        </span>
                        <span className="em-hint em-hint--code">
                          Progress shortcut: print lines starting with {CUSTOM_EXPORT_PROTOCOL.progressPrefix}. Examples: {CUSTOM_EXPORT_PROTOCOL.progressPrefix} 3/10 Generating images, {CUSTOM_EXPORT_PROTOCOL.progressPrefix} 42% Building PDF, or {CUSTOM_EXPORT_PROTOCOL.progressPrefix} {`{"done":3,"total":10,"detail":"Generating images"}`}. To expose exact outputs back to Cafezin, print {CUSTOM_EXPORT_PROTOCOL.artifactPrefix} 07_Exports/file.pdf or {CUSTOM_EXPORT_PROTOCOL.artifactPrefix} {`{"path":"07_Exports/file.pdf"}`}.
                        </span>
                      </>
                    )}

                    {target.format === 'git-publish' && (
                      <>
                        <div className="em-section-label">Git Publish</div>
                        <div className="em-hint em-hint--block em-hint--info">
                          Stages the whole workspace, creates a commit when needed, then runs git push. This is ideal for sites/apps that deploy automatically after a push to GitHub.
                        </div>
                        <div className="em-field">
                          <label>Commit message <span className="em-hint">(supports {'{{workspace}}'}, {'{{target}}'}, {'{{date}}'}, {'{{datetime}}'})</span></label>
                          <input
                            className="em-mono"
                            placeholder="Publish from Cafezin — {{datetime}}"
                            value={gitPublish.commitMessage}
                            onChange={(e) => updateTarget(target.id, {
                              gitPublish: { ...gitPublish, commitMessage: e.target.value },
                            })}
                          />
                        </div>
                        <div className="em-field">
                          <label>Remote</label>
                          <input
                            className="em-mono"
                            placeholder="origin"
                            value={gitPublish.remote}
                            onChange={(e) => updateTarget(target.id, {
                              gitPublish: { ...gitPublish, remote: e.target.value },
                            })}
                          />
                        </div>
                        <div className="em-field">
                          <label>Branch <span className="em-hint">(optional)</span></label>
                          <input
                            className="em-mono"
                            placeholder="main"
                            value={gitPublish.branch}
                            onChange={(e) => updateTarget(target.id, {
                              gitPublish: { ...gitPublish, branch: e.target.value },
                            })}
                          />
                          <span className="em-hint">Leave empty to push the current branch/upstream.</span>
                        </div>
                        <div className="em-field em-field--row">
                          <label>
                            <input
                              type="checkbox"
                              checked={gitPublish.skipCommitWhenNoChanges}
                              onChange={(e) => updateTarget(target.id, {
                                gitPublish: { ...gitPublish, skipCommitWhenNoChanges: e.target.checked },
                              })}
                            />
                            {' '}Skip commit when there are no changes
                          </label>
                          <span className="em-hint">Recommended for deploy targets: the export still attempts a push even when the workspace is already clean.</span>
                        </div>
                      </>
                    )}

                    {/* PDF-only options ─────────────────────────────────── */}
                    {target.format === 'pdf' && (
                      <>
                        <div className="em-section-label">PDF Options</div>

                        {/* Versioning */}
                        <div className="em-field">
                          <label>Output versioning</label>
                          <select
                            value={target.versionOutput ?? ''}
                            onChange={(e) => updateTarget(target.id, {
                              versionOutput: (e.target.value || undefined) as ExportTarget['versionOutput'],
                            })}
                          >
                            <option value="">Overwrite (no versioning)</option>
                            <option value="timestamp">Append date  (manuscript_2026-02-28.pdf)</option>
                            <option value="counter">Increment counter  (manuscript_v3.pdf)</option>
                          </select>
                        </div>

                        {/* Custom CSS */}
                        <div className="em-field">
                          <label>Custom CSS file <span className="em-hint">(workspace-relative path)</span></label>
                          <input
                            className="em-mono"
                            placeholder="styles/book.css"
                            value={target.pdfCssFile ?? ''}
                            onChange={(e) => updateTarget(target.id, { pdfCssFile: e.target.value || undefined })}
                          />
                          <span className="em-hint">
                            Appended after the default styles — use it to set fonts, page size, colours, etc.
                          </span>
                        </div>

                        {/* Title page */}
                        <div className="em-field">
                          <label>
                            <input
                              type="checkbox"
                              checked={!!target.titlePage}
                              onChange={(e) => updateTarget(target.id, {
                                titlePage: e.target.checked ? {} : undefined,
                              })}
                            />
                            {' '}Include title page
                          </label>
                        </div>
                        {target.titlePage !== undefined && (
                          <div className="em-field em-field--indented">
                            <input
                              placeholder="Title"
                              value={target.titlePage?.title ?? ''}
                              onChange={(e) => updateTarget(target.id, { titlePage: { ...target.titlePage, title: e.target.value || undefined } })}
                            />
                            <input
                              placeholder="Subtitle"
                              value={target.titlePage?.subtitle ?? ''}
                              onChange={(e) => updateTarget(target.id, { titlePage: { ...target.titlePage, subtitle: e.target.value || undefined } })}
                            />
                            <input
                              placeholder="Author"
                              value={target.titlePage?.author ?? ''}
                              onChange={(e) => updateTarget(target.id, { titlePage: { ...target.titlePage, author: e.target.value || undefined } })}
                            />
                            <input
                              placeholder="Version (e.g. v94)"
                              value={target.titlePage?.version ?? ''}
                              onChange={(e) => updateTarget(target.id, { titlePage: { ...target.titlePage, version: e.target.value || undefined } })}
                            />
                          </div>
                        )}

                        {/* TOC */}
                        <div className="em-field">
                          <label>
                            <input
                              type="checkbox"
                              checked={target.toc ?? false}
                              onChange={(e) => updateTarget(target.id, { toc: e.target.checked || undefined })}
                            />
                            {' '}Generate Table of Contents
                          </label>
                          <span className="em-hint">
                            {target.merge
                              ? 'Inserts a TOC page (H1/H2 headings) after the title page.'
                              : 'Inserts a TOC page at the beginning of each exported PDF.'}
                          </span>
                        </div>

                        {/* Pre-processing */}
                        <div className="em-section-label">Pre-export transformations</div>
                        <div className="em-field em-field--checkgroup">
                          <label>
                            <input
                              type="checkbox"
                              checked={target.preProcess?.stripFrontmatter ?? false}
                              onChange={(e) => updateTarget(target.id, {
                                preProcess: { ...target.preProcess, stripFrontmatter: e.target.checked || undefined },
                              })}
                            />
                            {' '}Strip YAML front-matter
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={target.preProcess?.stripDraftSections ?? false}
                              onChange={(e) => updateTarget(target.id, {
                                preProcess: { ...target.preProcess, stripDraftSections: e.target.checked || undefined },
                              })}
                            />
                            {' '}Remove ### Draft sections
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={target.preProcess?.stripDetails ?? false}
                              onChange={(e) => updateTarget(target.id, {
                                preProcess: { ...target.preProcess, stripDetails: e.target.checked || undefined },
                              })}
                            />
                            {' '}Remove &lt;details&gt; blocks
                          </label>
                        </div>
                      </>
                    )}

                    {(target.format === 'canvas-png' || target.format === 'canvas-pdf') && (
                      <div className="em-hint em-hint--block em-hint--info">
                        Canvas files are opened headlessly during export. A full-screen overlay covers the UI — no visible tab switching.
                      </div>
                    )}

                    {/* Vercel Publish ─────────────────────────────────── */}
                    {target.format !== 'git-publish' && (
                      <>
                        <div className="em-section-label">Vercel Publish</div>
                        <div className="em-field">
                          <label>
                            <input
                              type="checkbox"
                              checked={!!target.vercelPublish}
                              onChange={(e) => updateTarget(target.id, {
                                vercelPublish: e.target.checked
                                  ? { projectName: target.vercelPublish?.projectName ?? '' }
                                  : undefined,
                              })}
                            />
                            {' '}Habilitar "Publicar" após export
                          </label>
                          <span className="em-hint">Exibe botão "Publicar" após export bem-sucedido para fazer deploy no Vercel.</span>
                        </div>
                        {target.vercelPublish && (
                          <div className="em-field">
                            <label>Nome do projeto Vercel <span className="em-hint">(e.g. santacruz → santacruz.vercel.app)</span></label>
                            <input
                              placeholder="meu-projeto"
                              value={target.vercelPublish.projectName}
                              onChange={(e) => updateTarget(target.id, {
                                vercelPublish: { ...target.vercelPublish!, projectName: e.target.value },
                              })}
                            />
                            <span className="em-hint">
                              Token e Team ID são configurados em Settings → API Keys (global) ou Settings → Workspace → Vercel Publish (override).
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* AI helper banner */}
        {onOpenAI && !aiHelperDismissed && (
          <div className="em-ai-banner">
            <div className="em-ai-banner-left">
              <Sparkle weight="fill" className="em-ai-banner-icon" />
              <span className="em-ai-banner-text">
                {targets.length === 0
                  ? 'Precisa de ajuda para configurar seus exports?'
                  : 'Dúvidas sobre as configurações de export?'}
              </span>
              <button
                className="em-ai-banner-cta"
                onClick={() => onOpenAI(getAIPrompt())}
              >
                Perguntar ao AI
              </button>
            </div>
            <button
              className="em-ai-banner-dismiss"
              title="Dispensar"
              onClick={() => {
                localStorage.setItem(SK.EXPORT_MODAL_AI_HELPER, '1');
                setAiHelperDismissed(true);
              }}
            >
              <X weight="bold" />
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="em-footer">
          <div className="em-footer-right">
            <button className="em-add-btn" onClick={addTarget}>
              <Plus weight="bold" /> New target
            </button>
            <button className="em-add-btn" onClick={addGitPublishTarget}>
              <CloudArrowUp weight="bold" /> Git publish
            </button>
          </div>
          <div className="em-footer-right">
            {enabledCount > 0 && (
              <span className="em-enabled-count">{enabledCount} target{enabledCount !== 1 ? 's' : ''} enabled</span>
            )}
            <button
              className="em-export-all-btn"
              onClick={runAll}
              disabled={enabledCount === 0 || isRunningAll}
              title="Run all enabled targets"
            >
              <Play weight="fill" /> Export All
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Status chip ────────────────────────────────────────────────────────────────

function StatusChip({ status }: { status?: TargetStatus }) {
  if (!status || status.status === 'idle') return null;
  if (status.status === 'running') return <span className="em-status em-status--running"><CircleNotch className="em-spin" /> Running</span>;
  if (status.status === 'done')    return <span className="em-status em-status--done"><CheckCircle weight="fill" /> Done</span>;
  if (status.status === 'canceled') return <span className="em-status em-status--canceled"><WarningCircle weight="fill" /> Canceled</span>;
  if (status.status === 'error')   return <span className="em-status em-status--error"><WarningCircle weight="fill" /> Error</span>;
  return null;
}
