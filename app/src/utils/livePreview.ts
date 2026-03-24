/**
 * Live Preview extension for CodeMirror 6.
 *
 * Hides Markdown syntax markers (**, *, ~~, `, #) on lines where the cursor
 * is NOT present, so the user sees formatted-looking text while editing.
 * When the cursor moves to a line the markers re-appear for editing.
 *
 * Covered tokens:
 *   EmphasisMark       — bold/italic markers  **  *  __  _
 *   CodeMark           — inline code backtick  `
 *   StrikethroughMark  — ~~
 *   HeaderMark         — # / ## / ### (+ trailing space)
 */
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';
import type { Extension } from '@codemirror/state';

// Use Decoration.mark instead of Decoration.replace so the underlying text
// nodes stay in the DOM. Grammarly (macOS) reads the contenteditable via the
// Accessibility tree; replace() physically removes nodes, breaking its overlay.
// mark() + font-size:0 achieves the same visual result without DOM removal.
// aria-hidden removes the zero-size chars from the a11y tree so Grammarly reads
// clean text (e.g. "hello" instead of "**hello**") and positions overlays correctly.
const HIDE = Decoration.mark({
  class: 'cm-live-preview-hide',
  attributes: { 'aria-hidden': 'true' },
});

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;

  // Precompute cursor line bounds as character positions (O(1) comparisons later).
  // lineAt() is O(log lines) — calling it per-node inside iterate() is the hot path cost.
  const selFrom = state.selection.main.from;
  const selTo   = state.selection.main.to;
  const cursorLine     = state.doc.lineAt(selFrom);
  const cursorLineFrom = cursorLine.from;
  const cursorLineTo   = selTo > selFrom ? state.doc.lineAt(selTo).to : cursorLine.to;

  // Build directly inside iterate() — no intermediate array, no sort.
  // syntaxTree().iterate() visits nodes in ascending `from` order (depth-first
  // left-to-right), which is exactly what RangeSetBuilder requires.
  const builder = new RangeSetBuilder<Decoration>();

  // Iterate the full tree (not just the viewport) to avoid a feedback loop:
  // hiding `### ` changes line layout → viewport.to shifts → heading falls outside
  // the processed range → mark reappears → layout reverts → marks hidden again → flicker.
  syntaxTree(state).iterate({
    enter(node) {
      // Skip marks on the cursor line — compare positions, not line numbers (O(1)).
      if (node.from >= cursorLineFrom && node.from <= cursorLineTo) return;

      switch (node.name) {
        case 'EmphasisMark':
        case 'CodeMark':
        case 'StrikethroughMark':
          builder.add(node.from, node.to, HIDE);
          break;

        case 'HeaderMark': {
          // Hide `# ` including the mandatory space after the hashes.
          const afterMark = node.to;
          const lineEnd   = state.doc.lineAt(node.from).to;
          const end =
            afterMark < lineEnd && state.sliceDoc(afterMark, afterMark + 1) === ' '
              ? afterMark + 1
              : afterMark;
          builder.add(node.from, end, HIDE);
          break;
        }
      }
    },
  });

  return builder.finish();
}

class LivePreviewPlugin {
  decorations: DecorationSet;
  // Tracks how many characters were covered by the parse tree the last time
  // we ran buildDecorations. Used to detect when background Lezer parsing has
  // advanced (tree grew) vs a pure viewport scroll (tree unchanged).
  private lastBuiltTreeLength = 0;

  constructor(view: EditorView) {
    this.lastBuiltTreeLength = syntaxTree(view.state).length;
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (update.focusChanged) {
      this.lastBuiltTreeLength = syntaxTree(update.state).length;
      this.decorations = buildDecorations(update.view);
      return;
    }

    if (update.docChanged) {
      // Fast path: if the cursor stayed on the same line, map existing
      // decorations through the document changes (O(changed_range) instead
      // of O(whole_doc)). No need to re-scan the entire syntax tree.
      const prevHead = update.startState.selection.main.head;
      const nextHead = update.state.selection.main.head;
      const prevLine = update.startState.doc.lineAt(prevHead).number;
      const nextLine = update.state.doc.lineAt(nextHead).number;
      if (prevLine === nextLine) {
        this.decorations = this.decorations.map(update.changes);
        return;
      }
      // Cursor crossed a line (Enter, paste, etc.) — full rebuild.
      this.lastBuiltTreeLength = syntaxTree(update.state).length;
      this.decorations = buildDecorations(update.view);
      return;
    }

    if (update.viewportChanged) {
      // Since buildDecorations already iterates the FULL syntax tree (not just
      // the viewport), scrolling alone never changes which markers are hidden.
      // Intermediate Lezer parse chunks also trigger viewportChanged but we
      // skip them — rebuilding on every chunk is O(N²) for a large document.
      // Instead we wait for the tree to cover the full document (parse done),
      // then do ONE final rebuild. This turns O(N²) into O(N).
      const tree = syntaxTree(update.state);
      if (tree.length < update.state.doc.length) return; // still parsing — skip
      if (tree.length <= this.lastBuiltTreeLength) return; // no new nodes — skip
      this.lastBuiltTreeLength = tree.length;
      this.decorations = buildDecorations(update.view);
      return;
    }

    if (update.selectionSet) {
      // Only rebuild when the cursor crosses a line boundary.
      // Same-line cursor moves (horizontal arrow, click within line) don't change
      // which markers are visible, so we skip the O(n-nodes) full tree scan.
      const prev = update.startState.selection.main;
      const next = update.state.selection.main;
      const prevAnchorLine = update.startState.doc.lineAt(prev.anchor).number;
      const nextAnchorLine = update.state.doc.lineAt(next.anchor).number;
      const prevHeadLine   = update.startState.doc.lineAt(prev.head).number;
      const nextHeadLine   = update.state.doc.lineAt(next.head).number;
      if (prevAnchorLine !== nextAnchorLine || prevHeadLine !== nextHeadLine) {
        this.lastBuiltTreeLength = syntaxTree(update.state).length;
        this.decorations = buildDecorations(update.view);
      }
    }
  }
}

export function makeLivePreviewExtension(): Extension {
  return ViewPlugin.fromClass(LivePreviewPlugin, { decorations: (v) => v.decorations });
}
