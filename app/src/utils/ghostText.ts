/**
 * Ghost text (inline completions) extension for CodeMirror 6.
 *
 * Behaviour:
 *  - After 650 ms of cursor inactivity the completion API is called.
 *  - Suggestion rendered as grey ghost text after the cursor.
 *  - Tab  → accept full suggestion, Escape → dismiss.
 *  - Any doc change or cursor move clears the current suggestion.
 */

import { StateField, StateEffect, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, Decoration, WidgetType, keymap } from '@codemirror/view';

// ── Types ─────────────────────────────────────────────────────────────────────

export type GhostCompleteFn = (
  prefix: string,
  suffix: string,
  language: string,
  signal: AbortSignal,
) => Promise<string>;

// ── State ─────────────────────────────────────────────────────────────────────

interface Suggestion {
  text: string;
  /** Character offset in the doc where the suggestion starts (cursor position). */
  from: number;
}

const setSuggestion = StateEffect.define<Suggestion | null>();

const suggestionField = StateField.define<Suggestion | null>({
  create: () => null,
  update(val, tr) {
    for (const e of tr.effects) {
      if (e.is(setSuggestion)) return e.value;
    }
    if (tr.docChanged || tr.selection) return null;
    return val;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (suggestion) => {
      if (!suggestion?.text) return Decoration.none;
      return Decoration.set([
        Decoration.widget({ widget: new GhostWidget(suggestion.text), side: 1 }).range(suggestion.from),
      ]);
    }),
});

// ── Widget ────────────────────────────────────────────────────────────────────

class GhostWidget extends WidgetType {
  constructor(readonly suggestion: string) { super(); }
  eq(other: GhostWidget): boolean { return other.suggestion === this.suggestion; }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-ghost-text';
    wrap.setAttribute('aria-hidden', 'true');

    const lines = this.suggestion.split('\n');
    wrap.textContent = lines[0];

    if (lines.length > 1) {
      const badge = document.createElement('span');
      badge.className = 'cm-ghost-more';
      badge.textContent = ` +${lines.length - 1} line${lines.length > 2 ? 's' : ''}`;
      wrap.appendChild(badge);
    }
    return wrap;
  }

  ignoreEvent(): boolean { return true; }
}

// ── ViewPlugin ────────────────────────────────────────────────────────────────

function makePlugin(getComplete: () => GhostCompleteFn | null, language: string) {
  return ViewPlugin.define((view) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ctrl: AbortController | null = null;

    function cancel() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (ctrl) { ctrl.abort(); ctrl = null; }
    }

    function schedule() {
      cancel();
      timer = setTimeout(async () => {
        const complete = getComplete();
        if (!complete) return;

        const sel = view.state.selection.main;
        if (!sel.empty) return; // text selected — skip

        const cursorPos = sel.from;
        const doc = view.state.doc.toString();
        const prefix = doc.slice(0, cursorPos);
        const suffix = doc.slice(cursorPos);

        // Skip on blank line prefix
        const lastChar = prefix[prefix.length - 1];
        if (!lastChar || lastChar === '\n') return;

        ctrl = new AbortController();
        try {
          const suggestion = await complete(prefix, suffix, language, ctrl.signal);
          if (!suggestion) return;
          // Verify cursor hasn't moved during the async call
          const nowSel = view.state.selection.main;
          if (nowSel.from !== cursorPos || !nowSel.empty) return;
          view.dispatch({ effects: setSuggestion.of({ text: suggestion, from: cursorPos }) });
        } catch {
          // AbortError or network error — silently swallow
        }
      }, 650);
    }

    return {
      update(update) {
        if (update.docChanged) {
          cancel();
        } else if (update.selectionSet || update.focusChanged) {
          schedule();
        }
      },
      destroy() { cancel(); },
    };
  });
}

// ── Keymap ────────────────────────────────────────────────────────────────────

const ghostKeymap = keymap.of([
  {
    key: 'Tab',
    run(view) {
      const s = view.state.field(suggestionField);
      if (!s?.text) return false; // no suggestion → pass through to normal Tab
      view.dispatch({
        changes: { from: s.from, insert: s.text },
        selection: { anchor: s.from + s.text.length },
        effects: setSuggestion.of(null),
        userEvent: 'input.complete',
      });
      return true;
    },
  },
  {
    key: 'Escape',
    run(view) {
      const s = view.state.field(suggestionField);
      if (!s) return false;
      view.dispatch({ effects: setSuggestion.of(null) });
      return true;
    },
  },
]);

// ── Public factory ────────────────────────────────────────────────────────────

/**
 * Returns the CodeMirror extensions for ghost-text inline completions.
 *
 * @param getComplete  Stable ref-backed getter returning the completion fn (or null).
 * @param language     Language hint passed to the completion fn ("typescript", "markdown", …).
 */
export function makeGhostTextExtension(
  getComplete: () => GhostCompleteFn | null,
  language: string,
): Extension {
  return [suggestionField, makePlugin(getComplete, language), ghostKeymap];
}
