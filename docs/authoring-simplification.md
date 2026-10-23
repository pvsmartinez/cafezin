# Cafezin — focused writing

## Product boundary

Books, reports, chapters and connected Markdown notes. Prose and source editing, preview,
research, an adjacent AI assistant with reviewable changes, git history, and manuscript PDF.
No IDE, slide/canvas editor, Office/spreadsheet viewer, terminal, code execution or deployment.

## Implemented — October 2026

### Disk and build defaults

- Reclaimed approximately 7.38 GiB of disposable build outputs (9 GiB → about 1.7 GiB overall).
- Added an allowlisted dry-run-first cleaner with tracked-file/symlink safety tests.
- Reduced Rust development cache growth without changing release profiles.
- Desktop-first release defaults; parked iOS builds require explicit opt-in.

### Actual code removal

- Deleted tldraw/canvas/slides components, state, registry, AI commands and export implementations.
- Deleted spreadsheet, PowerPoint, Word, RTF and HTML-page viewers and their parsers.
- Deleted terminal UI, native shell-runner commands, agent shell/deployment tools, code-run buttons,
  TypeScript diagnostics, source formatting, canvas skills and developer-oriented creation flows.
- Removed tldraw, mammoth, xlsx, html-to-image, Prettier, and unused CodeMirror grammar dependencies.
- Updated DOMPurify within the existing compatible range, eliminating the critical advisory.
- Kept Markdown code examples, math and Mermaid for technical writing; code blocks can be copied,
  not executed. PDF needs html2canvas and jsPDF, so those remain.
- Export supports Markdown PDF and ZIP. Old shell/git-publish/canvas targets fail explicitly;
  no command is executed and the engine does not rewrite their stored configuration.

### Writing and review

- Explicit Escrita/Markdown switch, rendered preview and side assistant.
- Wiki references (`[[note]]`, `[[folder/note|label]]`) and relative Markdown links navigate safely,
  relative-first with workspace-root fallback and the real file casing.
- Backlinks share the resolver and rebuild after saved text changes, not only file-list changes.
- Missing references show a notice rather than creating a file; code/escaped examples stay literal.
- Prose decorations allow Cmd/Ctrl-click while retaining the source wiki syntax in Markdown.
- New AI review comparison displays the previous and revised text with explicit accept/reject.
  Opening review no longer silently accepts all pending marks. Existing inline AI highlights remain.
- Browser builds no longer get blocked by the native mandatory-update check.
- PDF output now enables compression instead of storing large uncompressed page images.

## Compatibility decisions

The user explicitly approved removing legacy readers, superseding the first slice's conservative
"all formats still open" constraint. **Files are never deleted or converted.** Unsupported formats
stay in the tree, show a placeholder and never enter an editable text buffer. Existing Markdown,
review metadata, history and workspace structure remain local and compatible.

Auth, account/billing, BYOK providers, optional Pi/MCP infrastructure and parked mobile writing
surfaces were not rewritten. This cleanup is not a sandbox for external agents and is not a new
native release or installation.

## Validation evidence

- TypeScript and frontend unit tests.
- Python safety/routing tests for cleanup and release defaults.
- Desktop and browser frontend builds; no native caches regenerated.
- Synthetic OPFS workspace in headless Chromium: wiki navigation, Prose Cmd/Ctrl-click, legacy PPT
  placeholder without changing the original file, before/after AI review, rejecting a text edit,
  and preserved `[[wiki syntax]]` after rejection.
- Before/after artifact: workspace `local/scratch/cafezin-authoring-review/index.html`.
- Native source syntax parsed with rustfmt; full Rust compilation remains a pre-release requirement.

## Follow-up

See [../BACKLOG.md](../BACKLOG.md). Native build/install, production updates and dependency-security
upgrades are separate work, not implicit side effects of this cleanup.
