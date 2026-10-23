/**
 * ExportModal — workspace Build / Export settings.
 *
 * Inspired by Unity's Build Settings:  define named targets, configure them,
 * run one or all.  Config is persisted in <workspace>/.cafezin/config.json
 * via the saveWorkspaceConfig service.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { X, Plus, Play, Trash, CaretDown, CaretUp, CheckCircle, WarningCircle, CircleNotch, FolderOpen, Sparkle } from '@phosphor-icons/react';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import { runExportTarget, listAllFiles, resolveFiles, ExportCancelledError, type ExportProgressInfo, type ExportResult } from '../utils/exportWorkspace';
import { saveWorkspaceConfig } from '../services/workspace';
import {
  normalizeExportTarget,
  normalizeWorkspaceExportConfig,
  type Workspace,
  type ExportTarget,
  type ExportFormat,
  type WorkspaceExportConfig,
} from '../types';
import { SK } from '../services/storageKeys';
import { useTranslation } from 'react-i18next';
import './ExportModal.css';

// ── Helpers ────────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 9); }

const DEFAULT_TARGET: Omit<ExportTarget, 'id' | 'name'> = {
  include: ['md'],
  format: 'pdf',
  outputDir: 'dist',
  enabled: true,
};

// Keep the export engine backward-compatible with existing workspace config,
// while exposing only manuscript → PDF in the active book-authoring UI.
const BOOK_AUTHORING_ONLY = true;

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


// ── Component ──────────────────────────────────────────────────────────────────

interface ExportModalProps {
  workspace: Workspace;
  onWorkspaceChange: (ws: Workspace) => void;
  onClose: () => void;
  /** Called when the user wants to open AI with a pre-filled prompt */
  onOpenAI?: (prompt: string) => void;
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

export default function ExportModal({
  workspace,
  onWorkspaceChange,
  onClose,
  onOpenAI,
}: ExportModalProps) {
  const { t } = useTranslation();
  const savedConfig = normalizeWorkspaceExportConfig(workspace.config.exportConfig);
  const [targets, setTargets] = useState<ExportTarget[]>(savedConfig?.targets ?? []);
  const visibleTargets = targets.filter((target) => !BOOK_AUTHORING_ONLY || target.format === 'pdf');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Map<string, TargetStatus>>(new Map());
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
    if (visibleTargets.length === 0) {
      return 'Estou abrindo as configurações de Export do Cafezin pela primeira vez. Pode me ajudar a entender quais targets de export fazem sentido criar para o meu workspace?';
    }
    const expanded = visibleTargets.find((t) => t.id === expandedId);
    const ref = expanded ?? visibleTargets[0];
    const prompts: Partial<Record<ExportFormat, string>> = {
      'pdf': `Estou configurando um target de export "${ref.name}" (Markdown → PDF) no Cafezin. Como posso configurar os campos Include e Output dir para produzir um PDF bem formatado?`,
      'zip': `Estou configurando um target de export tipo Zip bundle no Cafezin. Que tipos de arquivo fazem sentido incluir?`,
    };
    return prompts[ref.format]
      ?? `Estou configurando um target de export "${ref.name}" (Markdown → PDF) no Cafezin. Como posso configurar os campos Include e Output dir para produzir um PDF bem formatado?`;
  }

  // ── Async file-count preview ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const allFiles = await listAllFiles(workspace.path);
        if (cancelled) return;
        const counts = new Map<string, number>();
        for (const t of visibleTargets) {
          counts.set(t.id, resolveFiles(allFiles, t).length);
        }
        setFileCounts(counts);
      } catch { /* best-effort */ }
    }
    refresh();
    return () => { cancelled = true; };
  // Depend only on the file-selection fields that affect which files are matched
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(visibleTargets.map(t => ({ id: t.id, format: t.format, include: t.include, includeFiles: t.includeFiles, excludeFiles: t.excludeFiles })))]);

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

  function addManuscript() {
    const target = normalizeExportTarget({
      id: uid(),
      name: t('export.manuscriptName'),
      ...DEFAULT_TARGET,
      merge: true,
      mergeName: 'manuscrito',
      titlePage: { title: workspace.config.name || workspace.name },
      toc: true,
    });
    updateTargets([...targets, target]);
    setExpandedId(target.id);
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
      for (const t of visibleTargets.filter((t) => t.enabled)) {
        const outcome = await runTarget(t);
        if (outcome === 'canceled') break;
      }
    } finally {
      setIsRunningAll(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  const enabledCount = visibleTargets.filter((t) => t.enabled).length;

  return (
    <div className="em-backdrop" onClick={(e) => { if (e.target === e.currentTarget) handleRequestClose(); }}>
      <div className="em-modal">

        {/* Header */}
        <div className="em-header">
          <span className="em-title">{t('export.title')}</span>
          <button className="em-close" onClick={handleRequestClose} title={closeRequested ? t('export.closingTitle') : t('export.close')}><X weight="bold" /></button>
        </div>

        {/* Target list */}
        <div className="em-body">
          {visibleTargets.length === 0 && (
            <div className="em-empty">
              <p className="em-empty-text">{t('export.emptyText')}</p>
              <button className="em-export-all-btn" onClick={addManuscript}>
                <Plus weight="bold" /> {t('export.createManuscript')}
              </button>
            </div>
          )}

          {visibleTargets.map((target) => {
            const s = statuses.get(target.id);
            const isExpanded = expandedId === target.id;
            const targetOutLabel = `${target.outputDir}/`;
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
                    title={t('export.enableTitle')}
                  />
                  <span
                    className="em-target-name"
                    onDoubleClick={() => {
                      const n = prompt(t('export.renamePrompt'), target.name);
                      if (n?.trim()) updateTarget(target.id, { name: n.trim() });
                    }}
                    title={t('export.renameTitle')}
                  >
                    {target.name}
                  </span>
                  <span className="em-target-out" title={t('export.outputDir')}>{targetOutLabel}</span>
                  {fileCounts.has(target.id) && (
                    <span className="em-file-count" title={t('export.fileCountTitle')}>
                      {t('export.fileCount', { count: fileCounts.get(target.id) })}
                    </span>
                  )}

                  <StatusChip status={s} />

                  <button
                    className={`em-run-btn${s?.status === 'running' ? ' em-run-btn--cancel' : ''}`}
                    onClick={() => {
                      if (s?.status === 'running') requestCancel(target.id);
                      else void runTarget(target);
                    }}
                    title={s?.status === 'running' ? t('export.cancelTitle') : t('export.runTitle')}
                  >
                    {s?.status === 'running'
                      ? <CircleNotch className="em-spin" />
                      : <Play weight="fill" />
                    }
                    {s?.status === 'running' ? (s.cancelRequested ? t('export.stopping') : t('export.cancel')) : t('export.run')}
                  </button>

                  <button
                    className="em-icon-btn"
                    onClick={() => setExpandedId(isExpanded ? null : target.id)}
                    title={isExpanded ? t('export.collapse') : t('export.editSettings')}
                  >
                    {isExpanded ? <CaretUp /> : <CaretDown />}
                  </button>
                  <button
                    className="em-icon-btn em-icon-btn--danger"
                    onClick={() => deleteTarget(target.id)}
                    title={t('export.delete')}
                  >
                    <Trash />
                  </button>
                </div>

                {/* Progress bar while export is running */}
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
                      <span>{t('export.elapsed', { time: formatElapsed(elapsedMs) })}</span>
                      <span>{Math.min(s.progress.done, s.progress.total)}/{s.progress.total}</span>
                      {s.cancelRequested && (
                        <span className="em-progress-warning">{t('export.stoppingSafe')}</span>
                      )}
                      {!s.cancelRequested && isStalled && (
                        <span className="em-progress-warning">{t('export.stalled')}</span>
                      )}
                      {!s.cancelRequested && !isStalled && isSlow && (
                        <span className="em-progress-warning">{t('export.slow')}</span>
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
                        <span>✓ {s.result.outputs.join(', ')}</span>
                        <button
                          className="em-reveal-btn"
                          title={t('export.openTitle')}
                          onClick={() => {
                            const outputPath = `${workspace.path}/${s.result!.outputs[0]}`;
                            openPath(outputPath).catch(() => revealItemInDir(outputPath));
                          }}
                        >
                          <FolderOpen weight="fill" size={13} />
                          {t('export.open')}
                        </button>

                      </div>
                    )}

                    {s.result.errors.map((e, i) => (
                      <span key={i} className="em-result-error">{e}</span>
                    ))}
                  </div>
                )}

                {/* Expanded config */}
                {isExpanded && (
                  <div className="em-config">
                    <div className="em-field">
                      <label>{t('export.name')}</label>
                      <input
                        value={target.name}
                        onChange={(e) => updateTarget(target.id, { name: e.target.value })}
                      />
                    </div>
                    <div className="em-field">
                      <label>{t('export.description')} <span className="em-hint">{t('export.descriptionHint')}</span></label>
                      <input
                        placeholder={t('export.descriptionPlaceholder')}
                        value={target.description ?? ''}
                        onChange={(e) => updateTarget(target.id, { description: e.target.value || undefined })}
                      />
                    </div>
                    {/* File selection —————————————————————————————— */}
                    {(
                      <>
                        <div className="em-section-label">{t('export.filesSection')}</div>
                        <div className="em-field">
                          <label>{t('export.pinnedFiles')} <span className="em-hint">{t('export.pinnedFilesHint')}</span></label>
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
                          <span className="em-hint">{t('export.pinnedFilesEmpty')}</span>
                        </div>
                        <div className="em-field">
                          <label>{t('export.extensions')} <span className="em-hint">{t('export.extensionsHint')}</span></label>
                          <input
                            placeholder="md, mdx"
                            value={target.include.join(', ')}
                            onChange={(e) =>
                              updateTarget(target.id, {
                                include: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                              })
                            }
                          />
                        </div>
                        <div className="em-field">
                          <label>{t('export.exclude')} <span className="em-hint">{t('export.pinnedFilesHint')}</span></label>
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
                    {(
                      <>
                        <div className="em-section-label">{t('export.outputSection')}</div>
                        <div className="em-field">
                          <label>{t('export.outputDir')}</label>
                          <input
                            placeholder="dist"
                            value={target.outputDir}
                            onChange={(e) => updateTarget(target.id, { outputDir: e.target.value || 'dist' })}
                          />
                        </div>
                      </>
                    )}
                    {target.format === 'pdf' && (
                      <div className="em-field em-field--row">
                        <label>
                          <input
                            type="checkbox"
                            checked={target.merge ?? false}
                            onChange={(e) => updateTarget(target.id, { merge: e.target.checked || undefined })}
                          />
                          {' '}{t('export.merge')}
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
                          {t('export.mergeHint')}
                          {target.merge && ` → ${target.mergeName?.trim() || 'merged'}.pdf`}
                        </span>
                      </div>
                    )}
                    {target.format === 'zip' && (
                      <div className="em-field">
                        <label>{t('export.zipName')}</label>
                        <input
                          placeholder="export"
                          value={target.mergeName ?? ''}
                          onChange={(e) => updateTarget(target.id, { mergeName: e.target.value || undefined })}
                        />
                      </div>
                    )}

                    {/* PDF-only options ─────────────────────────────────── */}
                    {target.format === 'pdf' && (
                      <>
                        <div className="em-section-label">{t('export.pdfSection')}</div>

                        {/* Versioning */}
                        <div className="em-field">
                          <label>{t('export.versioning')}</label>
                          <select
                            value={target.versionOutput ?? ''}
                            onChange={(e) => updateTarget(target.id, {
                              versionOutput: (e.target.value || undefined) as ExportTarget['versionOutput'],
                            })}
                          >
                            <option value="">{t('export.versionOverwrite')}</option>
                            <option value="timestamp">{t('export.versionDate')}</option>
                            <option value="counter">{t('export.versionCounter')}</option>
                          </select>
                        </div>

                        {/* Custom CSS */}
                        <div className="em-field">
                          <label>{t('export.css')} <span className="em-hint">{t('export.cssHint')}</span></label>
                          <input
                            className="em-mono"
                            placeholder="styles/book.css"
                            value={target.pdfCssFile ?? ''}
                            onChange={(e) => updateTarget(target.id, { pdfCssFile: e.target.value || undefined })}
                          />
                          <span className="em-hint">
                            {t('export.cssHelp')}
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
                            {' '}{t('export.titlePage')}
                          </label>
                        </div>
                        {target.titlePage !== undefined && (
                          <div className="em-field em-field--indented">
                            <input
                              placeholder={t('export.tpTitle')}
                              value={target.titlePage?.title ?? ''}
                              onChange={(e) => updateTarget(target.id, { titlePage: { ...target.titlePage, title: e.target.value || undefined } })}
                            />
                            <input
                              placeholder={t('export.tpSubtitle')}
                              value={target.titlePage?.subtitle ?? ''}
                              onChange={(e) => updateTarget(target.id, { titlePage: { ...target.titlePage, subtitle: e.target.value || undefined } })}
                            />
                            <input
                              placeholder={t('export.tpAuthor')}
                              value={target.titlePage?.author ?? ''}
                              onChange={(e) => updateTarget(target.id, { titlePage: { ...target.titlePage, author: e.target.value || undefined } })}
                            />
                            <input
                              placeholder={t('export.tpVersion')}
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
                            {' '}{t('export.toc')}
                          </label>
                          <span className="em-hint">
                            {target.merge
                              ? t('export.tocMergeHint')
                              : t('export.tocHint')}
                          </span>
                        </div>

                        {/* Pre-processing */}
                        <div className="em-section-label">{t('export.cleanupSection')}</div>
                        <div className="em-field em-field--checkgroup">
                          <label>
                            <input
                              type="checkbox"
                              checked={target.preProcess?.stripFrontmatter ?? false}
                              onChange={(e) => updateTarget(target.id, {
                                preProcess: { ...target.preProcess, stripFrontmatter: e.target.checked || undefined },
                              })}
                            />
                            {' '}{t('export.stripFrontmatter')}
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={target.preProcess?.stripDraftSections ?? false}
                              onChange={(e) => updateTarget(target.id, {
                                preProcess: { ...target.preProcess, stripDraftSections: e.target.checked || undefined },
                              })}
                            />
                            {' '}{t('export.stripDraft')}
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={target.preProcess?.stripDetails ?? false}
                              onChange={(e) => updateTarget(target.id, {
                                preProcess: { ...target.preProcess, stripDetails: e.target.checked || undefined },
                              })}
                            />
                            {' '}{t('export.stripDetails')}
                          </label>
                        </div>
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
                {t('export.aiHelp')}
              </span>
              <button
                className="em-ai-banner-cta"
                onClick={() => onOpenAI(getAIPrompt())}
              >
                {t('export.askAgent')}
              </button>
            </div>
            <button
              className="em-ai-banner-dismiss"
              title={t('export.dismiss')}
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
              <Plus weight="bold" /> {t('export.newTarget')}
            </button>
          </div>
          <div className="em-footer-right">
            {enabledCount > 0 && (
              <span className="em-enabled-count">{t('export.enabledCount', { count: enabledCount })}</span>
            )}
            <button
              className="em-export-all-btn"
              onClick={runAll}
              disabled={enabledCount === 0 || isRunningAll}
              title={t('export.runAllTitle')}
            >
              <Play weight="fill" /> {t('export.runAll')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Status chip ────────────────────────────────────────────────────────────────

function StatusChip({ status }: { status?: TargetStatus }) {
  const { t } = useTranslation();
  if (!status || status.status === 'idle') return null;
  if (status.status === 'running') return <span className="em-status em-status--running"><CircleNotch className="em-spin" /> {t('export.statusRunning')}</span>;
  if (status.status === 'done')    return <span className="em-status em-status--done"><CheckCircle weight="fill" /> {t('export.statusDone')}</span>;
  if (status.status === 'canceled') return <span className="em-status em-status--canceled"><WarningCircle weight="fill" /> {t('export.statusCanceled')}</span>;
  if (status.status === 'error')   return <span className="em-status em-status--error"><WarningCircle weight="fill" /> {t('export.statusError')}</span>;
  return null;
}
