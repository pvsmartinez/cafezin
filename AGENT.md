# AGENT.md — Project Context for AI Sessions

> **Two audiences for this file:**
>
> - **GitHub Copilot in VS Code** — building and maintaining this codebase. Use the full file.
> - **In-app Copilot assistant** — helping the user with their workspace content. Focus on the "What this app does" and "Workspace behaviour" sections; ignore build/dev internals.

## Project: Cafezin

**Owner:** Pedro Martinez (pvsmartinez@gmail.com)  
**Repo:** https://github.com/pvsmartinez/cafezin  
**Started:** February 2026  
**Last major session:** February 23, 2026

---

## What We Are Building

A general-purpose AI-assisted productivity tool, inspired by how Pedro uses VS Code + GitHub Copilot — but **not** focused on coding. Designed to support creative, educational, and knowledge-work workflows:

- ✍️ Writing books and long-form content
- 📚 Creating classes, courses, and curricula
- 🗂️ Knowledge management and note-taking
- 🤖 AI-powered workflows for non-technical users

---

## Target Platforms

| Platform           | Priority  | Notes                            |
| ------------------ | --------- | -------------------------------- |
| macOS (native app) | Primary   | Pedro's daily driver             |
| PC / Windows       | Secondary | Cross-platform Tauri             |
| Web app            | Planned   | Broader accessibility            |
| iPhone / Android   | Future    | View-only + voice only (Phase 3) |

---

## Technical Stack

- **Framework:** Tauri v2 (Rust backend) + React 19 / TypeScript frontend (Vite)
- **Editor:** CodeMirror 6 (`@uiw/react-codemirror`) with Markdown language support
- **Canvas:** tldraw v4 — `.tldr.json` files; Frames = slides; full AI tool-calling integration
- **AI:** GitHub Copilot API (`https://api.githubcopilot.com`) — OpenAI-compatible, streamed via SSE
  - Auth: device flow OAuth — `startDeviceFlow()` / `getStoredOAuthToken()` in `copilot.ts`
  - Models fetched dynamically from `/models`; `FALLBACK_MODELS` used as fallback
- **Sync / Auth:** Supabase (`dxxwlnvemqgpdrnkzrcr`, São Paulo region)
  - Only Auth + `synced_workspaces` table — no content stored, only workspace metadata (name + git URL)
  - Auth methods: email+password, Google OAuth, Apple Sign In (requires providers enabled in Supabase dashboard)
  - Desktop auth: login form inside `WorkspacePicker` (collapsed by default; expands on click)
  - OAuth flow (Tauri custom URL scheme):
    1. `signInWithGoogle()` / `signInWithApple()` return an authorization URL (implicit flow)
    2. URL opened via `tauri-plugin-opener` in system browser
    3. Browser redirects to `cafezin://auth/callback#access_token=...`
    4. Rust deep-link handler (`tauri-plugin-deep-link`) emits `auth-callback` event
    5. `App.tsx` calls `handleAuthCallbackUrl()` → `supabase.auth.setSession()`
    6. Browser event `cafezin:auth-updated` refreshes `WorkspacePicker` / `MobileApp`
  - URL scheme registered in: `Info.plist` (macOS), `tauri.conf.json plugins.deep-link.mobile` (iOS)
  - `Workspace.hasGit: boolean` — detected via `git_get_remote` on every `loadWorkspace()`
  - Workspaces **with git** → auto-registered in Supabase on open (if logged in)
  - Workspaces **without git** → local-only; "local" badge in Picker + warning banner in WorkspaceHome
  - Migration: `supabase/migrations/0001_auth_sync.sql` — apply with `scripts/apply-migrations.sh`
  - Git account tokens (for push/clone) remain in `localStorage` — device-specific, never in DB
  - Agent loop: `runCopilotAgent()` — tool-calling, MAX_ROUNDS=50, auto-continue prompt on exhaustion
  - Vision: canvas screenshot merged into user message for vision-capable models
  - Vision gating: `modelSupportsVision(id)` returns false for o-series models (`/^o\d/`)
- **Documents:** Markdown + YAML frontmatter (git-friendly, exportable)
- **Version control:** git per workspace, auto-init via Rust `git_init` command
- **In-app update:** `./scripts/update-app.sh` — incremental Cargo+Vite build → replaces `~/Applications/Cafezin.app`
- **Voice:** Web Speech API (`webkitSpeechRecognition`) — flat SVG mic/stop buttons in AIPanel footer
- **Preview:** `marked` library renders MD → HTML in `MarkdownPreview` component
- **PDF:** Tauri `convertFileSrc` + native WebKit `<embed type="application/pdf">`
- **Media:** Images/video via binary `readFile` + object URL (`MediaViewer.tsx`)
- **Image search:** Pexels API — downloads via `tauriFetch` to `workspace/images/`
- **AI marks:** `aiMarks.ts` tracks AI-written text regions; `AIMarkOverlay` shows chips; `AIReviewPanel` lists reviews
- **No backend server** — all data stays local; API calls go directly from WebView

---

## Project Structure

```
cafezin/
├── app/                          # Tauri v2 app root
│   ├── src/
│   │   ├── components/
│   │   │   ├── Editor.tsx/css             # CodeMirror 6 Markdown editor with AI mark highlights
│   │   │   ├── CanvasEditor.tsx/css       # tldraw v4 — frames=slides, strip, drag-drop, context menu, format panel
│   │   │   ├── AIPanel.tsx/css            # Right-side Copilot chat panel (⌘K) — agent mode + vision
│   │   │   ├── AIMarkOverlay.tsx/css      # Floating chips over AI-marked text regions
│   │   │   ├── AIReviewPanel.tsx/css      # Modal listing pending AI edit marks per file
│   │   │   ├── Sidebar.tsx/css            # Left file-tree explorer; AI mark count badge; context menus
│   │   │   ├── TabBar.tsx/css             # Open-file tabs (⌘W to close, ⌃Tab to switch)
│   │   │   ├── FindReplaceBar.tsx/css     # In-editor find/replace (⌘F)
│   │   │   ├── ProjectSearchPanel.tsx/css # Workspace-wide text search + replace
│   │   │   ├── MarkdownPreview.tsx/css    # Rendered MD viewer (marked)
│   │   │   ├── PDFViewer.tsx/css          # Native PDF embed via Tauri asset://
│   │   │   ├── MediaViewer.tsx/css        # Image/video viewer — binary Tauri fs read
│   │   │   ├── ImageSearchPanel.tsx/css   # Pexels stock photo search → workspace/images/
│   │   │   ├── SettingsModal.tsx/css      # App settings + keyboard shortcuts table
│   │   │   ├── SyncModal.tsx/css          # Git commit + push modal
│   │   │   ├── WorkspacePicker.tsx/css    # First-run workspace selection screen
│   │   │   ├── WorkspaceHome.tsx/css      # Dashboard shown when no file is open
│   │   │   └── UpdateModal.tsx/css        # In-app update progress modal
│   │   ├── services/
│   │   │   ├── copilot.ts    # streamCopilotChat(), runCopilotAgent(), fetchCopilotModels(),
│   │   │   │                 #   modelSupportsVision(), startDeviceFlow(), getStoredOAuthToken()
│   │   │   ├── supabase.ts   # Supabase client singleton (project: dxxwlnvemqgpdrnkzrcr)
│   │   │   ├── syncConfig.ts # Auth (signIn/signUp/signOut/getSession) + listSyncedWorkspaces,
│   │   │   │                 #   registerWorkspace, unregisterWorkspace + git account device flow
│   │   │   ├── aiMarks.ts    # loadMarks(), addMark(), markReviewed() — .cafezin/ai-marks.json
│   │   │   ├── copilotLog.ts # appendLogEntry() — session log in .cafezin/copilot-log.jsonl
│   │   │   └── workspace.ts  # loadWorkspace(), readFile(), writeFile(), buildFileTree(), createCanvasFile()
│   │   ├── types/
│   │   │   └── index.ts      # All shared TS interfaces: CopilotModelInfo (supportsVision), AIEditMark, etc.
│   │   ├── utils/
│   │   │   ├── canvasAI.ts       # summarizeCanvas() (hierarchical), canvasToDataUrl(), executeCanvasCommands()
│   │   │   ├── workspaceTools.ts # WORKSPACE_TOOLS (OpenAI format) + buildToolExecutor() for agent
│   │   │   └── fileType.ts       # getFileTypeInfo() — maps extension → kind/mode/language
│   │   ├── App.tsx           # Root: tabs + sidebar + editor/viewer + AI panel + all modals
│   │   └── App.css
│   ├── src-tauri/
│   │   ├── src/
│   │   │   ├── lib.rs        # Tauri commands: git_init, git_sync, update_app + native menu
│   │   │   └── main.rs
│   │   ├── capabilities/default.json  # FS + HTTP permissions — $HOME/**, pexels + images.pexels.com
│   │   └── tauri.conf.json
│   ├── .env                  # VITE_GITHUB_TOKEN=... (gitignored, optional — OAuth preferred)
│   └── .env.example
├── docs/
│   └── brainstorm.md
├── scripts/
│   ├── build-mac.sh          # Full Tauri build + install to ~/Applications (~5-8 min first time)
│   ├── update-app.sh         # Incremental rebuild + reinstall (~15-120s)
│   └── sync.sh               # git add -A + commit + push
├── AGENT.md                  # ← you are here
└── README.md
```

---

## Key Data Flows

### File open

1. User clicks file in Sidebar → `onFileSelect(relPath)` → `handleOpenFile()` in App
2. `getFileTypeInfo(filename)` decides kind (`markdown | pdf | code | canvas | unknown`) and default `viewMode`
3. PDF: sets `activeFile`, skips text read → renders `<PDFViewer absPath=...>`
4. Canvas (`.tldr.json`): reads file → `content` = raw JSON → renders `<CanvasEditor key={activeFile}>` (keyed to force remount on file switch)
5. MD/code: `readFile(workspace, filename)` → sets `content` state → renders `<Editor>` or `<MarkdownPreview>`

### Auto-save

- `handleContentChange` debounces 1 s → `writeFile(workspace, activeFile, content)`

### AI chat

- ⌘K opens AIPanel
- **Agent mode** (workspace open): `runCopilotAgent()` — tool-calling loop, MAX_ROUNDS=50; exhaustion shows user-facing "continue" prompt
- **Plain chat** (no workspace): `streamCopilotChat()` — single-turn streaming
- System prompt `content` is a **single joined string** — never an array (arrays cause 400 on Claude/o-series)
  - `agentContext` = AGENT.md contents (first **8000** chars injected into system prompt)
  - `documentContext` = current doc excerpt (first **15000** chars)
- **Vision:** on every send, if a canvas is open and model supports vision, the canvas screenshot is merged into the user message as multipart `[image_url, text]` — avoids consecutive-user-messages 400
- `modelSupportsVision(id)` — false for `/^o\d/` (o1, o3, o3-mini, o4-mini)
- Error messages: API JSON body parsed for `error.message` before surfacing to UI
- Models fetched once on first open; `modelsLoadedRef` prevents double-fetch

### Context management (anti-overflow)

The agent tracks estimated token usage on every round (rough proxy: `JSON.chars / 4`).

**Token-triggered summarization** (`CONTEXT_TOKEN_LIMIT = 90_000`):

1. When `estimateTokens(loop) > 90_000`, the agent calls the model (non-streaming) with a summarization prompt asking for a dense technical briefing (400–700 words).
2. The full conversation snapshot (base64 images stripped) is written to `<workspace>/cafezin/copilot-log.jsonl` as an `archive` entry.
3. The context window is rebuilt to a compact form: system messages → original user task → synthetic `[SESSION SUMMARY]` user message → last 8 messages verbatim.
4. A brief inline notice is streamed to the user: `_[Context approaching limit — summarizing prior session and continuing...]_`

**Lightweight fallback** (active only when under the token limit): keeps last 14 assistant+tool round groups and deduplicates stale vision messages.

### Copilot log file format

All agent activity is persisted to `<workspace>/cafezin/copilot-log.jsonl` — one JSON object per line.

Two entry types coexist in the same file:

| Field                        | Exchange entry | Archive entry                                      |
| ---------------------------- | -------------- | -------------------------------------------------- |
| `entryType`                  | (absent)       | `"archive"`                                        |
| `sessionId`                  | ✓              | ✓                                                  |
| `timestamp` / `archivedAt`   | ✓              | ✓                                                  |
| `userMessage` / `aiResponse` | ✓              | —                                                  |
| `toolCalls?`                 | ✓              | —                                                  |
| `summary`                    | —              | ✓ — model-generated dense summary                  |
| `messages`                   | —              | ✓ — full turn-by-turn transcript (base64 stripped) |
| `estimatedTokens`            | —              | ✓                                                  |
| `round`                      | —              | ✓                                                  |

**As the in-app agent, you can read this file:**

```
read_file({ path: "<workspacePath>/cafezin/copilot-log.jsonl" })
```

Parse each line as JSON. Look for `entryType === "archive"` entries to reconstruct earlier session context. The `summary` field gives a concise overview; `messages` gives the full transcript.

### Workspace load

- `loadWorkspace(path)` → reads config, AGENT.md, runs `git_init`, builds `fileTree` (recursive, depth≤8), lists `.md` files
- Config stored in `<workspace>/.cafezin/config.json`
- Recent workspaces persisted to `localStorage`

### In-app update

- Header or ⌘⇧U → `update_app` Rust command → streams build output via `update:log` events → copies `.app` → `open` + `exit(0)`

---

## Workspace / Sidebar Behaviour

- File tree is **fully recursive**, skipping: `node_modules`, `.git`, `.cafezin`, `target`, `.DS_Store`, dotfiles
- Depth limit: 8 levels
- Directories sort before files; both alphabetical within group
- Root-level directories auto-expanded on load
- `Workspace.files` (flat `.md` list) is kept for backwards-compat with config (`lastOpenedFile`)

### Creating files and folders

There are three ways to create a new file or folder:

1. **EXPLORER header hover** — hover the EXPLORER label to reveal `+` (file) and `⊞` (folder) buttons at workspace root
2. **Directory row hover** — hover any folder in the tree to reveal a `+` icon; triggers creation inside that folder
3. **Right-click context menu** — right-click any file or folder → "New file here" / "New folder here"

All three open the same **inline creator panel** in the sidebar footer:

- Shows context label: `+ file in docs/` or `⊞ folder at root`
- **Type pills** for text/code formats: MD · TS · TSX · JS · JSON · CSS · HTML · PY · SH · TXT
- **`◈ Canvas`** button below the pills — visually distinct (gold), creates a `.tldr.json` canvas file
- Name input auto-focuses; Enter confirms, Esc cancels
- Auto-expands the target directory and opens the newly created file

`workspace.ts` helpers:

- `createFile(workspace, relPath)` — extension-aware, creates parent dirs as needed
- `createCanvasFile(workspace, relPath)` — writes empty `.tldr.json`, creates parent dirs
- `createFolder(workspace, relPath)` — `mkdir -p` equivalent

---

## Editor / Viewer Modes

| File type          | Mode           | Toggle shown         | Notes                                                                                              |
| ------------------ | -------------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| `.md` / `.mdx`     | Edit (default) | Yes — Edit / Preview | Preview uses `marked` (GFM)                                                                        |
| `.pdf`             | Preview only   | No                   | `convertFileSrc` → WebKit embed                                                                    |
| `.tldr.json`       | Canvas only    | No                   | tldraw v4; JSON snapshot stored on disk; git-tracked; grid+snap on by default; **Frames = slides** |
| `.ts`, `.js`, code | Edit only      | No                   | CodeMirror, no syntax HL yet (extension not loaded)                                                |
| unknown            | Edit only      | No                   | Plain text fallback                                                                                |

---

## AI Model Picker

- Dropdown in AIPanel header shows live models from `/models`
- Rate badges: **free** (green, 0×), **standard** (blue, 1×), **premium** (yellow, >1×)
- `isPremium` = `multiplier > 1`
- `supportsVision: boolean` on `CopilotModelInfo` — false for o-series reasoning models
- `FALLBACK_MODELS`: gpt-4o-mini (free, vision ✓), gpt-4o (1×, vision ✓), claude-sonnet-4-5 (1×, vision ✓), o3-mini (1×, vision ✗)

---

## Canvas Editor Details

- **Persistence:** `editor.getSnapshot()` → debounced 500ms → JSON saved to `.tldr.json`
- **Frames = Slides:** 1280×720px, arranged horizontally with 80px gaps (`SLIDE_W`, `SLIDE_H`, `SLIDE_GAP`)
- **Slide strip (bottom bar):**
  - Cards are draggable — reorder by swapping x-positions via `editor.updateShape()`
  - Right-click context menu: Export PNG / Move Left / Move Right / Duplicate / Delete
  - Format panel shows "Slide / ↓ Export PNG" when a frame is selected
- **Present mode:** `▶ Present` → locks to slide 0; ←/→/Space navigates; Esc exits
- **AI canvas tools:**
  - `list_canvas_shapes` — must be called before modifying existing shapes (provides IDs)
  - `canvas_op` — `{"op":"clear"}` marked DANGER in both system prompt and tool description
  - `canvas_screenshot` — returns `__CANVAS_PNG__:base64` sentinel; agent loop injects it as vision message
  - `summarizeCanvas()` — hierarchical: slides list their children by `parentId`
  - `executeCanvasCommands()` returns `{ count, shapeIds }` (destructure, not a plain number)
- **tldraw chrome removed:** SharePanel, HelpMenu, Minimap
- **Grid/snap:** `updateInstanceState({ isGridMode: true })` on mount

---

## Keyboard Shortcuts

| Shortcut | Action                       |
| -------- | ---------------------------- |
| ⌘K       | Toggle AI panel              |
| ⌘B       | Toggle sidebar               |
| ⌘W       | Close active tab             |
| ⌘,       | Open Settings                |
| ⌘⇧R      | Reload active file from disk |
| ⌃Tab     | Next tab                     |
| ⌃⇧Tab    | Previous tab                 |
| ⌘F       | Find/replace in editor       |
| ⌘⇧U      | In-app update                |

---

## Known Limitations / Next Up

- **No syntax highlighting** for non-Markdown files (CodeMirror language extensions not loaded)
- **`git_sync`** — best-effort push to `origin HEAD`; no remote = silently OK
- **Image save (Pexels):** Requires Tauri app rebuild after `capabilities/default.json` change (`images.pexels.com` domain added); run `./scripts/update-app.sh`
- **AI mark jump on canvas:** Zooms to shape bounds; text-file jump uses `editorRef.jumpToText()`

---

## Dev Commands

```bash
# Run in dev mode
cd app && npm run tauri dev

# Full build + install to ~/Applications
./scripts/build-mac.sh --install

# Quick rebuild + reinstall (incremental)
./scripts/update-app.sh

# Type-check only
cd app && npx tsc --noEmit
```

---

## Session Notes

> Full history moved to [`docs/session-log.md`](docs/session-log.md) to keep this file lean.
> Add new entries there, not here.

**Last significant sessions (summary):**

- **2026-02-22** — Project init → Phase 1 scaffold → file tree → model picker → edit/preview → tldraw canvas → sidebar creator → present mode → slide strip (Figma-style).
- **2026-02-23** — Canvas AI hardening → slide strip UX overhaul → image save fix → AI review panel wired → context summarization → slide sync & theme hardening → theme bg fix → slide layouts → format panel v1+v2 (rotation, opacity, align, lock, corner radius, shadow, geo picker, dimensions, layer order, group/ungroup, flip) → AI error recovery.
- **2026-02-28** — Export system v2: added 5 new PDF target capabilities: (1) **Custom CSS** (`pdfCssFile`) — workspace-relative `.css` appended after default styles; (2) **Title page** (`titlePage`) — title/subtitle/author/version page prepended to PDF; (3) **TOC** (`toc: true`) — auto-generates H1/H2 table of contents for merged PDFs; (4) **Output versioning** (`versionOutput: 'timestamp'|'counter'`) — date-stamped or auto-incremented filenames; (5) **Pre-export transformations** (`preProcess`) — strip YAML frontmatter, `### Draft` sections, `<details>` blocks before rendering.
- **2026-03-02** — Agent capability improvements: (1) **`multi_patch` tool** — applies an array of `{path, search, replace, occurrence}` patches across multiple files in one round-trip; files are read once, all patches applied in memory, then written once per file; (2) **Context depth increased** — AGENT.md 3000→8000 chars, documentContext 6000→15000 chars, memory 4000→6000 chars; (3) **Test-aware system prompt** — agent now instructed to run tests (`npm test`, `pytest`, `tsc --noEmit`) after edits in code workspaces and iterate on failures; (4) **Multi/surgical edit guidance** — system prompt now explicitly teaches when to use `patch_workspace_file` vs `multi_patch` vs `write_workspace_file`. (5) **`publish_vercel` improvements** — new `setup` action scaffolds `vercel.json` + `.vercelignore` for `static`/`spa`/`demos`/`node` project types; `deploy` action gains `buildCommand` + `buildOutputDir` params for one-shot build-then-deploy; Demo Hub system prompt updated with setup workflow and vercel.json guidance.
