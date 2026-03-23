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

const HIDE = Decoration.replace({});

/** True if any cursor/selection line overlaps the node's line span. */
function cursorOverlaps(view: EditorView, nodeFrom: number, nodeTo: number): boolean {
  const { state } = view;
  const startLine = state.doc.lineAt(nodeFrom).number;
  // For inline markers nodeTo is always on the same line, but be safe:
  const endLine = nodeTo > nodeFrom ? state.doc.lineAt(nodeTo - 1).number : startLine;
  for (const range of state.selection.ranges) {
    const selStart = state.doc.lineAt(range.from).number;
    const selEnd   = state.doc.lineAt(range.to).number;
    if (selStart <= endLine && selEnd >= startLine) return true;
  }
  return false;
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;

  const entries: { from: number; to: number }[] = [];

  // Iterate the full tree (not just the viewport) to avoid a feedback loop:
  // hiding `### ` changes line layout → viewport.to shifts → heading falls outside
  // the processed range → mark reappears → layout reverts → marks hidden again → flicker.
  syntaxTree(state).iterate({
    enter(node) {
      if (cursorOverlaps(view, node.from, node.to)) return;

      switch (node.name) {
        case 'EmphasisMark':
        case 'CodeMark':
        case 'StrikethroughMark':
          entries.push({ from: node.from, to: node.to });
          break;

        case 'HeaderMark': {
          // Hide `# ` including the mandatory space after the hashes.
          const afterMark = node.to;
          const lineEnd   = state.doc.lineAt(node.from).to;
          const end =
            afterMark < lineEnd && state.sliceDoc(afterMark, afterMark + 1) === ' '
              ? afterMark + 1
              : afterMark;
          entries.push({ from: node.from, to: end });
          break;
        }
      }
    },
  });

  // RangeSetBuilder requires ascending `from` order.
  entries.sort((a, b) => a.from - b.from || a.to - b.to);

  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of entries) {
    builder.add(from, to, HIDE);
  }
  return builder.finish();
}

class LivePreviewPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      update.focusChanged
    ) {
      this.decorations = buildDecorations(update.view);
    }
  }
}

export function makeLivePreviewExtension(): Extension {
  return ViewPlugin.fromClass(LivePreviewPlugin, { decorations: (v) => v.decorations });
}
