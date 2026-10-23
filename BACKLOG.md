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

## Next product refinements

- [ ] Focus the first-run tour/copy entirely on books, reports and connected notes.
- [ ] Book-starting flow with chapter order and a manuscript export target, using existing files.
- [ ] Improve missing-reference discovery and optional user-confirmed note creation.
- [ ] Consider removing parked mobile and unused metadata/protocols in a separate explicit cut.
