# Cafezin backlog

## Authoring core — implemented

- [x] Remove canvas/slides/Office/spreadsheets and workbench developer features.
- [x] Keep unsupported legacy files intact without editable binary fallback.
- [x] Markdown/Prose/preview with connected references and refreshed backlinks.
- [x] AI before/after comparison, explicit accept/reject and portable wiki serialization.
- [x] PDF/ZIP export; reject legacy executable export targets.
- [x] Disposable build cleanup and desktop-first release defaults.

## Before a native release

- [ ] Compile and smoke-test the native app on macOS after removal of shell commands.
- [ ] Validate native git/history, local PDF save dialog and real provider edits end-to-end.
- [ ] Review/install the new native app only with Pedro's permission; no release performed yet.
- [ ] Audit the remaining dependency advisories separately (45 at this checkpoint).
      DOMPurify's critical advisory was fixed via a compatible lockfile update; avoid force upgrades.

## UI review round 1 — implemented

- [x] Autosave never wrote to disk (guard compared against the new content); covered by tests.
- [x] Opening a file in Prose no longer rewrites it; task-list markers survive Prose edits.
- [x] One editor-mode switch (Writing · Markdown · Reading), workspace name in the header.
- [x] Off-palette purple/blue removed; undefined CSS tokens aliased; button font inherited.
- [x] First-run tour rewritten for writing; home is action-first; export modal translated
      with a one-click manuscript target; tab bar, backlinks and picker translated.
- [x] Dead settings removed (Prettier format-on-save, terminal, sidebar command buttons,
      code/canvas/spreadsheet shortcut groups, "classes" workspace type).

## Manuscrito redesign — implemented

- [x] Desk + paper surfaces for both themes; serif page typography tuned for long reading.
- [x] BookNav replaces the file explorer and tab bar (Sumário/Caderno/Pesquisa, drag to order).
- [x] Selection bubble menu replaces the fixed toolbar; `[[links]]` collapse to labels; task boxes.
- [x] Agent edits as margin notes; ask bar under the page; agent panel starts closed.
- [x] One-click book PDF in Sumário order with title page/TOC options.

## Next product refinements

- [x] Decided with Pedro: no tabs; book typography for every text; light conversation on the desk.
- [x] Full pass: search/find translated, viewers on the desk, settings in 5 pages (Geral, Livro,
      Agente, Conta, Atalhos), Ctrl+Tab = next chapter, unsupported files under "Outros arquivos".
- [ ] Settings "Geral" still shows API-key and AI sections that belong on the Agente page.
- [ ] Model menu renders an empty sheet when no models are available (web build).
- [ ] Chapter files created as `capitulo-NN.md`; follow the folder's own numbering style.
- [ ] Margin notes use an estimated height to avoid overlap; measure real heights.
- [ ] Orphan i18n from the removed Sidebar/TabBar (sidebar.*, tabBar.*) can be pruned.

- [ ] Decide how `[[links]]` look in Prose: raw syntax (today) or label-only like Obsidian.
- [ ] Agent tool `configure_workspace` can still add sidebar command buttons that never render.
- [ ] Orphan i18n namespaces (canvas*, pptxPanel, docxPanel, sidebar.newCanvas…) can be pruned.
- [ ] Settings has 8 tabs (IA, Agente, MCP overlap); consolidate for writers.
- [ ] Workspace-type picker still offers notes/project/research; confirm they are useful.

- [ ] Book-starting flow with chapter order and a manuscript export target, using existing files.
- [ ] Improve missing-reference discovery and optional user-confirmed note creation.
- [ ] Consider removing parked mobile and unused metadata/protocols in a separate explicit cut.
