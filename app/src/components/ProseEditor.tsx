/**
 * ProseEditor — Tiptap-based WYSIWYG markdown editor.
 *
 * Used for .md and .txt files. Unlike the CM6 Editor which renders markdown
 * source with live preview, this renders the formatted document directly
 * (bold is bold, not **bold**). Because the underlying DOM is a plain
 * contenteditable, Grammarly works reliably across the full document.
 *
 * Implements the same EditorHandle interface as Editor.tsx so App.tsx,
 * AIMarkOverlay and FindReplaceBar can work without changes.
 */
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor as TiptapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension } from '@tiptap/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { flattenFileTree, resolveDocumentLink, restoreProseWikiLinks } from '../utils/documentLinks';
import { restoreProseTaskMarkers } from '../utils/proseMarkdown';
import type { FileTreeNode } from '../types';
import { Markdown } from 'tiptap-markdown';
import { useTranslation } from 'react-i18next';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  TextB, TextItalic, TextHTwo, TextHThree, ListBullets, Quotes, Sparkle,
} from '@phosphor-icons/react';
import {
  forwardRef,
  useImperativeHandle,
  useEffect,
  useRef,
  useCallback,
  useState,
} from 'react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorHandle } from './Editor';
import type { AISelectionContext, AITextRevert } from '../types/index';
import { findAIMarkRange } from '../utils/aiMarkMatch';
import './ProseEditor.css';

// ── Selection menu — formatting appears only when text is selected ──────────

interface MenuBtn {
  title: string;
  icon: React.ReactNode;
  action: () => void;
  isActive: boolean;
}

const SELECTION_MENU_OPTIONS = { placement: 'top' } as const;

// The BubbleMenu re-registers its plugin when its props change, which dispatches
// a transaction; keep it stable and let only the buttons re-render.
function SelectionMenu({ editor, onAIRequest }: {
  editor: TiptapEditor;
  onAIRequest?: (selectedText: string) => void;
}) {
  return (
    <BubbleMenu editor={editor} className="sel-menu" options={SELECTION_MENU_OPTIONS}>
      <SelectionMenuButtons editor={editor} onAIRequest={onAIRequest} />
    </BubbleMenu>
  );
}

function SelectionMenuButtons({ editor, onAIRequest }: {
  editor: TiptapEditor;
  onAIRequest?: (selectedText: string) => void;
}) {
  const { t } = useTranslation();
  // Re-render whenever selection/marks change so active states stay in sync
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const update = () => forceUpdate((n) => n + 1);
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor]);

  function selectedText(): string {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, ' ');
  }

  function makeReference() {
    const raw = selectedText();
    const text = raw.trim();
    if (!text || text.includes('\n')) return;
    // Keep the spaces a loose selection picked up at its edges.
    const lead = raw.slice(0, raw.length - raw.trimStart().length);
    const trail = raw.slice(raw.trimEnd().length);
    editor.chain().focus().insertContent(`${lead}[[${text}]]${trail}`).run();
  }

  const groups: MenuBtn[][] = [
    [
      { title: t('editor.bold'),          icon: <TextB size={15} weight="bold" />, action: () => editor.chain().focus().toggleBold().run(),   isActive: editor.isActive('bold') },
      { title: t('editor.italic'),        icon: <TextItalic size={15} />,          action: () => editor.chain().focus().toggleItalic().run(), isActive: editor.isActive('italic') },
    ],
    [
      { title: t('editor.heading2Short'), icon: <TextHTwo size={15} />,            action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), isActive: editor.isActive('heading', { level: 2 }) },
      { title: t('editor.heading3Short'), icon: <TextHThree size={15} />,          action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), isActive: editor.isActive('heading', { level: 3 }) },
      { title: t('editor.blockquote'),    icon: <Quotes size={15} />,              action: () => editor.chain().focus().toggleBlockquote().run(), isActive: editor.isActive('blockquote') },
      { title: t('editor.bulletList'),    icon: <ListBullets size={15} />,         action: () => editor.chain().focus().toggleBulletList().run(), isActive: editor.isActive('bulletList') },
    ],
    [
      { title: t('editor.makeReference'), icon: <span className="sel-menu-ref">[[ ]]</span>, action: makeReference, isActive: false },
    ],
  ];

  return (
    <>
      {groups.map((group, gi) => (
        <div key={gi} className="sel-menu-group">
          {group.map((btn) => (
            <button
              key={btn.title}
              title={btn.title}
              aria-label={btn.title}
              aria-pressed={btn.isActive}
              onMouseDown={(e) => { e.preventDefault(); btn.action(); }}
              className={`sel-menu-btn${btn.isActive ? ' active' : ''}`}
            >
              {btn.icon}
            </button>
          ))}
        </div>
      ))}
      {onAIRequest && (
        <button
          className="sel-menu-ai"
          onMouseDown={(e) => { e.preventDefault(); onAIRequest(selectedText()); }}
        >
          <Sparkle size={14} weight="fill" /> {t('editor.askAgent')}
        </button>
      )}
    </>
  );
}

// ── Text-search helpers ───────────────────────────────────────────────────────

/** Convert a plain-text character offset into a ProseMirror document position. */
function charToDocPos(doc: PMNode, charOffset: number): number {
  let chars = 0;
  let result = -1;
  doc.descendants((node, pos) => {
    if (result !== -1) return false;
    if (!node.isText) return undefined;
    const len = node.text!.length;
    if (chars + len > charOffset) {
      result = pos + (charOffset - chars);
      return false;
    }
    chars += len;
    return undefined;
  });
  if (result === -1 && charOffset === chars) result = doc.content.size;
  return result;
}

/**
 * Find the first occurrence of `needle` in a ProseMirror doc.
 * Returns ProseMirror {from, to} positions, or null if not found.
 */
function findTextInDoc(
  doc: PMNode,
  needle: string,
): { from: number; to: number } | null {
  if (!needle) return null;
  const fullText = doc.textContent;
  const idx = fullText.indexOf(needle);
  if (idx === -1) return null;
  const from = charToDocPos(doc, idx);
  const to   = charToDocPos(doc, idx + needle.length);
  if (from === -1 || to === -1) return null;
  return { from, to };
}

// ── AI-mark decoration plugin ─────────────────────────────────────────────────

const aiMarkKey = new PluginKey<DecorationSet>('proseAiMarks');

interface AIMark { id: string; text: string }

function buildAIDecos(doc: PMNode, marks: AIMark[]): DecorationSet {
  const decos: Decoration[] = [];
  for (const mark of marks) {
    const range = findTextInDoc(doc, mark.text);
    if (range) {
      decos.push(
        Decoration.inline(range.from, range.to, {
          class: 'prose-ai-mark',
          'data-mark-id': mark.id,
        }),
      );
    }
  }
  return DecorationSet.create(doc, decos);
}

function makeAIMarkPlugin(storeRef: { current: AIMark[] }) {
  return new Plugin<DecorationSet>({
    key: aiMarkKey,
    state: {
      init(_, { doc }) { return buildAIDecos(doc, storeRef.current); },
      apply(tr, old) {
        if (!tr.docChanged && !tr.getMeta(aiMarkKey)) return old.map(tr.mapping, tr.doc);
        return buildAIDecos(tr.doc, storeRef.current);
      },
    },
    props: {
      decorations(state) { return this.getState(state); },
    },
  });
}

// Decorate wiki syntax without replacing its text: Markdown persistence stays portable.
// Live preview for Markdown that Tiptap keeps as plain text:
//  · [[target|label]] shows only the label (the syntax returns while the cursor
//    is inside it), and a plain click opens the referenced text;
//  · "- [x] item" shows a checkbox that toggles the marker.
const WIKI_LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const TASK_MARKER = /^\[( |x|X)\] /;

function taskBox(checked: boolean, markerPos: number) {
  return (view: import('@tiptap/pm/view').EditorView) => {
    const box = document.createElement('span');
    box.className = `prose-task-box${checked ? ' is-checked' : ''}`;
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(checked));
    box.contentEditable = 'false';
    box.addEventListener('mousedown', (event) => {
      event.preventDefault();
      view.dispatch(view.state.tr.insertText(checked ? ' ' : 'x', markerPos + 1, markerPos + 2));
    });
    return box;
  };
}

const wikiLinkPlugin = new Plugin({
  props: {
    decorations(state) {
      const decorations: Decoration[] = [];
      const { from: selFrom, to: selTo } = state.selection;
      const touches = (start: number, end: number) => selFrom < end && selTo > start;
      state.doc.descendants((node, pos, parent, index) => {
        if (!node.isText || parent?.type.name === 'codeBlock' ||
            node.marks.some((mark) => mark.type.name === 'code')) return;
        const text = node.text ?? '';

        if (index === 0 && parent?.type.name === 'paragraph'
            && state.doc.resolve(pos).node(-1)?.type.name === 'listItem') {
          const task = text.match(TASK_MARKER);
          if (task && !touches(pos, pos + 4)) {
            decorations.push(Decoration.widget(pos, taskBox(task[1] !== ' ', pos), { side: -1 }));
            decorations.push(Decoration.inline(pos, pos + 4, { class: 'pm-hidden' }));
            if (task[1] !== ' ') decorations.push(Decoration.inline(pos + 4, pos + text.length, { class: 'prose-task-done' }));
          }
        }

        for (const match of text.matchAll(WIKI_LINK)) {
          const start = pos + match.index!;
          const end = start + match[0].length;
          const target = match[1].trim();
          const linkAttrs = {
            class: 'prose-wiki-link',
            'data-document-target': target,
          };
          if (touches(start, end)) {
            decorations.push(Decoration.inline(start, end, linkAttrs));
            continue;
          }
          const labelStart = match[2] !== undefined ? start + 2 + match[1].length + 1 : start + 2;
          decorations.push(Decoration.inline(start, labelStart, { class: 'pm-hidden' }));
          decorations.push(Decoration.inline(labelStart, end - 2, { ...linkAttrs, 'data-collapsed': 'true' }));
          decorations.push(Decoration.inline(end - 2, end, { class: 'pm-hidden' }));
        }
      });
      return DecorationSet.create(state.doc, decorations);
    },
  },
});

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProseEditorProps {
  content: string;
  onChange: (value: string) => void;
  onToggleFind?: () => void;
  onAIRequest?: (selectedText: string) => void;
  isLocked?: boolean;
  aiMarks?: { id: string; text: string; revert?: AITextRevert }[];
  onAIMarkEdited?: (markId: string) => void;
  fontSize?: number;
  isDark?: boolean;
  onImagePaste?: (file: File) => Promise<string | null>;
  onSelectionContextChange?: (ctx: AISelectionContext | null) => void;
  activeFile?: string;
  onNavigate?: (path: string) => void;
  workspaceFileTree?: FileTreeNode[];
  /** Small label above the title, e.g. "Capítulo 2" for manuscript chapters. */
  kicker?: string;
  /** Pending agent notes: leave room for them in the right margin. */
  hasMarginNotes?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

function serializeProse(editor: TiptapEditor): string {
  return (editor.storage as unknown as {
    markdown: { getMarkdown(): string };
  }).markdown.getMarkdown();
}

const ProseEditor = forwardRef<EditorHandle, ProseEditorProps>(
  (
    {
      content,
      onChange,
      onToggleFind,
      onAIRequest,
      isLocked = false,
      aiMarks,
      onAIMarkEdited,
      fontSize = 14,
      isDark = true,
      onImagePaste,
      onSelectionContextChange,
      activeFile,
      onNavigate,
      workspaceFileTree,
      kicker,
      hasMarginNotes = false,
    },
    ref,
  ) => {
    // Tracks the last markdown string we emitted from onUpdate so we can
    // distinguish "echo of our own edit" from "external content update" in
    // the sync effect below. Using a value comparison avoids the race
    // condition that the old boolean suppressEchoRef had with concurrent AI
    // writes: if an AI write came in between the user's onUpdate and the
    // subsequent React render, the boolean would incorrectly suppress the
    // external update.
    const [missingTarget, setMissingTarget] = useState<string | null>(null);
    useEffect(() => { setMissingTarget(null); }, [activeFile]);
    const lastEmittedMdRef   = useRef<string | null>(null);
    // Serialization of the document right after it was loaded. Tiptap's markdown
    // round-trip is lossy (spacing, escapes), so an update whose serialization
    // still equals this baseline is not a user edit and must not rewrite the file.
    const baselineRef = useRef<{ source: string; serialized: string } | null>(null);
    const aiMarksStoreRef    = useRef<AIMark[]>(aiMarks ?? []);
    const aiMarksRef         = useRef(aiMarks ?? []);
    const onAIMarkEditedRef  = useRef(onAIMarkEdited);
    const onSelCtxRef        = useRef(onSelectionContextChange);
    const onToggleFindRef    = useRef(onToggleFind);
    const onAIRequestRef     = useRef(onAIRequest);
    const activeFileRef      = useRef(activeFile);

    // Keep refs current without causing hook re-runs
    useEffect(() => { onAIMarkEditedRef.current  = onAIMarkEdited; },  [onAIMarkEdited]);
    useEffect(() => { onSelCtxRef.current         = onSelectionContextChange; }, [onSelectionContextChange]);
    useEffect(() => { onToggleFindRef.current     = onToggleFind; },    [onToggleFind]);
    useEffect(() => { onAIRequestRef.current      = onAIRequest; },     [onAIRequest]);
    useEffect(() => { activeFileRef.current       = activeFile; },      [activeFile]);
    useEffect(() => { aiMarksRef.current          = aiMarks ?? []; },   [aiMarks]);

    // ── Helpers ───────────────────────────────────────────────────────────────

    const emitSelectionCtx = useCallback((editorInstance: ReturnType<typeof useEditor>) => {
      const cb = onSelCtxRef.current;
      if (!cb || !editorInstance) return;
      const { from, to } = editorInstance.state.selection;
      if (from === to) { cb(null); return; }
      const selectedText = editorInstance.state.doc.textBetween(from, to, '\n');
      if (!selectedText.trim()) { cb(null); return; }
      const filename = activeFileRef.current?.split('/').pop() ?? 'documento atual';
      cb({
        source: 'editor',
        label: `Trecho selecionado em ${filename}`,
        content: [`Selected text from "${filename}":`, '---', selectedText.trim(), '---'].join('\n'),
      });
    }, []);

    // ── Tiptap setup ──────────────────────────────────────────────────────────

    const editor = useEditor({
      extensions: [
        StarterKit.configure({ link: { openOnClick: false } }),
        Extension.create({
          name: 'wikiLinks',
          addProseMirrorPlugins: () => [wikiLinkPlugin],
        }),
        Markdown.configure({ html: false, transformPastedText: true }),
        // AI mark decorations via a ProseMirror plugin registered as a Tiptap extension
        Extension.create({
          name: 'aiMarkDecos',
          addProseMirrorPlugins() {
            return [makeAIMarkPlugin(aiMarksStoreRef)];
          },
        }),
      ],
      content,
      editable: !isLocked,
      editorProps: {
        handleKeyDown(_view, event) {
          if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
            event.preventDefault();
            onToggleFindRef.current?.();
            return true;
          }
          if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
            event.preventDefault();
            // Pass current selection text (or empty string if no selection)
            const selection = window.getSelection()?.toString() ?? '';
            onAIRequestRef.current?.(selection);
            return true;
          }
          return false;
        },
        handlePaste(_view, event) {
          const cb = onImagePaste;
          if (!cb) return false;
          const items = event.clipboardData?.items;
          if (!items) return false;
          for (const item of Array.from(items)) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
              event.preventDefault();
              const file = item.getAsFile();
              if (!file) return false;
              // Use a local ref to avoid closure capture of possibly stale `editor`
              const editorView = editor?.view;
              cb(file).then((path) => {
                if (path && editorView) {
                  editorView.dispatch(
                    editorView.state.tr.insertText(`![](${path})`),
                  );
                }
              }).catch(() => { /* ignore */ });
              return true;
            }
          }
          return false;
        },
      },
      onCreate({ editor: ed }) {
        baselineRef.current = { source: content, serialized: serializeProse(ed) };
      },
      onUpdate({ editor: ed }) {
        // AI mark edit detection: check if any marked text was removed/changed
        const cb = onAIMarkEditedRef.current;
        if (cb) {
          const docText = ed.state.doc.textContent;
          for (const mark of aiMarksRef.current) {
            if (!docText.includes(mark.text)) {
              cb(mark.id);
            }
          }
        }
        // Emit markdown and record it so the sync effect can detect the echo.
        const serialized = serializeProse(ed);
        const baseline = baselineRef.current;
        const md = baseline && serialized === baseline.serialized
          ? baseline.source
          : restoreProseTaskMarkers(restoreProseWikiLinks(serialized, baseline?.source ?? content));
        lastEmittedMdRef.current = md;
        onChange(md);
      },
      onSelectionUpdate({ editor: ed }) {
        emitSelectionCtx(ed);
      },
      onFocus() {
        // no-op — selection context already emitted on selectionUpdate
      },
      onBlur() {
        onSelCtxRef.current?.(null);
      },
    });

    // ── Sync external content changes (AI writes, file loads) ─────────────────
    useEffect(() => {
      if (!editor || editor.isDestroyed) return;
      // If this content update is just the echo of our own onUpdate emission,
      // skip it — the editor already has this content. Clear the record so
      // any future external update (different value) will be applied.
      if (lastEmittedMdRef.current === content) {
        lastEmittedMdRef.current = null;
        return;
      }
      lastEmittedMdRef.current = null;
      editor.commands.setContent(content, { emitUpdate: false });
      baselineRef.current = { source: content, serialized: serializeProse(editor) };
    }, [editor, content]);

    // ── Sync isLocked ─────────────────────────────────────────────────────────
    useEffect(() => {
      if (!editor || editor.isDestroyed) return;
      editor.setEditable(!isLocked);
    }, [editor, isLocked]);

    // ── Sync AI marks ─────────────────────────────────────────────────────────
    useEffect(() => {
      aiMarksStoreRef.current = aiMarks ?? [];
      if (!editor || editor.isDestroyed) return;
      // Trigger a no-op transaction that causes the plugin to rebuild decorations
      editor.view.dispatch(editor.state.tr.setMeta(aiMarkKey, true));
    }, [editor, aiMarks]);

    // ── Cleanup selection ctx on unmount ──────────────────────────────────────
    useEffect(() => {
      return () => { onSelCtxRef.current?.(null); };
    }, []);

    // ── EditorHandle ──────────────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      jumpToText(target: { text: string; revert?: AITextRevert } | string): boolean {
        if (!editor) return false;
        const needle = typeof target === 'string' ? target : target.text;
        const range = findTextInDoc(editor.state.doc, needle);
        if (!range) return false;
        editor.commands.setTextSelection(range);
        editor.commands.focus();
        try {
          const domAtFrom = editor.view.domAtPos(range.from);
          const node = domAtFrom.node as Element;
          const el = node.nodeType === 1 ? node : node.parentElement;
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch { /* ignore if dom not ready */ }
        return true;
      },

      jumpToLine(lineNo: number): void {
        if (!editor) return;
        let currentLine = 0;
        let targetPos = 1;
        editor.state.doc.descendants((node, pos) => {
          if (!node.isBlock) return undefined;
          currentLine++;
          if (currentLine === lineNo) {
            targetPos = pos + 1;
            return false;
          }
          return undefined;
        });
        editor.commands.setTextSelection(targetPos);
        editor.commands.focus();
        try {
          const dom = editor.view.domAtPos(targetPos);
          const el = (dom.node as Element).nodeType === 1
            ? dom.node as Element
            : (dom.node as Element).parentElement;
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch { /* ignore */ }
      },

      getView() {
        return null;
      },

      getTiptapEditor() {
        return editor ?? null;
      },

      getMarkCoords(target: { text: string; revert?: AITextRevert } | string) {
        if (!editor) return null;
        // Use findAIMarkRange (same logic as CM6) so revert.afterText is tried
        // before mark.text — keeps ProseEditor and CodeMirror in sync.
        const docText = editor.state.doc.textContent;
        const markTarget = typeof target === 'string' ? { text: target } : target;
        const charRange = findAIMarkRange(docText, markTarget);
        if (!charRange) return null;
        const range = {
          from: charToDocPos(editor.state.doc, charRange.from),
          to: charToDocPos(editor.state.doc, charRange.to),
        };
        if (range.from === -1 || range.to === -1) return null;
        try {
          const startCoords = editor.view.coordsAtPos(range.from);
          const endCoords   = editor.view.coordsAtPos(range.to);
          return {
            top: startCoords.top,
            left: startCoords.left,
            bottom: endCoords.bottom,
            right: endCoords.right,
          };
        } catch {
          return null;
        }
      },
    }));

    function openReference(target: string) {
      if (/^https?:\/\//i.test(target)) { void openUrl(target); return; }
      const fromDir = activeFile?.split('/').slice(0, -1).join('/') ?? '';
      const resolved = resolveDocumentLink(target, fromDir,
        workspaceFileTree ? flattenFileTree(workspaceFileTree) : undefined);
      if (resolved) { setMissingTarget(null); onNavigate?.(resolved); }
      else setMissingTarget(target);
    }

    // ── Render ────────────────────────────────────────────────────────────────
    return (
      <div
        className="prose-editor-wrapper"
        data-locked={isLocked || undefined}
        data-theme={isDark ? 'dark' : 'light'}
        style={{ '--prose-font-size': `${fontSize}px` } as React.CSSProperties}
        onMouseDown={(event) => {
          // A collapsed [[reference]] behaves like a link: one click opens it.
          if (event.metaKey || event.ctrlKey || event.button !== 0) return;
          const link = (event.target as HTMLElement).closest('[data-collapsed="true"]');
          const target = link?.getAttribute('data-document-target');
          if (!target) return;
          event.preventDefault();
          openReference(target);
        }}
        onClick={(event) => {
          if (!event.metaKey && !event.ctrlKey) return;
          const link = (event.target as HTMLElement).closest('[data-document-target], a[href]');
          const target = link?.getAttribute('data-document-target') ?? link?.getAttribute('href');
          if (!target) return;
          event.preventDefault();
          openReference(target);
        }}
      >
        {editor && !isLocked && <SelectionMenu editor={editor} onAIRequest={onAIRequest} />}
        <div className="tiptap-content" data-notes={hasMarginNotes || undefined}>
          <div className="prose-page">
            {kicker && <div className="prose-kicker">{kicker}</div>}
            <EditorContent editor={editor} />
          </div>
        </div>
        {missingTarget && <p className="md-missing-link" role="status">
          Referência não encontrada: {missingTarget}. Nenhum arquivo foi criado.
        </p>}
      </div>
    );
  },
);

ProseEditor.displayName = 'ProseEditor';
export default ProseEditor;
