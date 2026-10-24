/**
 * BookNav — the workspace presented as a book: an ordered Sumário (chapters),
 * a Caderno (other texts) and Pesquisa (read-only references).
 *
 * Replaces the generic file explorer. Files stay plain Markdown on disk; only
 * the chapter order is stored in `.cafezin/config.json` (`manuscript`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import { ArrowsClockwise, CaretDown, CaretRight, DownloadSimple, GearSix, MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import type { AIEditMark, Workspace } from '../types';
import { normalizeExportTarget } from '../types';
import {
  WORKSPACE_MUTATED_EVENT,
  deleteFile,
  readFile,
  refreshWorkspaceFiles,
  renameFile,
  saveWorkspaceConfig,
  writeFile,
} from '../services/workspace';
import { getGitAccountToken, listGitAccountLabels } from '../services/syncConfig';
import { buildManuscriptLayout, countWords, extractTitle, nextFreePath } from '../utils/manuscript';
import { displayFileName } from '../utils/fileType';
import { runExportTarget } from '../utils/exportWorkspace';
import ProjectSearchPanel from './ProjectSearchPanel';
import SyncModal from './SyncModal';
import './BookNav.css';

interface TextInfo { title: string | null; words: number }

type Section = 'chapters' | 'notebook';

interface MenuState { path: string; section: Section | 'research'; x: number; y: number; confirmDelete?: boolean }

export interface BookNavProps {
  workspace: Workspace;
  activeFile: string | null;
  /** Live content of the active file, so counts follow typing. */
  activeContent: string;
  dirtyFiles: Set<string>;
  aiMarks: AIEditMark[];
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  onFileSelect: (relPath: string) => void;
  onSearchFileOpen: (relPath: string, lineNo?: number, matchText?: string) => void;
  onWorkspaceChange: (workspace: Workspace) => void;
  onFileDeleted: (relPath: string) => void;
  onPathRenamed?: (oldPath: string, newPath: string) => void;
  onExportOpen: () => void;
  onOpenSettings: () => void;
  onGoHome: () => void;
  onSyncComplete: () => void;
  /** Assigned so the parent can trigger "new text" via ⌘N. */
  newFileRef?: { current: (() => void) | null };
}

export default function BookNav({
  workspace,
  activeFile,
  activeContent,
  dirtyFiles,
  aiMarks,
  searchOpen,
  onSearchOpenChange,
  onFileSelect,
  onSearchFileOpen,
  onWorkspaceChange,
  onFileDeleted,
  onPathRenamed,
  onExportOpen,
  onOpenSettings,
  onGoHome,
  onSyncComplete,
  newFileRef,
}: BookNavProps) {
  const { t, i18n } = useTranslation();
  const layout = useMemo(
    () => buildManuscriptLayout(workspace.fileTree, workspace.config),
    [workspace.fileTree, workspace.config],
  );
  const bookName = workspace.config.name || workspace.name;
  // Async actions must call the parent's latest callbacks: an older
  // onFileSelect would persist a stale workspace over the change just made.
  const onFileSelectRef = useRef(onFileSelect);
  onFileSelectRef.current = onFileSelect;
  const numberFormat = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);

  const [mutationTick, setMutationTick] = useState(0);
  useEffect(() => {
    const onMutation = (event: Event) => {
      const detail = (event as CustomEvent<{ workspacePath?: string }>).detail;
      if (detail?.workspacePath === workspace.path) setMutationTick((n) => n + 1);
    };
    window.addEventListener(WORKSPACE_MUTATED_EVENT, onMutation);
    return () => window.removeEventListener(WORKSPACE_MUTATED_EVENT, onMutation);
  }, [workspace.path]);

  // ── Titles and word counts, read from disk ───────────────────────────────
  const [info, setInfo] = useState<Map<string, TextInfo>>(new Map());
  const textsKey = [...layout.chapters, ...layout.notebook].join('\n');
  const savedCount = dirtyFiles.size;
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const next = new Map<string, TextInfo>();
      for (const path of textsKey ? textsKey.split('\n') : []) {
        try {
          const content = await readFile(workspace, path);
          next.set(path, { title: extractTitle(content), words: countWords(content) });
        } catch { /* unreadable file: fall back to its name */ }
      }
      if (!cancelled) setInfo(next);
    }, 800);
    return () => { cancelled = true; clearTimeout(timer); };
  // Re-read when the set of texts changes or a save completes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.path, textsKey, savedCount, mutationTick]);

  const textInfo = useCallback((path: string): TextInfo => {
    if (path === activeFile) return { title: extractTitle(activeContent), words: countWords(activeContent) };
    return info.get(path) ?? { title: null, words: 0 };
  }, [activeContent, activeFile, info]);

  const label = (path: string) => textInfo(path).title || displayFileName(path.split('/').pop() ?? path);
  const bookWords = layout.chapters.reduce((sum, path) => sum + textInfo(path).words, 0);
  const unseenAi = useMemo(() => new Set(aiMarks.filter((m) => !m.reviewed).map((m) => m.fileRelPath)), [aiMarks]);

  // ── Persistence ──────────────────────────────────────────────────────────
  const saveChapters = useCallback(async (chapters: string[], base: Workspace = workspace) => {
    const updated: Workspace = {
      ...base,
      config: { ...base.config, manuscript: { ...base.config.manuscript, chapters } },
    };
    onWorkspaceChange(updated);
    await saveWorkspaceConfig(updated);
  }, [onWorkspaceChange, workspace]);

  const refreshTree = useCallback(async (): Promise<Workspace> => {
    const { files, fileTree } = await refreshWorkspaceFiles(workspace);
    const updated = { ...workspace, files, fileTree };
    onWorkspaceChange(updated);
    return updated;
  }, [onWorkspaceChange, workspace]);

  const allPaths = useMemo(
    () => new Set([...layout.chapters, ...layout.notebook, ...layout.research, ...layout.other]),
    [layout],
  );

  const createText = useCallback(async (section: Section) => {
    let path: string;
    let heading: string;
    if (section === 'chapters') {
      const dir = commonDir(layout.chapters);
      const taken = new Set([...allPaths].map((p) => (dir ? p.slice(dir.length + 1) : p)));
      const name = nextFreePath(t('book.chapterFileBase'), 'md', taken, 2);
      path = dir ? `${dir}/${name}` : name;
      heading = t('book.untitled');
    } else {
      path = nextFreePath(t('book.untitled'), 'md', allPaths);
      heading = t('book.untitled');
    }
    await writeFile(workspace, path, `# ${heading}\n\n`);
    const updated = await refreshTree();
    if (section === 'chapters') await saveChapters([...layout.chapters, path], updated);
    await new Promise((resolve) => setTimeout(resolve, 50));
    onFileSelectRef.current(path);
  }, [allPaths, layout.chapters, refreshTree, saveChapters, t, workspace]);

  useEffect(() => {
    if (!newFileRef) return;
    newFileRef.current = () => { void createText('notebook'); };
    return () => { newFileRef.current = null; };
  }, [createText, newFileRef]);

  // ── Drag to reorder / move between Sumário and Caderno ───────────────────
  const [drag, setDrag] = useState<{ path: string; from: Section } | null>(null);
  const [dropAt, setDropAt] = useState<{ section: Section; index: number } | null>(null);

  function handleDrop(section: Section, index: number) {
    if (!drag) return;
    const chapters = layout.chapters.filter((p) => p !== drag.path);
    if (section === 'chapters') {
      const fromIndex = layout.chapters.indexOf(drag.path);
      const at = fromIndex !== -1 && fromIndex < index ? index - 1 : index;
      chapters.splice(Math.max(0, Math.min(at, chapters.length)), 0, drag.path);
    }
    setDrag(null);
    setDropAt(null);
    void saveChapters(chapters);
  }

  // ── Item menu: rename, move, delete ──────────────────────────────────────
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  async function commitRename() {
    if (!renaming) return;
    const { path, value } = renaming;
    setRenaming(null);
    const clean = value.trim().replace(/[/\\:]/g, '-');
    if (!clean) return;
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    const ext = path.slice(path.lastIndexOf('.'));
    const next = `${dir}${clean}${clean.toLowerCase().endsWith(ext) ? '' : ext}`;
    if (next === path || allPaths.has(next)) return;
    await renameFile(workspace, path, next);
    onPathRenamed?.(path, next);
    const updated = await refreshTree();
    if (layout.chapters.includes(path)) {
      await saveChapters(layout.chapters.map((p) => (p === path ? next : p)), updated);
    }
  }

  async function removeText(path: string) {
    setMenu(null);
    await deleteFile(workspace, path);
    onFileDeleted(path);
    const updated = await refreshTree();
    if (layout.chapters.includes(path)) await saveChapters(layout.chapters.filter((p) => p !== path), updated);
  }

  // ── Book PDF ─────────────────────────────────────────────────────────────
  const pdfOptions = workspace.config.manuscript?.pdf ?? {};
  const [optionsOpen, setOptionsOpen] = useState(false);
  const savePdfOptions = useCallback(async (patch: NonNullable<typeof pdfOptions>) => {
    const updated: Workspace = {
      ...workspace,
      config: {
        ...workspace.config,
        manuscript: {
          chapters: layout.chapters,
          ...workspace.config.manuscript,
          pdf: { ...workspace.config.manuscript?.pdf, ...patch },
        },
      },
    };
    onWorkspaceChange(updated);
    await saveWorkspaceConfig(updated);
  }, [layout.chapters, onWorkspaceChange, workspace]);

  const [pdf, setPdf] = useState<{ state: 'running' | 'done' | 'error'; output?: string; error?: string } | null>(null);
  async function generateBookPdf() {
    if (layout.chapters.length === 0 || pdf?.state === 'running') return;
    setPdf({ state: 'running' });
    try {
      const target = normalizeExportTarget({
        id: 'cafezin-book',
        name: bookName,
        include: ['md'],
        includeFiles: layout.chapters,
        format: 'pdf',
        outputDir: 'exports',
        enabled: true,
        merge: true,
        mergeName: bookName,
        toc: pdfOptions.toc ?? layout.chapters.length > 1,
        titlePage: {
          title: bookName,
          subtitle: pdfOptions.subtitle || undefined,
          author: pdfOptions.author || undefined,
        },
        pdfCssFile: pdfOptions.cssFile || undefined,
      });
      const result = await runExportTarget({ workspacePath: workspace.path, workspaceConfig: workspace.config, target });
      if (result.errors.length > 0 || result.outputs.length === 0) {
        setPdf({ state: 'error', error: result.errors[0] ?? t('book.pdfFailed') });
        return;
      }
      setPdf({ state: 'done', output: `${workspace.path}/${result.outputs[0]}` });
    } catch (err) {
      setPdf({ state: 'error', error: String((err as Error)?.message ?? err) });
    }
  }

  // ── Git sync ─────────────────────────────────────────────────────────────
  const [syncOpen, setSyncOpen] = useState(false);
  const [gitChanged, setGitChanged] = useState(0);
  useEffect(() => {
    if (!workspace.hasGit) return;
    invoke<{ files: string[] }>('git_diff', { path: workspace.path })
      .then((r) => setGitChanged(r.files.length))
      .catch(() => setGitChanged(0));
  }, [workspace.hasGit, workspace.path, savedCount, mutationTick, syncOpen]);

  async function handleSyncConfirm(message: string) {
    const labels = listGitAccountLabels();
    const token = labels.length > 0 ? getGitAccountToken(labels[0]) : null;
    await invoke('git_sync', { path: workspace.path, message, token: token ?? null });
    onSyncComplete();
  }

  // ── Collapsible sections, remembered per book ───────────────────────────
  const collapseKey = `cafezin:book-nav:${workspace.path}`;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(collapseKey) ?? '{}') as Record<string, boolean>; }
    catch { return {}; }
  });
  useEffect(() => {
    try { setCollapsed(JSON.parse(localStorage.getItem(collapseKey) ?? '{}') as Record<string, boolean>); }
    catch { setCollapsed({}); }
  }, [collapseKey]);
  // Folders and reference material start closed; the book itself starts open.
  const isCollapsed = (key: string) => collapsed[key] ?? (key.startsWith('dir:') || key === 'research' || key === 'other');
  function toggleSection(key: string) {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !isCollapsed(key) };
      try { localStorage.setItem(collapseKey, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }
  function sectionHeader(key: string, title: string, count: number, folder = false) {
    const closed = isCollapsed(key);
    return (
      <button
        className={`bn-h bn-toggle${folder ? ' is-folder' : ''}`}
        onClick={() => toggleSection(key)}
        aria-expanded={!closed}
      >
        <span className="bn-caret" aria-hidden>
          {closed ? <CaretRight size={10} weight="bold" /> : <CaretDown size={10} weight="bold" />}
        </span>
        <span className="bn-h-title">{title}</span>
        {closed && <span className="bn-h-count">{count}</span>}
      </button>
    );
  }

  // Caderno: loose texts first, then one group per top-level folder.
  const notebookGroups = useMemo(() => {
    const loose: string[] = [];
    const byDir = new Map<string, string[]>();
    for (const path of layout.notebook) {
      const slash = path.indexOf('/');
      if (slash === -1) { loose.push(path); continue; }
      const dir = path.slice(0, slash);
      byDir.set(dir, [...(byDir.get(dir) ?? []), path]);
    }
    return { loose, folders: [...byDir.entries()] };
  }, [layout.notebook]);

  // ── Render ───────────────────────────────────────────────────────────────
  function renderItem(path: string, section: Section | 'research', index: number) {
    const active = path === activeFile;
    const isRenaming = renaming?.path === path;
    const draggable = section !== 'research' && !isRenaming;
    const words = section === 'chapters' ? textInfo(path).words : 0;
    return (
      <div
        key={path}
        className={[
          'bn-item',
          active ? 'is-active' : '',
          section === 'research' ? 'is-research' : '',
          drag?.path === path ? 'is-dragging' : '',
          dropAt && section !== 'research' && dropAt.section === section && dropAt.index === index ? 'drop-before' : '',
        ].join(' ')}
        draggable={draggable}
        onDragStart={(e) => {
          if (section === 'research') return;
          e.dataTransfer.effectAllowed = 'move';
          setDrag({ path, from: section });
        }}
        onDragEnd={() => { setDrag(null); setDropAt(null); }}
        onDragOver={(e) => {
          if (!drag || section === 'research') return;
          e.preventDefault();
          e.stopPropagation();
          setDropAt({ section, index });
        }}
        onDrop={(e) => {
          if (section === 'research') return;
          e.preventDefault();
          e.stopPropagation();
          handleDrop(section, index);
        }}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ path, section, x: e.clientX, y: e.clientY }); }}
      >
        {isRenaming ? (
          <input
            className="bn-rename"
            autoFocus
            value={renaming.value}
            onChange={(e) => setRenaming({ path, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitRename();
              if (e.key === 'Escape') setRenaming(null);
            }}
            onBlur={() => void commitRename()}
          />
        ) : (
          <button className="bn-link" onClick={() => onFileSelect(path)} title={path}>
            {section === 'chapters' && <span className="bn-num">{index + 1}</span>}
            <span className="bn-label">{label(path)}</span>
            {unseenAi.has(path) && <span className="bn-ai-dot" title={t('book.aiPending')} />}
            {section === 'chapters' && words > 0 && (
              <span className="bn-words">{formatWords(words, numberFormat)}</span>
            )}
          </button>
        )}
      </div>
    );
  }

  return (
    <nav className="book-nav" aria-label={t('book.navLabel')}>
      <header className="bn-head">
        <button className="bn-title" onClick={onGoHome} title={t('book.homeTitle')}>{bookName}</button>
        <div className="bn-meta">
          {layout.chapters.length > 0
            ? t('book.wordCount', { count: bookWords, formatted: numberFormat.format(bookWords) })
            : t('book.noChapters')}
        </div>
      </header>

      {searchOpen ? (
        <div className="bn-search">
          <div className="bn-search-head">
            <span>{t('book.search')}</span>
            <button className="bn-icon" onClick={() => onSearchOpenChange(false)} title={t('book.closeSearch')}>
              <X size={14} />
            </button>
          </div>
          <ProjectSearchPanel workspace={workspace} onOpenFile={onSearchFileOpen} />
        </div>
      ) : (
        <div className="bn-scroll">
          <section
            className="bn-section"
            onDragOver={(e) => { if (drag) { e.preventDefault(); setDropAt({ section: 'chapters', index: layout.chapters.length }); } }}
            onDrop={(e) => { e.preventDefault(); handleDrop('chapters', layout.chapters.length); }}
          >
            {sectionHeader('chapters', t('book.contents'), layout.chapters.length)}
            {!isCollapsed('chapters') && (
              <>
                {layout.chapters.map((p, i) => renderItem(p, 'chapters', i))}
                {layout.chapters.length === 0 && <p className="bn-empty">{t('book.contentsEmpty')}</p>}
                <button className="bn-add" onClick={() => void createText('chapters')}>
                  <Plus size={12} /> {t('book.newChapter')}
                </button>
              </>
            )}
          </section>

          <section
            className="bn-section"
            onDragOver={(e) => { if (drag?.from === 'chapters') { e.preventDefault(); setDropAt({ section: 'notebook', index: layout.notebook.length }); } }}
            onDrop={(e) => { e.preventDefault(); handleDrop('notebook', layout.notebook.length); }}
          >
            {sectionHeader('notebook', t('book.notebook'), layout.notebook.length)}
            {!isCollapsed('notebook') && (
              <>
                {notebookGroups.loose.map((p) => renderItem(p, 'notebook', layout.notebook.indexOf(p)))}
                {notebookGroups.folders.map(([dir, paths]) => (
                  <div key={dir} className="bn-folder">
                    {sectionHeader(`dir:${dir}`, dir, paths.length, true)}
                    {!isCollapsed(`dir:${dir}`) && paths.map((p) => renderItem(p, 'notebook', layout.notebook.indexOf(p)))}
                  </div>
                ))}
                <button className="bn-add" onClick={() => void createText('notebook')}>
                  <Plus size={12} /> {t('book.newNote')}
                </button>
              </>
            )}
          </section>

          {layout.research.length > 0 && (
            <section className="bn-section">
              {sectionHeader('research', t('book.research'), layout.research.length)}
              {!isCollapsed('research') && layout.research.map((p, i) => renderItem(p, 'research', i))}
            </section>
          )}

          {layout.other.length > 0 && (
            <section className="bn-section bn-other">
              {sectionHeader('other', t('book.other'), layout.other.length)}
              {!isCollapsed('other') && layout.other.map((p, i) => renderItem(p, 'research', i))}
            </section>
          )}
        </div>
      )}

      {optionsOpen && (
        <div className="bn-pdf-options" role="dialog" aria-label={t('book.pdfOptionsTitle')}>
          <div className="bn-pdf-head">
            <span>{t('book.pdfOptionsHeading')}</span>
            <button className="bn-icon" onClick={() => setOptionsOpen(false)} title={t('book.dismiss')}><X size={12} /></button>
          </div>
          <label>
            {t('book.pdfSubtitle')}
            <input
              defaultValue={pdfOptions.subtitle ?? ''}
              onBlur={(e) => void savePdfOptions({ subtitle: e.target.value.trim() || undefined })}
            />
          </label>
          <label>
            {t('book.pdfAuthor')}
            <input
              defaultValue={pdfOptions.author ?? ''}
              onBlur={(e) => void savePdfOptions({ author: e.target.value.trim() || undefined })}
            />
          </label>
          <label className="bn-check">
            <input
              type="checkbox"
              checked={pdfOptions.toc ?? layout.chapters.length > 1}
              onChange={(e) => void savePdfOptions({ toc: e.target.checked })}
            />
            {t('book.pdfToc')}
          </label>
          <label>
            {t('book.pdfCss')}
            <input
              placeholder="estilo/livro.css"
              defaultValue={pdfOptions.cssFile ?? ''}
              onBlur={(e) => void savePdfOptions({ cssFile: e.target.value.trim() || undefined })}
            />
          </label>
          <button className="bn-text-btn bn-advanced" onClick={() => { setOptionsOpen(false); onExportOpen(); }}>
            {t('book.pdfAdvanced')}
          </button>
        </div>
      )}

      <footer className="bn-foot">
        {pdf?.state === 'done' && pdf.output ? (
          <span className="bn-foot-row">
            <button className="bn-foot-btn is-accent" onClick={() => { void openPath(pdf.output!).catch(() => revealItemInDir(pdf.output!)); }}>
              <DownloadSimple size={15} /> {t('book.pdfReady')}
            </button>
            <button className="bn-icon" onClick={() => setPdf(null)} title={t('book.dismiss')}><X size={12} /></button>
          </span>
        ) : (
          <span className="bn-foot-row">
            <button
              className="bn-foot-btn"
              onClick={() => void generateBookPdf()}
              disabled={layout.chapters.length === 0 || pdf?.state === 'running'}
              title={pdf?.state === 'error' ? pdf.error : t('book.pdfTitle')}
            >
              <DownloadSimple size={15} />
              {pdf?.state === 'running' ? t('book.pdfRunning') : pdf?.state === 'error' ? t('book.pdfRetry') : t('book.pdf')}
            </button>
            <button
              className="bn-text-btn"
              onClick={() => setOptionsOpen((v) => !v)}
              title={t('book.pdfOptionsTitle')}
              aria-expanded={optionsOpen}
            >
              {t('book.pdfOptions')}
            </button>
          </span>
        )}
        <button className="bn-foot-btn" onClick={() => onSearchOpenChange(!searchOpen)}>
          <MagnifyingGlass size={15} /> {t('book.search')} <kbd>⌘⇧F</kbd>
        </button>
        {workspace.hasGit && (
          <button className="bn-foot-btn" onClick={() => setSyncOpen(true)}>
            <ArrowsClockwise size={15} /> {t('book.sync')}
            {gitChanged > 0 && <span className="bn-count">{gitChanged}</span>}
          </button>
        )}
        <button className="bn-foot-btn" onClick={onOpenSettings}>
          <GearSix size={15} /> {t('book.settings')}
        </button>
      </footer>

      {menu && (
        <div ref={menuRef} className="bn-menu" style={{ left: menu.x, top: menu.y }} role="menu">
          {menu.section !== 'research' && (
            <button onClick={() => { setRenaming({ path: menu.path, value: displayFileName(menu.path.split('/').pop() ?? '') }); setMenu(null); }}>
              {t('book.rename')}
            </button>
          )}
          {menu.section === 'notebook' && (
            <button onClick={() => { void saveChapters([...layout.chapters, menu.path]); setMenu(null); }}>
              {t('book.moveToContents')}
            </button>
          )}
          {menu.section === 'chapters' && (
            <button onClick={() => { void saveChapters(layout.chapters.filter((p) => p !== menu.path)); setMenu(null); }}>
              {t('book.moveToNotebook')}
            </button>
          )}
          <button onClick={() => { void revealItemInDir(`${workspace.path}/${menu.path}`).catch(() => {}); setMenu(null); }}>
            {t('book.reveal')}
          </button>
          {menu.confirmDelete ? (
            <button className="is-danger" onClick={() => void removeText(menu.path)}>{t('book.deleteConfirm')}</button>
          ) : (
            <button className="is-danger" onClick={() => setMenu({ ...menu, confirmDelete: true })}>{t('book.delete')}</button>
          )}
        </div>
      )}

      <SyncModal
        open={syncOpen}
        workspacePath={workspace.path}
        onConfirm={handleSyncConfirm}
        onClose={() => setSyncOpen(false)}
      />
    </nav>
  );
}

function commonDir(paths: string[]): string {
  if (paths.length === 0) return '';
  const dirs = paths.map((p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''));
  return dirs.every((d) => d === dirs[0]) ? dirs[0] : '';
}

function formatWords(words: number, format: Intl.NumberFormat): string {
  return words >= 1000 ? `${format.format(Math.round(words / 100) / 10)}k` : format.format(words);
}
