import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { yaml } from '@codemirror/lang-yaml';
import { xml } from '@codemirror/lang-xml';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { php } from '@codemirror/lang-php';
import { sql } from '@codemirror/lang-sql';
import { vue } from '@codemirror/lang-vue';
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { r } from '@codemirror/legacy-modes/mode/r';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap, ViewPlugin, WidgetType } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { defaultKeymap, historyKeymap, history, indentWithTab } from '@codemirror/commands';
import { StateField, RangeSetBuilder, Compartment, Prec } from '@codemirror/state';
import { Decoration, DecorationSet } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { linter, setDiagnostics } from '@codemirror/lint';
import type { Diagnostic } from '@codemirror/lint';
import { search, SearchCursor, RegExpCursor, getSearchQuery } from '@codemirror/search';
// ── Custom search match highlighter ─────────────────────────────────────────
// CodeMirror's built-in searchHighlighter only fires when the native search
// panel is open (panel != null). Since we use our own FindReplaceBar without
// ever opening the native panel, we provide our own ViewPlugin that highlights
// all occurrences based on the active SearchQuery, regardless of panel state.
const _searchMatchMark = Decoration.mark({ class: 'cm-searchMatch' });
const _searchMatchSelectedMark = Decoration.mark({ class: 'cm-searchMatch cm-searchMatch-selected' });
const externalSearchHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }
    update(update: ViewUpdate) {
      const prev = getSearchQuery(update.startState);
      const cur = getSearchQuery(update.state);
      if (update.docChanged || update.viewportChanged || update.selectionSet || prev !== cur) {
        this.decorations = this.buildDecorations(update.view);
      }
    }
    buildDecorations(view: EditorView): DecorationSet {
      const q = getSearchQuery(view.state);
      if (!q.search) return Decoration.none;
      const builder = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        if (q.regexp) {
          try {
            const c = new RegExpCursor(view.state.doc, q.search, { ignoreCase: !q.caseSensitive }, from, to);
            while (!c.next().done) {
              const { from: f, to: t } = c.value;
              const sel = view.state.selection.ranges.some(r => r.from === f && r.to === t);
              builder.add(f, t, sel ? _searchMatchSelectedMark : _searchMatchMark);
            }
          } catch { /* invalid regex — skip */ }
        } else {
          const norm = q.caseSensitive ? undefined : (s: string) => s.toLowerCase();
          const c = new SearchCursor(view.state.doc, q.search, from, to, norm);
          while (!c.next().done) {
            const { from: f, to: t } = c.value;
            const sel = view.state.selection.ranges.some(r => r.from === f && r.to === t);
            builder.add(f, t, sel ? _searchMatchSelectedMark : _searchMatchMark);
          }
        }
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);


import { makeLivePreviewExtension } from '../utils/livePreview';
import { Fragment, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  TextB, TextItalic, TextStrikethrough, Code,
  Minus, Quotes, ListBullets, ListNumbers,
  Link, Image, CodeBlock, Table, Sigma,
  TextAlignLeft, TextAlignCenter, TextAlignRight, TextAlignJustify,
  Highlighter, ListChecks, TextIndent, TextOutdent,
} from '@phosphor-icons/react';
import type { AISelectionContext, AITextRevert } from '../types';
import { findAIMarkOccurrences, findAIMarkRange } from '../utils/aiMarkMatch';
import './Editor.css';

// ── Public handle exposed via ref ─────────────────────────────────────────────
export interface EditorHandle {
  /** Select and scroll to the first occurrence of `text` in the document.
   *  Returns true if found. */
  jumpToText(target: { text: string; revert?: AITextRevert } | string): boolean;
  /** Move the cursor to a specific 1-based line number and centre the viewport. */
  jumpToLine(lineNo: number): void;
  /** Expose the raw CodeMirror EditorView so external search bars can drive it. */
  getView(): EditorView | null;
  /**
   * Returns the client-relative bounding rect of the first occurrence of `text`
   * in the editor, or null if the text isn't found.
   */
  getMarkCoords(target: { text: string; revert?: AITextRevert } | string): { top: number; left: number; bottom: number; right: number } | null;
}

interface EditorProps {
  content: string;
  onChange: (value: string) => void;
  onToggleFind?: () => void;
  onAIRequest?: (selectedText: string) => void;
  /** When true the editor becomes read-only — shown while Copilot is writing this file. */
  isLocked?: boolean;
  /**
   * AI-generated marks to highlight.  Each entry carries the mark id and the
   * exact inserted text so edits inside a marked range auto-promote to reviewed.
   */
  aiMarks?: { id: string; text: string; revert?: AITextRevert }[];
  /** Called when the user edits content that falls inside an AI-marked range. */
  onAIMarkEdited?: (markId: string) => void;
  /** Editor font size in pixels (default 14) */
  fontSize?: number;
  /** Whether the app is in dark mode — controls CodeMirror base theme (default true) */
  isDark?: boolean;
  /**
   * Called when the user pastes an image from the clipboard.
   * Should save the file and return its workspace-relative path (e.g. "images/paste-xxx.png"),
   * or null on failure.  When provided, a Markdown image reference is auto-inserted.
   */
  onImagePaste?: (file: File) => Promise<string | null>;
  /**
   * CodeMirror language hint: 'markdown' (default), 'html', 'css',
   * 'javascript', 'typescript', 'json', 'python', 'rust', 'yaml', 'shell', …
   * When set to anything other than 'markdown' (or empty), the editor switches
   * to a full-width code-editor layout with appropriate syntax highlighting.
   */
  language?: string;
  /**
   * Called when the user clicks the Format button in code mode.
   * The callback receives the current content and should return the formatted string.
   */
  onFormat?: () => void;
  /**
   * CodeMirror diagnostics (errors/warnings) to display as inline squiggles.
   * Typically produced by `useTsDiagnostics` for TypeScript/JavaScript files.
   */
  diagnostics?: Diagnostic[];
  /**
   * Async function that returns a ghost-text completion for the current cursor context.
   * When provided, ghost text (Tab to accept, Escape to dismiss) is active in all modes.
   */

  activeFile?: string;
  onSelectionContextChange?: (context: AISelectionContext | null) => void;
}

// ── AI-mark decoration helpers ────────────────────────────────────────────────
class AIRemovedTextWidget extends WidgetType {
  constructor(private readonly beforeText: string) {
    super();
  }

  eq(other: AIRemovedTextWidget): boolean {
    return other.beforeText === this.beforeText;
  }

  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-ai-removed-block';

    const prefix = document.createElement('span');
    prefix.className = 'cm-ai-removed-prefix';
    prefix.textContent = 'Old';

    const text = document.createElement('span');
    text.className = 'cm-ai-removed-text';
    text.textContent = this.beforeText;

    wrap.append(prefix, text);
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildAIDecorations(docText: string, marks: Array<{ text: string; revert?: AITextRevert }>): DecorationSet {
  const markDeco = Decoration.mark({ class: 'cm-ai-mark' });

  // Collect all decorations into a single array so we can sort them together.
  // RangeSetBuilder requires entries in ascending (from, startSide) order.
  type DecoEntry = { from: number; to: number; deco: Decoration; side: number };
  const entries: DecoEntry[] = [];

  // Mark decorations (highlighted ranges)
  const sortedRanges = marks.flatMap((target) => findAIMarkOccurrences(docText, target));
  sortedRanges.sort((a, b) => a.from - b.from);
  let prevTo = -1;
  for (const r of sortedRanges) {
    if (r.from >= prevTo && r.from < r.to) {
      entries.push({ from: r.from, to: r.to, deco: markDeco, side: 0 });
      prevTo = r.to;
    }
  }

  // Widget decorations for "removed text" (revert blocks), side: -1
  for (const target of marks) {
    if (!target.revert?.beforeText.trim()) continue;
    const range = findAIMarkRange(docText, target);
    if (!range || range.from < 0 || range.from > range.to) continue;
    entries.push({
      from: range.from,
      to: range.from,
      deco: Decoration.widget({
        widget: new AIRemovedTextWidget(target.revert.beforeText),
        side: -1,
        block: true,
      }),
      side: -1,
    });
  }

  // Sort by position; at the same position, widgets (side -1) precede marks (side 0)
  entries.sort((a, b) => a.from !== b.from ? a.from - b.from : a.side - b.side);

  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, deco } of entries) {
    builder.add(from, to, deco);
  }
  return builder.finish();
}

function makeAIMarkField(marks: Array<{ text: string; revert?: AITextRevert }>) {
  return StateField.define<DecorationSet>({
    create(state) {
      // Bail out before the O(n) doc.toString() when there are no marks to show.
      if (marks.length === 0) return Decoration.none;
      return buildAIDecorations(state.doc.toString(), marks);
    },
    update(decs, tr) {
      if (marks.length === 0) return Decoration.none;
      return tr.docChanged
        ? buildAIDecorations(tr.newDoc.toString(), marks)
        : decs;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

// ── Paper light syntax highlight style ───────────────────────────────────────
const creamHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword,                        color: '#275b99', fontWeight: '500' },
  { tag: tags.controlKeyword,                 color: '#6b4aa5' },
  { tag: [tags.string, tags.special(tags.string)], color: '#2b6a4a' },
  { tag: tags.regexp,                         color: '#a34a44' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#756b60', fontStyle: 'italic' },
  { tag: [tags.number, tags.integer, tags.float], color: '#8b6527' },
  { tag: tags.bool,                           color: '#8b6527', fontWeight: '500' },
  { tag: tags.null,                           color: '#8b6527' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#6b4aa5' },
  { tag: [tags.typeName, tags.namespace], color: '#8b6527' },
  { tag: tags.className,                      color: '#8b6527', fontWeight: '600' },
  { tag: tags.definition(tags.variableName),  color: '#176b60' },
  { tag: tags.definition(tags.propertyName),  color: '#176b60' },
  { tag: tags.operator,                       color: '#5d5750' },
  { tag: tags.punctuation,                    color: '#877d72' },
  { tag: tags.propertyName,                   color: '#40362b' },
  { tag: tags.attributeName,                  color: '#275b99' },
  { tag: tags.attributeValue,                 color: '#2b6a4a' },
  { tag: [tags.url, tags.link],               color: '#176b60', textDecoration: 'underline' },
  { tag: tags.tagName,                        color: '#a34a44', fontWeight: '500' },
  { tag: tags.angleBracket,                   color: '#877d72' },
  { tag: tags.heading,                        color: '#221c16', fontWeight: 'bold' },
  { tag: tags.emphasis,                       fontStyle: 'italic', color: '#64594b' },
  { tag: tags.strong,                         fontWeight: '700', color: '#31281f' },
  { tag: tags.strikethrough,                  textDecoration: 'line-through', color: '#756b60' },
  { tag: tags.meta,                           color: '#756b60' },
  { tag: tags.invalid,                        color: '#a34a44', textDecoration: 'underline wavy' },
  { tag: tags.deleted,                        color: '#a34a44', textDecoration: 'line-through' },
  { tag: tags.inserted,                       color: '#2b6a4a' },
  { tag: tags.changed,                        color: '#8b6527' },
  { tag: tags.self,                           color: '#275b99', fontStyle: 'italic' },
  { tag: tags.atom,                           color: '#8b6527' },
  { tag: tags.annotation,                     color: '#6b4aa5' },
]);

// ── Cream editor UI theme (backgrounds, gutters, panels) ──────────────────────
const creamEditorTheme = EditorView.theme({
  '&': {
    background: 'var(--surface)',
    color: 'var(--text)',
  },
  '.cm-gutters': {
    background: 'var(--surface2)',
    color: 'var(--text-dim)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLineGutter': {
    background: 'var(--surface-deep)',
  },
  '.cm-activeLine': {
    background: 'rgba(0, 0, 0, 0.028)',
  },
  '.cm-searchMatch': {
    background: 'rgba(143, 90, 18, 0.16)',
    outline: '1px solid rgba(143, 90, 18, 0.32)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    background: 'rgba(23, 107, 96, 0.18)',
  },
  '.cm-selectionMatch': {
    background: 'rgba(23, 107, 96, 0.08)',
  },
  '.cm-panels': {
    background: 'var(--surface2)',
    color: 'var(--text)',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid var(--border)',
  },
  '.cm-tooltip': {
    background: 'var(--surface)',
    border: '1px solid var(--border2)',
    color: 'var(--text)',
  },
  '.cm-completionLabel': {
    color: 'var(--text)',
  },
  '.cm-completionDetail': {
    color: 'var(--text-muted)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    background: 'var(--accent-bg)',
    color: 'var(--accent)',
  },
  '.cm-foldPlaceholder': {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
  },
}, { dark: false });

// Bundled as a single extension for use as theme prop
const creamTheme = [creamEditorTheme, syntaxHighlighting(creamHighlightStyle, { fallback: true })];

// ── Theme ─────────────────────────────────────────────────────────────────────
function makeEditorTheme(fontSize: number, codeMode = false, isDark = true) {
  const cursorColor    = isDark ? '#4ec9b0' : '#1a7a6d';
  const selectionBg    = isDark ? '#3b3026' : 'rgba(23, 107, 96, 0.13)';
  const aiMarkBg       = isDark ? 'rgba(212, 169, 106, 0.15)'  : 'rgba(143, 90, 18, 0.09)';
  const aiMarkBorderB  = isDark ? 'rgba(212, 169, 106, 0.7)'   : 'rgba(143, 90, 18, 0.42)';
  const aiMarkBorderS  = isDark ? 'rgba(212, 169, 106, 0.3)'   : 'rgba(143, 90, 18, 0.18)';
  const aiMarkShadow   = isDark ? 'rgba(212, 169, 106, 0.1)'   : 'rgba(143, 90, 18, 0.05)';
  return EditorView.theme({
    '&': {
      height: '100%',
      fontSize: `${fontSize}px`,
      fontFamily: '"Maple Mono", "Fira Code", "Cascadia Code", "JetBrains Mono", monospace',
    },
    '.cm-scroller': {
      overflow: 'auto',
      overscrollBehavior: 'contain',
      padding: '0 0 120px 0',
    },
    '.cm-content': {
      // Prose mode: centred 720px column.  Code mode: full width, tighter padding.
      maxWidth: codeMode ? 'none' : '720px',
      margin: codeMode ? '0' : '0 auto',
      padding: codeMode ? '24px 16px' : '48px 24px',
      caretColor: cursorColor,
      lineHeight: codeMode ? '1.55' : '1.75',
    },
    '.cm-line': {
      padding: '0',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-cursor': {
      borderLeftColor: cursorColor,
      borderLeftWidth: '2px',
    },
    '.cm-selectionBackground': {
      background: `${selectionBg} !important`,
    },
    '.cm-ai-mark': {
      backgroundColor: aiMarkBg,
      borderBottom: `2px solid ${aiMarkBorderB}`,
      borderTop:    `1px solid ${aiMarkBorderS}`,
      borderLeft:   `1px solid ${aiMarkBorderS}`,
      borderRight:  `1px solid ${aiMarkBorderS}`,
      borderRadius: '2px',
      boxShadow: `0 0 0 1px ${aiMarkShadow}`,
    },
    '.cm-ai-removed-block': {
      display: 'block',
      margin: '4px 0 6px',
      padding: '4px 8px',
      whiteSpace: 'pre-wrap',
      borderRadius: '6px',
      borderLeft: `3px solid ${isDark ? 'rgba(216, 120, 120, 0.7)' : 'rgba(179, 72, 72, 0.7)'}`,
      backgroundColor: isDark ? 'rgba(120, 42, 42, 0.14)' : 'rgba(214, 107, 107, 0.1)',
      color: isDark ? '#f0b3b3' : '#9e3b3b',
      boxSizing: 'border-box',
    },
    '.cm-ai-removed-prefix': {
      marginRight: '8px',
      fontSize: '0.76em',
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      textDecoration: 'none',
      opacity: '0.85',
    },
    '.cm-ai-removed-text': {
      textDecoration: 'line-through',
      textDecorationThickness: '1.5px',
    },
  }, { dark: isDark });
}

// ── Language extension resolver ───────────────────────────────────────────────
function getLanguageExtension(language: string): Extension {
  switch (language) {
    // ── First-class CodeMirror language packages ─────────────────────────────
    case 'html':        return html({ selfClosingTags: true });
    case 'css':         return css();
    case 'javascript':  return javascript({ jsx: true });
    case 'typescript':  return javascript({ jsx: true, typescript: true });
    case 'json':        return json();
    case 'python':      return python();
    case 'rust':        return rust();
    case 'yaml':        return yaml();
    case 'xml':         return xml();
    case 'go':          return go();
    case 'java':        return java();
    case 'cpp':         return cpp();
    case 'php':         return php();
    case 'sql':         return sql();
    case 'vue':         return vue();
    // Kotlin: no dedicated CM package; Java grammar gives reasonable highlighting
    case 'kotlin':      return java();
    // ── Legacy-mode languages (StreamLanguage wrapper) ───────────────────────
    case 'shell':       return StreamLanguage.define(shell);
    case 'toml':        return StreamLanguage.define(toml);
    case 'ruby':        return StreamLanguage.define(ruby);
    case 'lua':         return StreamLanguage.define(lua);
    case 'swift':       return StreamLanguage.define(swift);
    case 'diff':        return StreamLanguage.define(diff);
    case 'powershell':  return StreamLanguage.define(powerShell);
    case 'r':           return StreamLanguage.define(r);
    case 'perl':        return StreamLanguage.define(perl);
    // ── Markdown is handled by the outer branch; any unknown = plain text ────
    default:            return [];
  }
}

const DEFAULT_FONT_SIZE = 14;

function buildSelectionContext(selectedText: string, activeFile?: string): AISelectionContext | null {
  const trimmed = selectedText.trim();
  if (!trimmed) return null;
  const filename = activeFile?.split('/').pop() ?? 'documento atual';
  return {
    source: 'editor',
    label: `Trecho selecionado em ${filename}`,
    content: [`Selected text from "${filename}":`, '---', trimmed, '---'].join('\n'),
  };
}

// ── Markdown toolbar ─────────────────────────────────────────────────────────
type PhosphorIcon = React.ComponentType<{ size?: number; weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone' }>;

interface ToolbarItem {
  title: string;
  icon?: PhosphorIcon;
  text?: string;
  wrap?: readonly [string, string];
  prefix?: string;
  insert?: string;
  link?: true;
  image?: true;
  codeBlock?: true;
  table?: true;
  mathBlock?: true;
  align?: 'left' | 'center' | 'right' | 'justify';
  highlight?: true;
  checklist?: true;
  superscript?: true;
  subscript?: true;
  indent?: 'in' | 'out';
}

const MD_TOOLBAR_GROUPS: ToolbarItem[][] = [
  // ── Inline formatting ──────────────────────────────────────────────────────
  [
    { icon: TextB,             title: 'Negrito (⌘B)',            wrap: ['**', '**'] },
    { icon: TextItalic,        title: 'Itálico (⌘I)',            wrap: ['_', '_']   },
    { icon: TextStrikethrough, title: 'Tachado',                 wrap: ['~~', '~~'] },
    { icon: Code,              title: 'Código inline',           wrap: ['`', '`']   },
    { icon: Highlighter,       title: 'Realçar (highlight)',     highlight: true    },
  ],
  // ── Headings ───────────────────────────────────────────────────────────────
  [
    { text: 'H1', title: 'Título 1  (# )',    prefix: '# '   },
    { text: 'H2', title: 'Título 2  (## )',   prefix: '## '  },
    { text: 'H3', title: 'Título 3  (### )',  prefix: '### ' },
  ],
  // ── Block structure ────────────────────────────────────────────────────────
  [
    { icon: Minus,       title: 'Divisor horizontal',    insert: '\n---\n' },
    { icon: Quotes,      title: 'Citação',               prefix: '> '      },
    { icon: ListBullets, title: 'Lista com marcadores',  prefix: '- '      },
    { icon: ListNumbers, title: 'Lista numerada',        prefix: '1. '     },
    { icon: ListChecks,  title: 'Lista de tarefas',      checklist: true   },
  ],
  // ── Insert ─────────────────────────────────────────────────────────────────
  [
    { icon: Link,      title: 'Link',                     link: true      },
    { icon: Image,     title: 'Imagem',                   image: true     },
    { icon: CodeBlock, title: 'Bloco de código',          codeBlock: true },
    { icon: Table,     title: 'Tabela',                   table: true     },
    { icon: Sigma,     title: 'Bloco matemático (KaTeX)', mathBlock: true },
  ],
  // ── Alignment ───────────────────────────────────────────────────────────────
  [
    { icon: TextAlignLeft,    title: 'Alinhar à esquerda', align: 'left'    },
    { icon: TextAlignCenter,  title: 'Centralizar',         align: 'center'  },
    { icon: TextAlignRight,   title: 'Alinhar à direita',  align: 'right'   },
    { icon: TextAlignJustify, title: 'Justificar',          align: 'justify' },
  ],
  // ── Superscript / subscript + indent ────────────────────────────────────────
  [
    { text: 'x²', title: 'Sobrescrito (superscript)', superscript: true },
    { text: 'x₂', title: 'Subscrito (subscript)',     subscript: true   },
  ],
  [
    { icon: TextIndent,  title: 'Aumentar recuo', indent: 'in'  },
    { icon: TextOutdent, title: 'Diminuir recuo', indent: 'out' },
  ],
];

function applyMdToolbar(
  view: import('@codemirror/view').EditorView,
  item: ToolbarItem,
) {
  const state = view.state;
  const { from, to } = state.selection.main;
  const sel = state.sliceDoc(from, to);

  let insert = '';
  let anchor = from;
  let head = from;

  if (item.wrap) {
    const [before, after] = item.wrap;
    insert = before + (sel || 'text') + after;
    anchor = from + before.length;
    head = anchor + (sel || 'text').length;
  } else if (item.prefix) {
    const lineStart = state.doc.lineAt(from).from;
    view.dispatch({ changes: { from: lineStart, insert: item.prefix } });
    view.focus();
    return;
  } else if (item.insert) {
    insert = item.insert;
    anchor = head = from + insert.length;
  } else if (item.link) {
    insert = `[${sel || 'text'}](url)`;
    anchor = from + 1;
    head = from + 1 + (sel || 'text').length;
  } else if (item.image) {
    insert = `![${sel || 'alt text'}](url)`;
    anchor = from + 2;
    head = from + 2 + (sel || 'alt text').length;
  } else if (item.codeBlock) {
    insert = '```\n' + (sel || '') + '\n```';
    anchor = from + 4;
    head = anchor + (sel || '').length;
  } else if (item.table) {
    insert = '| Col 1 | Col 2 |\n|-------|-------|\n| cell  | cell  |';
    anchor = head = from + insert.length;
  } else if (item.mathBlock) {
    insert = '$$\n' + (sel || 'expression') + '\n$$';
    anchor = from + 3;
    head = anchor + (sel || 'expression').length;
  } else if (item.align) {
    const inner = sel || 'texto';
    const prefix = `<div style="text-align: ${item.align}">\n\n`;
    const suffix = '\n\n</div>';
    insert = prefix + inner + suffix;
    anchor = from + prefix.length;
    head = anchor + inner.length;
  } else if (item.highlight) {
    insert = `<mark>${sel || 'texto'}</mark>`;
    anchor = from + 6; // len('<mark>')
    head = anchor + (sel || 'texto').length;
  } else if (item.checklist) {
    const lineStart = state.doc.lineAt(from).from;
    view.dispatch({ changes: { from: lineStart, insert: '- [ ] ' } });
    view.focus();
    return;
  } else if (item.superscript) {
    insert = `<sup>${sel || 'texto'}</sup>`;
    anchor = from + 5;
    head = anchor + (sel || 'texto').length;
  } else if (item.subscript) {
    insert = `<sub>${sel || 'texto'}</sub>`;
    anchor = from + 5;
    head = anchor + (sel || 'texto').length;
  } else if (item.indent) {
    // Apply to every selected line
    const { from: selFrom, to: selTo } = state.selection.main;
    const startLine = state.doc.lineAt(selFrom).number;
    const endLine   = state.doc.lineAt(selTo).number;
    const changes: { from: number; to?: number; insert: string }[] = [];
    for (let ln = startLine; ln <= endLine; ln++) {
      const line = state.doc.line(ln);
      if (item.indent === 'in') {
        changes.push({ from: line.from, insert: '  ' });
      } else {
        // Remove up to 2 leading spaces
        const spaces = line.text.match(/^( {1,2})/)?.[1]?.length ?? 0;
        if (spaces > 0) changes.push({ from: line.from, to: line.from + spaces, insert: '' });
      }
    }
    if (changes.length) view.dispatch({ changes });
    view.focus();
    return;
  }

  if (insert) {
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor, head },
    });
  }
  view.focus();
}

// ── Component ─────────────────────────────────────────────────────────────────
const Editor = forwardRef<EditorHandle, EditorProps>(
  ({ content, onChange, onToggleFind, onAIRequest, aiMarks, onAIMarkEdited, fontSize = DEFAULT_FONT_SIZE, onImagePaste, language, isDark = true, isLocked = false, onFormat, diagnostics, activeFile, onSelectionContextChange }, ref) => {
    const codeMode = !!language && language !== 'markdown';
    const viewRef = useRef<EditorView | null>(null);
    const compartmentRef = useRef(new Compartment());
    const fontCompartmentRef = useRef(new Compartment());
    const editableCompartmentRef = useRef(new Compartment());
    const lintCompartmentRef = useRef(new Compartment());

    // Stable refs so the single update-listener always sees the latest values
    // without needing to be recreated on every render.
    const aiMarksRef = useRef<{ id: string; text: string; revert?: AITextRevert }[]>([]);
    const onAIMarkEditedRef = useRef<((id: string) => void) | undefined>(undefined);
    const onSelectionContextChangeRef = useRef<typeof onSelectionContextChange>(undefined);
    const onToggleFindRef = useRef(onToggleFind);
    aiMarksRef.current = aiMarks ?? [];
    onAIMarkEditedRef.current = onAIMarkEdited;
    onSelectionContextChangeRef.current = onSelectionContextChange;
    onToggleFindRef.current = onToggleFind;

    // Live preview: hides Markdown syntax markers on lines without the cursor.
    // Only active in prose mode — codeMode is stable per mount so empty deps is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const livePreviewExtension = useMemo(() => (codeMode ? [] : makeLivePreviewExtension()), []);

    const emitSelectionContext = useCallback((view: EditorView | null) => {
      const callback = onSelectionContextChangeRef.current;
      if (!callback) return;
      if (!view) {
        callback(null);
        return;
      }
      const { from, to } = view.state.selection.main;
      const selection = from === to ? '' : view.state.sliceDoc(from, to);
      callback(buildSelectionContext(selection, activeFile));
    }, [activeFile]);

    // Created once – reads from refs so it stays live without cycling extensions.
    const aiMarkEditListener = useMemo(
      () =>
        EditorView.updateListener.of((update) => {
          if (update.selectionSet || update.focusChanged || update.docChanged) {
            emitSelectionContext(update.view);
          }
          if (!update.docChanged) return;
          const callback = onAIMarkEditedRef.current;
          if (!callback) return;
          const marks = aiMarksRef.current;
          if (marks.length === 0) return;

          const oldDoc = update.startState.doc.toString();
          const alreadyFired = new Set<string>();

          update.changes.iterChangedRanges((fromA, toA) => {
            for (const mark of marks) {
              if (alreadyFired.has(mark.id)) continue;
              for (const range of findAIMarkOccurrences(oldDoc, mark)) {
                if (range.from < toA && range.to > fromA) {
                  alreadyFired.add(mark.id);
                  callback(mark.id);
                  break;
                }
              }
            }
          });
        }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [], // intentionally empty — refs handle the live values
    );

      useEffect(() => {
        emitSelectionContext(viewRef.current);
        return () => onSelectionContextChangeRef.current?.(null);
      }, [emitSelectionContext]);

    useImperativeHandle(ref, () => ({
      jumpToText(target: { text: string; revert?: AITextRevert } | string): boolean {
        const view = viewRef.current;
        if (!view) return false;
        const range = findAIMarkRange(view.state.doc.toString(), target);
        if (!range) return false;
        view.dispatch({
          selection: { anchor: range.from, head: range.to },
          scrollIntoView: true,
          effects: EditorView.scrollIntoView(range.from, { y: 'center' }),
        });
        view.focus();
        return true;
      },
      jumpToLine(lineNo: number): void {
        const view = viewRef.current;
        if (!view) return;
        const clampedLine = Math.max(1, Math.min(lineNo, view.state.doc.lines));
        const line = view.state.doc.line(clampedLine);
        view.dispatch({
          selection: { anchor: line.from },
          scrollIntoView: true,
          effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
        });
        view.focus();
      },
      getView(): EditorView | null {
        return viewRef.current;
      },
      getMarkCoords(target: { text: string; revert?: AITextRevert } | string): { top: number; left: number; bottom: number; right: number } | null {
        const view = viewRef.current;
        if (!view) return null;
        const range = findAIMarkRange(view.state.doc.toString(), target);
        if (!range) return null;
        const coords = view.coordsAtPos(range.from);
        if (!coords) return null;
        return { top: coords.top, left: coords.left, bottom: coords.bottom, right: coords.right };
      },
    }));

    useEffect(() => {
      if (!viewRef.current) return;
      viewRef.current.dispatch({
        effects: compartmentRef.current.reconfigure(
          makeAIMarkField(aiMarks ?? []),
        ),
      });
    }, [aiMarks]);

    // Reconfigure font size / theme dynamically
    useEffect(() => {
      if (!viewRef.current) return;
      viewRef.current.dispatch({
        effects: fontCompartmentRef.current.reconfigure(makeEditorTheme(fontSize, codeMode, isDark)),
      });
    }, [fontSize, codeMode, isDark]);

    // Toggle read-only when Copilot locks/unlocks this file
    useEffect(() => {
      if (!viewRef.current) return;
      viewRef.current.dispatch({
        effects: editableCompartmentRef.current.reconfigure(EditorView.editable.of(!isLocked)),
      });
    }, [isLocked]);

    // Push TypeScript / JS diagnostics as inline squiggles
    useEffect(() => {
      if (!viewRef.current) return;
      viewRef.current.dispatch(setDiagnostics(viewRef.current.state, diagnostics ?? []));
    }, [diagnostics]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'f') {
          e.preventDefault();
          e.stopPropagation();
          onToggleFind?.();
          return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          const selection = window.getSelection()?.toString() ?? '';
          onAIRequest?.(selection);
          return;
        }
        // ⌥F — format code file (mirrors the header button)
        // On macOS ⌥F produces 'ƒ'; on other platforms e.altKey + 'f'
        if (codeMode && (e.key === 'ƒ' || (e.altKey && e.key === 'f'))) {
          e.preventDefault();
          onFormat?.();
          return;
        }
        if (!codeMode && (e.metaKey || e.ctrlKey)) {
          const view = viewRef.current;
          if (!view) return;
          if (e.key === 'b') { e.preventDefault(); applyMdToolbar(view, MD_TOOLBAR_GROUPS[0][0]); return; }
          if (e.key === 'i') { e.preventDefault(); applyMdToolbar(view, MD_TOOLBAR_GROUPS[0][1]); return; }
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [onAIRequest, onFormat, onToggleFind, codeMode],
    );

    // ── Clipboard image paste ─────────────────────────────────────────────────
    const handlePaste = useCallback(
      async (e: React.ClipboardEvent<HTMLDivElement>) => {
        if (!onImagePaste) return;
        const items = Array.from(e.clipboardData?.items ?? []);
        const imageItem = items.find((item) => item.type.startsWith('image/'));
        if (!imageItem) return;
        // There is an image — prevent CodeMirror's default paste handling
        e.preventDefault();
        const file = imageItem.getAsFile();
        if (!file) return;
        const relPath = await onImagePaste(file);
        if (!relPath) return;
        const view = viewRef.current;
        if (!view) return;
        const pos = view.state.selection.main.head;
        const mdImage = `![](${ relPath })`;
        view.dispatch({
          changes: { from: pos, insert: mdImage },
          selection: { anchor: pos + mdImage.length },
        });
      },
      [onImagePaste],
    );

    // ── Uncontrolled CodeMirror value — eliminates O(n) doc.toString() per keystroke ─
    // @uiw/react-codemirror's internal `[value, view]` useEffect calls
    // `view.state.doc.toString()` on every render where `value` changed.
    // By keeping `cmValue` stable during typing and only changing it for
    // external updates (AI writes, file loads, format), we skip that effect
    // entirely during normal editing. suppressEchoRef prevents the external-
    // update effect from firing on content changes that originated from CM.
    const [cmValue, setCmValue] = useState(content);
    const suppressEchoRef = useRef(false);
    useEffect(() => {
      if (suppressEchoRef.current) { suppressEchoRef.current = false; return; }
      setCmValue(content);
    }, [content]);
    const handleCodeMirrorChange = useCallback((value: string) => {
      suppressEchoRef.current = true;
      onChange(value);
    }, [onChange]);

    // Memoised so @uiw/react-codemirror does NOT call StateEffect.reconfigure
    // (the most expensive CodeMirror operation) on every re-render / keystroke.
    // Deps: only the things that fundamentally change the editor mode.
    // Runtime changes (aiMarks, fontSize, isDark, isLocked, diagnostics) are
    // handled by their own compartment useEffect()s below without touching this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const extensions = useMemo(() => [
      // Language: use markdown (+ embedded code blocks) for prose, or the
      // file-specific grammar for code files.
      codeMode
        ? getLanguageExtension(language ?? '')
        : markdown({ base: markdownLanguage }),
      // Initialize CodeMirror search state so the custom FindReplaceBar can
      // drive search commands without ever needing the native search panel.
      search(),
      // Custom highlighter — shows cm-searchMatch decorations without panel.
      externalSearchHighlight,
      editableCompartmentRef.current.of(EditorView.editable.of(!isLocked)),
      history(),
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-f',
            preventDefault: true,
            run: () => {
              // Use ref so we always call the latest onToggleFind without
              // needing it in the useMemo deps (which would recreate extensions).
              onToggleFindRef.current?.();
              return true;
            },
          },
        ]),
      ),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        // Tab key inserts real indentation in code files.
        // Note: searchKeymap intentionally excluded — FindReplaceBar handles all
        // search/replace for both prose and code modes (Cmd+F from App.tsx).
        ...(codeMode ? [indentWithTab] : []),
      ]),
      fontCompartmentRef.current.of(makeEditorTheme(fontSize, codeMode, isDark)),
      // Prose wraps; code does not
      ...(codeMode ? [] : [EditorView.lineWrapping]),
      // Set attributes directly on the .cm-content contenteditable so Grammarly
      // Desktop (macOS) sees spellcheck=true and activates. CM defaults to
      // spellcheck=false, which silently tells Grammarly to stay off.
      EditorView.contentAttributes.of(codeMode
        ? { spellcheck: 'false' }
        : { spellcheck: 'true', 'data-enable-grammarly': 'true' },
      ),
      compartmentRef.current.of(makeAIMarkField(aiMarks ?? [])),
      aiMarkEditListener,
      // Lint state field — active in code mode; provides squiggles for TS/JS errors
      lintCompartmentRef.current.of(codeMode ? linter(() => []) : []),
      // Live preview: hide syntax markers on non-cursor lines (prose only)
      livePreviewExtension,
    // codeMode and language are the only props that require a full editor
    // reconfiguration. Everything else uses compartments or stable refs.
    ], [codeMode, language]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
      <div className="editor-wrapper" onKeyDown={handleKeyDown} onPaste={handlePaste} data-locked={isLocked ? 'true' : undefined}>
        {/* ── Markdown formatting toolbar ── */}
        {!codeMode && (
          <div className="editor-md-toolbar" aria-label="Formatação Markdown" role="toolbar">
            {MD_TOOLBAR_GROUPS.map((group, gi) => (
              <Fragment key={gi}>
                {gi > 0 && <span className="editor-md-toolbar-sep" aria-hidden="true" />}
                {group.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.title}
                      className={`editor-md-toolbar-btn${!Icon ? ' btn-heading' : ''}`}
                      title={item.title}
                      aria-label={item.title}
                      onMouseDown={(e) => {
                        e.preventDefault(); // prevent blur
                        const view = viewRef.current;
                        if (view) applyMdToolbar(view, item);
                      }}
                    >
                      {Icon ? <Icon size={15} weight="regular" /> : <span className="editor-md-toolbar-label">{item.text}</span>}
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </div>
        )}
        {/* Format button lives in the app header (⌥F) — no in-editor toolbar */}
        <CodeMirror
          value={cmValue}
          onChange={handleCodeMirrorChange}
          extensions={extensions}
          theme={isDark ? oneDark : creamTheme}
          height="100%"
          onCreateEditor={(view) => {
            viewRef.current = view;
            emitSelectionContext(view);
          }}
          basicSetup={{
            lineNumbers: codeMode,
            foldGutter: codeMode,
            dropCursor: true,
            allowMultipleSelections: true,
            indentOnInput: true,
            bracketMatching: true,
            closeBrackets: true,
            // Autocompletion active in code mode only
            autocompletion: codeMode,
            rectangularSelection: codeMode,
            // Active line gutter highlight in code mode
            highlightActiveLine: codeMode,
            highlightActiveLineGutter: codeMode,
            highlightSelectionMatches: true,
            closeBracketsKeymap: true,
            // Search handled by our FindReplaceBar in prose mode;
            // in code mode we also wire in CM's own search keymap above.
            searchKeymap: false,
            tabSize: 2,
          }}
        />
      </div>
    );
  },
);

Editor.displayName = 'Editor';
export default Editor;
