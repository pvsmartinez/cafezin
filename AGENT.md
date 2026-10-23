# AGENT.md — Cafezin

## Product

Cafezin is Pedro Martinez's local-first writing app for books, reports, chapters and
connected notes. Repository: `pvsmartinez/cafezin`.

The active product is:

- Portable local Markdown/plain-text documents and folders.
- A focused Prose editor and a Markdown source editor, plus rendered preview.
- Clickable `[[wiki references|labels]]`, relative Markdown links, and backlinks.
- A side-by-side AI assistant for drafting, revision, research and continuity.
- Visible AI marks and before/after comparisons, with accept/reject and text restoration.
- Git history/sync and manuscript PDF export.
- Read-only PDF, image, audio and video attachments for research.

**Not a general-purpose IDE/workbench.** Canvas/tldraw/slides, PowerPoint/Office/spreadsheet
viewers, HTML previews, embedded terminal, code runners, deployment/publishing and shell-backed
exports have been removed, not merely hidden. Do not reintroduce them as part of maintenance.
Code examples inside Markdown remain valid writing content; copying a code block is allowed,
executing it is not a product feature.

## Compatibility and safety

- Never delete or convert a user's existing documents to simplify the product.
- Unsupported legacy files remain visible in the workspace and show an explanatory placeholder.
  Do not read binary files into an editable text buffer, autosave them, or overwrite them.
- Old canvas/custom/git-publish export targets must fail explicitly without executing commands.
  Keep stored configuration intact until the user intentionally edits it.
- Markdown is the storage format; Prose must preserve `[[wiki links]]` during serialization.
  `restoreProseWikiLinks` covers the bracket escaping performed by Tiptap's Markdown serializer.
- Resolve references relative to the active document, with workspace-root fallback. Known file
  trees determine actual filenames/case; never navigate outside the workspace or treat schemes
  such as `file:`/`javascript:` as local files. Missing links must not create files silently.
- AI review marks live in `.cafezin/ai-marks.json`; acceptance is a review decision, rejection
  restores the recorded text. Never bulk-accept edits when the user merely opens review.
- AI tool-list filtering is not an OS sandbox. The optional Pi bridge and MCP extensions remain
  separate agent infrastructure; removing the app's shell runner does not sandbox external agents.

## Platforms

- macOS: primary daily driver; Windows: secondary Tauri target.
- Web: browser-compatible build with OPFS storage and Tauri shims.
- iOS/Android: parked targets; retained writing surfaces must type-check, but routine validation
  must not regenerate native/mobile build caches.
- Release scripts default to macOS + Windows. iOS requires `--with-ios` or dedicated iOS commands.

## Stack and entrypoints

Tauri v2 (Rust) + React 19 + strict TypeScript + Vite. CodeMirror 6 is the Markdown editor;
Tiptap is the Prose editor. `marked` + DOMPurify render Markdown, with KaTeX/Mermaid support
for technical writing. jsPDF/html2canvas export PDFs; JSZip bundles source/attachments.

Useful paths:

- `app/src/App.tsx`: workspace lifecycle, tabs, autosave, agent and review wiring.
- `components/app/AppEditorArea.tsx`: writing/source/preview and attachment routing.
- `components/BookNav.tsx`, `utils/manuscript.ts`: the workspace as a book — Sumário (ordered
  chapters in `.cafezin/config.json` → `manuscript.chapters`, also the book-PDF order), Caderno,
  Pesquisa, titles from each text's H1, one-click book PDF and its options (`manuscript.pdf`).
- `components/Editor.tsx`, `ProseEditor.tsx`, `MarkdownPreview.tsx`: writing surfaces.
- `utils/documentLinks.ts`, `hooks/useBacklinks.ts`, `components/BacklinksPanel.tsx`: references.
- `components/WritingReviewPanel.tsx`, `AIMarkOverlay.tsx`, `hooks/useAIMarks.ts`: AI review.
  Pending edits are margin notes beside the page (compact buttons when there is no margin).
- `components/AskBar.tsx`: ⌘K-style prompt under the page; sends via `autoSend` to the agent.
- `services/aiMarks.ts`, `utils/aiMarkMatch.ts`, `utils/aiMarkRevert.ts`: persisted decisions/revert.
- `services/workspace.ts`: local filesystem and workspace config.
- `utils/fileType.ts`: supported formats; unknown/development/Office/canvas formats are unsupported.
- `components/AIPanel.tsx`, `AgentSession.tsx`, `hooks/useAIStream.ts`: side assistant.
- `services/aiProvider.ts`, `services/copilot/`, `services/ai/`: provider implementations.
- `utils/workspaceTools.ts`, `utils/tools/`: writing/research/config tools, without shell/canvas tools.
- `utils/exportWorkspace.ts`, `utils/exportPDF.ts`, `components/ExportModal.tsx`: PDF/ZIP only.
- `app/src-tauri/src/lib.rs`: native git, Pi RPC, MCP, auth deep links and app lifecycle.
- `app/src/web/`, `app/vite.web.config.ts`: browser shims and OPFS implementation.

`docs/session-log.md`, `docs/brainstorm.md` and old UX notes describe historical implementations,
not permission to restore removed product features.

## Persistence and workflow

- A workspace is an ordinary local folder; `.cafezin/config.json` stores preferences/export targets.
- Text edits debounce into local files. Keep in-memory unsaved buffers authoritative over disk
  when the agent reads/patches the active document.
- Workspace mutations dispatch `cafezin:workspace-mutated`; backlinks rebuild after saves as well
  as file-list changes. Do not cache links forever based only on filenames.
- Tabs and per-workspace AI sessions live in localStorage. Git is per workspace.
- File trees skip hidden/generated directories, including `.git`, `.cafezin`, `node_modules`, target.
- Research/provider integrations are optional network calls; the manuscript is local-first.
- BYOK providers remain supported (Copilot/OpenAI/Anthropic/Groq/Google/custom-local), alongside
  Cafezin managed AI. Do not silently change provider settings while simplifying the editor.

## Auth, database and secrets

Supabase ref `dxxwlnvemqgpdrnkzrcr` is shared across workspace apps. Cafezin uses schema
`cafezin`, not `public`; auth/account/metadata services must keep that schema selection.
Manuscript files are local, not stored in Supabase. Workspaces with git may register metadata
(name/remote URL) when authenticated; provider credentials have existing encrypted handling.

- Credentials belong in `../pedrin/`; never read/dump its `.env` or hardcode secrets.
- Desktop OAuth returns via `cafezin://auth/callback` and the native `auth-callback` event.
- Before any database/edge-function change, read the workspace `supabase-shared-db` skill.
- RLS expressions use `(select auth.uid())`/`(select auth.email())`, never bare calls.
- Migrations: workspace runner `python3 scripts/migrate.py cafezin`; production `--apply` requires
  explicit authorization. Git push does not apply migrations.

## Validation and disk hygiene

```sh
cd app
npx tsc --noEmit
NODE_OPTIONS=--no-experimental-webstorage npm test
npm run build
npm run build:web
```

The Node flag avoids a broken experimental global localStorage on newer Node versions so jsdom
provides storage for component tests. It is not required by the app itself.

```sh
python3 scripts/test-clean-builds.py
python3 scripts/test-build-entrypoints.py
python3 scripts/clean-builds.py          # dry-run
python3 scripts/clean-builds.py --apply  # only after stopping build processes
```

The cleaner removes allowlisted untracked build outputs, refuses symlinked/tracked outputs,
and keeps native generated project sources, dependencies, videos, git and writing workspaces.
Rust dev builds use line-table debug symbols and no incremental cache. Release profiles are
unchanged. Do not regenerate gigabytes of native artifacts just to validate frontend cleanup.

Native dev: `cd app && npm run tauri dev`. Full Mac build/install: `scripts/build-mac.sh --install`.
Incremental rebuild/install: `scripts/update-app.sh`. These are explicit build/install operations,
not lightweight validation. Full native compilation is required before shipping native changes.

## Release and UI rules

- Keep versions aligned in `app/package.json` and `app/src-tauri/Cargo.toml`.
- Do not alter an existing dirty iOS build counter unless explicitly working on an iOS build.
- No commit/push, production release, migration, notarization or installation without permission.
- Design direction ("Manuscrito"): the page is the hero — paper (`--paper*` tokens) on a desk
  (`--desk`), serif text for long reading, silent chrome, no fixed toolbars. Both themes must stay
  comfortable for hours; check contrast with axe. Dialogs/panels remap UI tokens to paper locally.
- UI changes need browser validation and before/after screenshots using synthetic data. Read
  the `browsin` and `revisao-visual-antes-depois` skills; delegate pixel inspection to `vision`.
- Conversation/UI: pt-BR; code and commit messages: English. Prefer simple, focused changes.
- Landing pages remain in `landing/` and `landing/br/`. Preserve Mac/Windows platform adaptation
  (`landing-analytics.js`, `data-win-*`, platform classes) and the `btn-download` class on download
  CTAs. Do not publish positioning/build changes to the landing as a side effect of editor work.

Scope and follow-up: [docs/authoring-simplification.md](docs/authoring-simplification.md),
[BACKLOG.md](BACKLOG.md).
