# AGENT.md — Project Context for AI Sessions

> **Two audiences for this file:**
>
> - **GitHub Copilot in VS Code** — building and maintaining this codebase. Use the full file.
> - **In-app Copilot assistant** — helping the user with their workspace content. Focus on the "What this app does" and "Workspace behaviour" sections; ignore build/dev internals.

## Project: Cafezin

**Owner:** Pedro Martinez (pvsmartinez@gmail.com)  
**Repo:** https://github.com/pvsmartinez/cafezin  
**Started:** February 2026  
**Last major session:** May 2026

---

## What We Are Building

A general-purpose AI-assisted productivity tool, inspired by how Pedro uses VS Code + GitHub Copilot — but **not** focused on coding. Designed to support creative, educational, and knowledge-work workflows:

- ✍️ Writing books and long-form content
- 📚 Creating classes, courses, and curricula
- 🗂️ Knowledge management and note-taking
- 🤖 AI-powered workflows for non-technical users

---

## Target Platforms

| Platform           | Priority  | Notes                                                                          |
| ------------------ | --------- | ------------------------------------------------------------------------------ |
| macOS (native app) | Primary   | Pedro's daily driver                                                           |
| PC / Windows       | Secondary | Cross-platform Tauri                                                           |
| Web app            | Planned   | Broader accessibility                                                          |
| iPhone / Android   | Active    | Full mobile app — MobileCopilot, file browser, voice memo, AI chat, onboarding |

---

## Technical Stack

- **Framework:** Tauri v2 (Rust backend) + React 19 / TypeScript frontend (Vite)
- **Editor:** CodeMirror 6 (`@uiw/react-codemirror`) with Markdown language support
- **Canvas:** tldraw v4 — `.tldr.json` files; Frames = slides; full AI tool-calling integration
- **AI providers:** Multi-provider BYOK (`aiProvider.ts`) — `services/copilot/` + `services/ai/` subfolders:
  - **Cafezin IA** — default for new users; managed credits via `accountService.ts`; no API key needed
  - **GitHub Copilot** — device flow OAuth; `startDeviceFlow()` / `getStoredOAuthToken()` in `services/copilot/auth.ts`
  - **OpenAI, Anthropic, Groq, Google Gemini** — API key; stored encrypted in Supabase via `apiSecrets.ts`
  - **Custom / Local** — any OpenAI-compatible endpoint (Ollama, LM Studio, OpenRouter); URL + model in localStorage only (privacy)
  - Models fetched dynamically per provider; Copilot uses `FALLBACK_MODELS` if fetch fails
- **MCP (Model Context Protocol):** `mcpClient.ts` manages external tool servers via Tauri process spawn;
  tools namespaced as `mcp__<serverId>__<toolName>`; configured in Settings → MCP tab
- **Ghost text:** `ghostText.ts` — CodeMirror 6 inline completion extension; 650ms debounce; Tab=accept, Esc=dismiss
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
- **Prose editor:** `ProseEditor.tsx` — Tiptap WYSIWYG mode for `.md`/`.txt`; Grammarly-compatible
- **File viewers:** `SpreadsheetViewer.tsx` (.xlsx/.csv), `DocxInfoPanel.tsx` (.docx), `PptxInfoPanel.tsx` (.pptx), `RtfViewer.tsx` (.rtf), `WebPreview.tsx` (HTML pages)
- **Backlinks:** `BacklinksPanel.tsx` + `hooks/useBacklinks.ts` — wiki-style backlinks/outlinks strip below editor
- **Risk Gate:** `riskGate.ts` intercepts tool calls; `toolRisk.ts` classifies each tool (low/medium/high); permissions stored in session or `WorkspaceConfig.riskPermissions`
- **Workspace index:** `workspaceIndex.ts` — async per-file metadata + outline cache at `.cafezin/workspace-index.json`; agent uses ranked index for fast retrieval (max 300 files)
- **Task service:** `taskService.ts` — per-agent task list at `.cafezin/tasks.json`; scoped by `agentId`
- **Windowing:** `windowing.ts` — open additional Tauri `WebviewWindow` per workspace
- **Vercel publish:** `publishVercel.ts` — deploy local folder to Vercel via REST API from within the agent
- **Account service:** `accountService.ts` — entitlement cache from Supabase RPC; free-user TTL 30min, premium grace 5 days (tolerates offline)
- **Terminal / bottom panel:** `BottomPanel.tsx` — embedded shell + file-stat status strip (word count, lines, TS errors)
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
├── app/
│   ├── src/
│   │   ├── components/
│   │   │   ├── app/
│   │   │   │   ├── AppEditorArea.tsx/css      # Main content area (editor + bottom panel layout)
│   │   │   │   ├── AppHeader.tsx/css           # Top header bar (workspace name, actions)
│   │   │   │   └── AppOverlays.tsx             # App-level overlay/modal collection
│   │   │   ├── ai/
│   │   │   │   ├── AIAuthScreen.tsx            # GitHub Copilot device-flow OAuth screen
│   │   │   │   ├── AICodeBlock.tsx             # Syntax-highlighted code block in AI chat
│   │   │   │   ├── AIMarkdownText.tsx          # Rich markdown renderer for AI responses
│   │   │   │   ├── AIModelPicker.tsx           # Model selector (per-provider)
│   │   │   │   ├── AIToolProcess.tsx           # Live tool-call progress display in chat
│   │   │   │   ├── ManagedAIQuotaModal.tsx/css # Quota modal for Cafezin IA credits
│   │   │   │   └── PremiumGate.tsx/css         # Paywall gate for premium-only features
│   │   │   ├── canvas/
│   │   │   │   ├── CanvasAIContext.tsx         # Canvas AI context provider
│   │   │   │   ├── canvasAssets.ts             # Static asset definitions
│   │   │   │   ├── canvasConstants.ts          # SLIDE_W/H/GAP + other constants
│   │   │   │   ├── CanvasContextMenus.tsx      # Right-click context menus
│   │   │   │   ├── canvasFontOverrides.ts      # Font registration for tldraw
│   │   │   │   ├── CanvasFormatPanel.tsx       # Shape format panel (rotation, opacity, align…)
│   │   │   │   ├── CanvasImageDialog.tsx       # Image insert dialog
│   │   │   │   ├── CanvasOverlays.tsx          # Canvas overlays (AI marks, etc.)
│   │   │   │   ├── CanvasPresentOverlay.tsx    # Presentation mode overlay
│   │   │   │   ├── CanvasSlideStrip.tsx        # Bottom slide thumbnail strip
│   │   │   │   ├── canvasTheme.ts              # tldraw theme config
│   │   │   │   ├── canvasTypes.ts              # Canvas-specific type helpers
│   │   │   │   └── hooks/                      # Canvas-specific hooks
│   │   │   ├── mobile/
│   │   │   │   ├── MobileCopilot.tsx           # Mobile AI chat panel
│   │   │   │   ├── MobileFileBrowser.tsx       # Mobile workspace file browser
│   │   │   │   ├── MobileOnboarding.tsx        # Mobile first-run onboarding
│   │   │   │   ├── MobilePreview.tsx           # Mobile document preview
│   │   │   │   ├── MobileSettingsSheet.tsx     # Mobile settings bottom sheet
│   │   │   │   ├── MobileVoiceMemo.tsx         # Voice memo recorder
│   │   │   │   └── ToastList.tsx               # Mobile toast notification list
│   │   │   ├── settings/
│   │   │   │   ├── AccountTab.tsx              # Account + subscription info
│   │   │   │   ├── AgentTab.tsx                # Agent prefs + risk permissions
│   │   │   │   ├── AITab.tsx                   # AI provider/model selection + API keys
│   │   │   │   ├── GeneralTab.tsx              # General prefs (theme, font, etc.)
│   │   │   │   ├── McpTab.tsx                  # MCP server configuration
│   │   │   │   ├── ShortcutsTab.tsx            # Keyboard shortcuts table
│   │   │   │   ├── SyncTab.tsx                 # Git sync + Supabase accounts
│   │   │   │   └── WorkspaceTab.tsx            # Workspace-level settings + Vercel config
│   │   │   │   # — Root-level components —
│   │   │   ├── Editor.tsx/css                  # CodeMirror 6 Markdown editor + ghost text + AI marks
│   │   │   ├── ProseEditor.tsx/css             # Tiptap WYSIWYG editor (Grammarly-compatible)
│   │   │   ├── CanvasEditor.tsx/css            # tldraw v4 canvas (uses canvas/ subfolder)
│   │   │   ├── AIPanel.tsx/css                 # Right-side AI chat outer container
│   │   │   ├── AgentSession.tsx                # Single agent instance (messages, input, tools)
│   │   │   ├── AIMarkOverlay.tsx/css           # Floating chips over AI-marked text
│   │   │   ├── AIReviewPanel.tsx/css           # Modal: pending AI edit marks per file
│   │   │   ├── BacklinksPanel.tsx/css          # Backlinks + outlinks strip below editor
│   │   │   ├── BottomPanel.tsx/css             # Embedded terminal + file-stat status strip
│   │   │   ├── ContactDialog.tsx/css           # In-app contact form
│   │   │   ├── DesktopOnboardingModal.tsx/css  # First-run desktop onboarding
│   │   │   ├── DocxInfoPanel.tsx/css           # .docx info + extract view
│   │   │   ├── EditorErrorBoundary.tsx         # Error boundary for editor crashes
│   │   │   ├── ExportModal.tsx/css             # Export workspace/file (PDF, ZIP…)
│   │   │   ├── FeedbackNudge.tsx/css           # Contextual feedback prompt
│   │   │   ├── FindReplaceBar.tsx/css          # In-editor find/replace (⌘F)
│   │   │   ├── ForceUpdateModal.tsx/css        # Mandatory update blocker modal
│   │   │   ├── ImageSearchPanel.tsx/css        # Pexels stock photo search
│   │   │   ├── MarkdownPreview.tsx/css         # Read-only MD rendered HTML (marked)
│   │   │   ├── MediaViewer.tsx/css             # Image/video inline viewer
│   │   │   ├── MobilePendingModal.tsx/css      # Mobile: cross-device pending tasks
│   │   │   ├── NudgeToast.tsx/css              # Contextual nudge toast notifications
│   │   │   ├── PDFViewer.tsx/css               # Native PDF embed (Tauri asset://)
│   │   │   ├── PptxInfoPanel.tsx/css           # .pptx info + slide count
│   │   │   ├── ProjectSearchPanel.tsx/css      # Workspace-wide search + replace
│   │   │   ├── RtfViewer.tsx/css               # RTF → plain text viewer
│   │   │   ├── SettingsModal.tsx/css           # Settings (tabs: General/AI/Agent/Sync/MCP/Account/Workspace/Shortcuts)
│   │   │   ├── Sidebar.tsx/css                 # Left file-tree explorer; context menus
│   │   │   ├── SpreadsheetViewer.tsx/css       # .xlsx/.csv spreadsheet viewer
│   │   │   ├── SplashScreen.tsx/css            # App loading splash screen
│   │   │   ├── SyncModal.tsx/css               # Git commit + push
│   │   │   ├── TabBar.tsx/css                  # Open-file tabs
│   │   │   ├── UpdateReleaseModal.tsx/css      # Release notes shown on update
│   │   │   ├── WebPreview.tsx/css              # Embedded web page preview
│   │   │   ├── WorkspaceHome.tsx/css           # Dashboard when no file is open
│   │   │   └── WorkspacePicker.tsx/css         # First-run workspace selection
│   │   ├── services/
│   │   │   ├── copilot/                        # GitHub Copilot service
│   │   │   │   ├── index.ts                    # Re-exports: streamCopilotChat, runCopilotAgent, fetchCopilotModels
│   │   │   │   ├── auth.ts                     # Device flow OAuth + token storage
│   │   │   │   ├── compression.ts              # Context compression + summarization
│   │   │   │   ├── constants.ts                # API URLs, model IDs, limits
│   │   │   │   ├── diagnostics.ts              # Last request dump for debugging
│   │   │   │   ├── messages.ts                 # Message formatting + context management
│   │   │   │   ├── models.ts                   # Model fetching + FALLBACK_MODELS
│   │   │   │   ├── streaming.ts                # SSE streaming
│   │   │   │   ├── tokenBudget.ts              # Token estimation + summarization trigger
│   │   │   │   └── toolParsing.ts              # Tool-call extraction
│   │   │   ├── ai/                             # Multi-provider AI helpers
│   │   │   │   ├── diagnostics.ts              # Last request dump per provider
│   │   │   │   ├── messageConverter.ts         # Message format adapters per provider
│   │   │   │   ├── providerModels.ts           # Model catalog per provider
│   │   │   │   ├── runProviderAgent.ts         # Provider-generic agent loop
│   │   │   │   └── tools-adapter.ts            # Tool definition format adapters
│   │   │   ├── accountService.ts               # Account state / entitlement cache (Supabase RPC)
│   │   │   ├── aiProvider.ts                   # Multi-provider dispatcher (BYOK)
│   │   │   ├── aiSessionHistory.ts             # Per-session message history persistence
│   │   │   ├── aiMarks.ts                      # AI mark tracking (.cafezin/ai-marks.json)
│   │   │   ├── apiSecrets.ts                   # Encrypted API key storage (localStorage + Supabase)
│   │   │   ├── config.ts                       # App + workspace config paths/constants
│   │   │   ├── copilotLock.ts                  # Prevents concurrent Copilot requests
│   │   │   ├── copilotLog.ts                   # Session log (copilot-log.jsonl)
│   │   │   ├── fs.ts                           # File system wrappers (@tauri-apps/plugin-fs)
│   │   │   ├── mcpClient.ts                    # MCP server lifecycle + tool exposure
│   │   │   ├── memoryMetadata.ts               # Workspace memory file helpers
│   │   │   ├── mobilePendingTasks.ts           # Cross-device pending task queue
│   │   │   ├── publishVercel.ts                # Deploy local folder to Vercel via REST API
│   │   │   ├── spreadsheet.ts                  # Spreadsheet file parsing
│   │   │   ├── storageKeys.ts                  # SK constant map for localStorage keys
│   │   │   ├── supabase.ts                     # Supabase client singleton
│   │   │   ├── syncConfig.ts                   # Auth + workspace sync (Supabase)
│   │   │   ├── taskService.ts                  # Per-agent task list in .cafezin/tasks.json
│   │   │   ├── terminalBus.ts                  # Event bus for BottomPanel terminal I/O
│   │   │   ├── windowing.ts                    # Multi-window via Tauri WebviewWindow
│   │   │   ├── workspace.ts                    # loadWorkspace, readFile, writeFile, buildFileTree
│   │   │   ├── workspaceIndex.ts               # File index + outline cache (.cafezin/workspace-index.json)
│   │   │   └── workspaceSession.ts             # Active workspace session state
│   │   ├── utils/
│   │   │   ├── tools/                          # Agent tool implementations
│   │   │   │   ├── canvasTools.ts              # Canvas manipulation tools
│   │   │   │   ├── configTools.ts              # Config read/write tools
│   │   │   │   ├── fileTools.ts                # File CRUD tools
│   │   │   │   ├── mcpTools.ts                 # MCP tool bridge
│   │   │   │   ├── shared.ts                   # ToolDefinition / ToolExecutor types
│   │   │   │   ├── skillTools.ts               # Skill/memory tools
│   │   │   │   ├── taskTools.ts                # Task CRUD tools
│   │   │   │   └── webTools.ts                 # Web search/fetch tools
│   │   │   ├── agentCapabilities.ts            # Tool capability flags per context
│   │   │   ├── agentPromptContext.ts           # System prompt builder
│   │   │   ├── aiMarkMatch.ts / aiMarkRevert.ts # AI mark diff/revert helpers
│   │   │   ├── appUtils.ts                     # General app utilities
│   │   │   ├── assistantFileLinks.ts           # Parse/render file links in AI responses
│   │   │   ├── canvasAI.ts                     # Canvas AI commands + summarization
│   │   │   ├── canvasAICommands/Snapshot/Summary.ts  # Canvas AI sub-utilities
│   │   │   ├── canvasRegistry.ts               # Canvas shape type registry
│   │   │   ├── exportPDF.ts / exportWorkspace.ts  # Export utilities
│   │   │   ├── fileType.ts                     # Extension → kind/mode/language
│   │   │   ├── ghostText.ts                    # CodeMirror 6 inline completion extension
│   │   │   ├── htmlPreview.ts                  # HTML preview rendering
│   │   │   ├── livePreview.ts                  # Live preview sync helpers
│   │   │   ├── markdownRender.ts               # Markdown → HTML (safe mode)
│   │   │   ├── mathPreprocess.ts               # KaTeX/MathJax preprocessing
│   │   │   ├── mime.ts                         # MIME type helpers
│   │   │   ├── readPdfText.ts                  # PDF text extraction
│   │   │   ├── riskGate.ts                     # Tool-call risk interception + permission prompts
│   │   │   ├── rtfToText.ts                    # RTF → plain text converter
│   │   │   ├── slidePreviews.ts                # Canvas slide thumbnail generation
│   │   │   ├── toolRisk.ts                     # Risk level classification per tool
│   │   │   ├── voiceLanguage.ts                # Voice input language detection
│   │   │   ├── workspaceRoutines.ts            # Workspace type detection + agent routines
│   │   │   ├── workspaceTools.ts               # WORKSPACE_TOOLS + buildToolExecutor()
│   │   │   └── workspaceTypes.ts               # Workspace type classification
│   │   ├── hooks/                              # React hooks (useBacklinks, useWorkspace, etc.)
│   │   ├── types/
│   │   │   └── index.ts                        # All shared TS interfaces + enums
│   │   ├── App.tsx                             # Root: tabs, sidebar, editor routing, modals, multi-window
│   │   └── App.css
│   ├── src-tauri/
│   │   ├── src/
│   │   │   ├── lib.rs           # Tauri commands: git_*, update_app, terminal, MCP process mgmt
│   │   │   └── main.rs
│   │   ├── capabilities/default.json  # FS + HTTP permissions
│   │   └── tauri.conf.json
│   ├── .env                     # VITE_GITHUB_TOKEN=... (gitignored, optional)
│   └── .env.example
├── docs/
├── landing/                     # Static HTML landing pages (Vercel output)
├── scripts/
│   ├── build-mac.sh
│   ├── update-app.sh
│   └── sync.sh
├── AGENT.md
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

| File type          | Mode           | Toggle shown                 | Notes                                                                                          |
| ------------------ | -------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `.md` / `.mdx`     | Edit (default) | Yes — Edit / Preview / Prose | Edit = CodeMirror 6 + ghost text; Preview = `marked` (GFM); Prose = Tiptap WYSIWYG (Grammarly) |
| `.txt`             | Edit (default) | Yes — Edit / Prose           | Prose mode available for plain-text files too                                                  |
| `.pdf`             | Preview only   | No                           | `convertFileSrc` → WebKit embed                                                                |
| `.tldr.json`       | Canvas only    | No                           | tldraw v4; JSON snapshot stored on disk; Frames = slides                                       |
| `.xlsx` / `.csv`   | Spreadsheet    | No                           | `SpreadsheetViewer.tsx` — table render with filtering                                          |
| `.docx`            | Info panel     | No                           | `DocxInfoPanel.tsx` — metadata + text extraction                                               |
| `.pptx`            | Info panel     | No                           | `PptxInfoPanel.tsx` — slide count + metadata                                                   |
| `.rtf`             | Plain text     | No                           | `RtfViewer.tsx` — RTF → plain text for reading                                                 |
| `.html`            | Web preview    | No                           | `WebPreview.tsx` — embedded browser view                                                       |
| `.ts`, `.js`, code | Edit only      | No                           | CodeMirror, syntax HL via CM6 language extensions                                              |
| image/video        | Media viewer   | No                           | `MediaViewer.tsx` — binary Tauri fs read → object URL                                          |
| unknown            | Edit only      | No                           | Plain text fallback                                                                            |

---

## AI Model Picker

- Provider tabs in `AITab` (Settings): Cafezin IA, GitHub Copilot, OpenAI, Anthropic, Groq, Google, Custom/Local
- `AIModelPicker.tsx` shows models available for the active provider
- Cafezin IA: default provider for new users; uses managed credits; `ManagedAIQuotaModal` shown on quota exhaustion
- Copilot rate badges: **free** (green, 0×), **standard** (blue, 1×), **premium** (yellow, >1×)
- `modelSupportsVision(id)` — false for o-series models (`/^o\d/`)
- `FALLBACK_MODELS`: gpt-4o-mini (free, vision ✓), gpt-4o (1×, vision ✓), claude-sonnet-4-5 (1×, vision ✓), o3-mini (1×, vision ✗)
- Custom endpoint URL + model ID are **localStorage-only** (never synced, for privacy)

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

## Known Limitations / Notes

- **Ghost text** only works with providers that support fast completions (Copilot, OpenAI, Groq); disabled for Anthropic that doesn't have a `/completions` endpoint
- **`git_sync`** — best-effort push to `origin HEAD`; no remote = silently OK
- **Risk gate UX:** medium/high-risk tools show a confirm dialog; granted permissions stored per-session or permanently in `WorkspaceConfig.riskPermissions`
- **Workspace index** rebuilds incrementally on file change; max 300 files tracked
- **MCP servers** start/stop as child processes via Tauri commands; each tool prefixed `mcp__<serverId>__<toolName>`

---

## Supabase — RLS Policy Authoring Rules

**Sempre** envolva chamadas a `auth.uid()`, `auth.email()`, `auth.jwt()` e `current_setting()` em `(select ...)` dentro de cláusulas `USING` / `WITH CHECK` de policies RLS.

```sql
-- ✅ CORRETO
CREATE POLICY "example" ON my_table
  FOR ALL
  USING ((select auth.uid()) = user_id);

-- ❌ ERRADO — reavaliado por linha, gera lint warning "Auth RLS Initialization Plan"
CREATE POLICY "example" ON my_table
  FOR ALL
  USING (auth.uid() = user_id);
```

Corrigido em março/2026 via `supabase/migrations/0003_fix_rls_auth_init_plan.sql`.

---

## Landing Pages

**Location:** `cafezin/landing/` (EN) and `cafezin/landing/br/` (PT-BR)  
**Deploy:** Static files served by Vercel — `outputDirectory: "landing"`, `cleanUrls: true`  
**Design system:** `style.css` (dark `#111110`, amber accent `#D4A853`, Newsreader serif + Manrope UI)  
**Analytics:** `landing-analytics.js` + gtag `G-0PNRME8PLH`

### ⚠️ REGRA CRÍTICA — Adaptação de plataforma (Mac ↔ Windows)

Cafezin roda em **Mac E Windows**. Toda landing page deve adaptar o conteúdo para a plataforma do visitante.
O mecanismo é implementado em `landing-analytics.js` e chamado automaticamente via `adaptHeroCta()` + `adaptPlatformContent()`.

**Nunca escreva copy Mac-only nas landings.** Sempre use os mecanismos abaixo:

#### Mecanismo 1 — IDs de botão para herós (tratados em `adaptHeroCta()`)

| ID                | Windows recebe                                         |
| ----------------- | ------------------------------------------------------ |
| `js-hero-primary` | href → `/download/windows`, label via `data-win-label` |
| `js-hero-alt`     | href → `/download/mac` (inverte)                       |
| `js-cta-primary`  | href → `/download/windows`, label via `data-win-label` |
| `js-cta-alt`      | href → `/download/mac`                                 |
| `js-pricing-free` | href → `/download/windows`, label via `data-win-label` |
| `js-lp-primary`   | href → `/download/windows` (LP dedicada)               |
| `js-lp-final`     | href → `/download/windows` (LP dedicada)               |

Botão principal sempre usa `id` acima + `data-win-label="Download free for Windows →"`.  
Botão secundário usa `id` acima + `data-win-label="Mac"` (ou texto equivalente).

#### Mecanismo 2 — Texto/HTML genérico (tratados em `adaptPlatformContent()`)

```html
<!-- Troca innerHTML inteiro no Windows -->
<p data-win-content="Windows 10+·64-bit·~90 MB·Code-signed">
  macOS 13+·~68 MB·Notarized by Apple
</p>

<!-- Troca só o texto no Windows -->
<span data-win-text="Windows">Mac</span>

<!-- Esconde no Windows -->
<span class="platform-mac">Apple Silicon</span>

<!-- Mostra só no Windows (hidden por padrão) -->
<span class="platform-win" hidden>64-bit installer</span>
```

#### Mecanismo 3 — Destaque de botão em páginas com ambas plataformas

Em páginas que listam Mac E Windows lado a lado (ex: `download.html`), `adaptHeroCta()` troca as classes:

- `a[data-platform='mac'].btn-primary` → vira `btn-outline`
- `a[data-platform='windows'].btn-outline` → vira `btn-primary`

Assim o botão Windows aparece como destaque para visitantes Windows.

#### Specs por plataforma

|                | macOS                     | Windows                       |
| -------------- | ------------------------- | ----------------------------- |
| Requisitos     | macOS 13 Ventura+         | Windows 10+                   |
| Arquitetura    | Apple Silicon & Intel     | 64-bit                        |
| Tamanho        | ~68 MB                    | ~90 MB                        |
| Assinatura     | Notarized by Apple        | Code-signed                   |
| Texto do botão | `Download free for Mac →` | `Download free for Windows →` |
| Href           | `/download/mac`           | `/download/windows`           |

### Páginas existentes (EN)

| Arquivo                                                                                                               | Tipo          | Status plataforma              |
| --------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------ |
| `index.html`                                                                                                          | Homepage      | ✅ adaptado                    |
| `pricing.html`                                                                                                        | Pricing       | ✅ adaptado                    |
| `download.html`                                                                                                       | Downloads     | ✅ adaptado (destaque inverte) |
| `about.html`                                                                                                          | About         | ✅ adaptado                    |
| `writers.html`, `educators.html`, `copywriters.html`, `students.html`, `content-creators.html`, `knowledge-work.html` | Niche         | ✅ (fallback genérico)         |
| `compare-*.html`                                                                                                      | Comparações   | ✅ (fallback genérico)         |
| `lp/markdown-editor-mac.html`                                                                                         | Google Ads LP | ✅ adaptado                    |

### ⚠️ REGRA CRÍTICA — Tracking de conversão (Google Ads / GA4)

**TODA landing page DEVE ter rastreamento correto nos CTAs. Sem isso o Google Ads não sabe o que converter.**

Checklist obrigatório para qualquer botão de download/CTA principal:

1. **Classe `btn-download`** — obrigatória em **todos** os `<a>` que levam a `/download/mac` ou `/download/windows`.
   Sem essa classe o `landing-analytics.js` **não dispara** o evento `file_download`.

2. **O evento `file_download`** é disparado automaticamente pelo `landing-analytics.js` em todo elemento `.btn-download`.
   Ele usa `gtagSendEvent()` que aguarda o callback do GA4 antes de navegar — garantindo que o hit seja enviado.

3. **Nunca criar um CTA de download sem `btn-download`** — nem em LPs novas, nem ao duplicar botões existentes.

4. **Verificação rápida após criar/editar uma LP:**

   ```bash
   grep -n 'btn-download' cafezin/landing/caminho/para/pagina.html
   # Deve aparecer em TODOS os links de /download/mac e /download/windows
   ```

5. **Configuração no Google Ads:** o evento `file_download` deve estar marcado como conversão no
   GA4 → Administrador → Eventos → Marcar como conversão. O Google Ads importa automaticamente.

### Estrutura padrão de uma nova landing (CTA hero)

```html
<a
  href="/download/mac"
  id="js-hero-primary"
  class="btn btn-primary btn-download"
  data-platform="mac"
  data-win-label="Download free for Windows →"
>
  <svg data-icon="mac" ...></svg>
  <svg data-icon="win" ... style="display:none"></svg>
  <span data-cta-label>Download free for Mac →</span>
</a>
<a
  href="/download/windows"
  id="js-hero-alt"
  class="btn btn-outline btn-download hero-link"
  data-platform="windows"
  data-win-label="Also on Mac"
  >Also on Windows</a
>

<!-- Sysreq — adapta no Windows via data-win-content -->
<p class="hero-sysreq" data-win-content="Windows 10+·64-bit·~90 MB·Code-signed">
  macOS 13 Ventura+·Apple Silicon & Intel·~68 MB·Notarized by Apple
</p>
```

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

## Release / Distribution Notes (Mac + Windows + Mobile)

- **Version bump:** `app/package.json` + `app/src-tauri/Cargo.toml` must match.
- **macOS builds:** notarization is **manual** and only done in release builds by the
  release scripts. Credentials (Apple ID, app-specific password, signing identity)
  live in `pedrin/.env` (`APPLE_*` vars) and are loaded by the scripts — never
  hardcode them. `./scripts/build-mac.sh` produces the DMG; test on a clean machine
  before shipping.
- **Windows SmartScreen:** the binary is **not Authenticode-signed**, so first
  installs show a SmartScreen warning. Two mitigations exist:
  - **Microsoft Store** (recommended): `npx tauri:windows-store` builds the MSIX
    via `src-tauri/tauri.microsoftstore.conf.json` (Store ID `9PKJ83V2S357`). The
    MSIX build sets the `msix` feature so `build_channel()` disables the in-app
    updater (Store handles updates).
  - **Direct download:** expect the warning; document "More info → Run anyway" in
    the landing page FAQ.
- **In-app updater:** served from GitHub releases (minisign pubkey in
  `tauri.conf.json`); requires the release script to push `latest.json` +
  signed bundles. Skip for Store/MSIX builds (handled by Store).
- **Git dependency:** desktop builds use the **system `git` binary**. If it's
  missing, the app now surfaces a warning on the workspace picker
  (`git_available` Tauri command). Mobile/MAS builds use bundled libgit2
  (`mas` feature) — no system dependency.
- **Android (mobile):** run `ANDROID_HOME=~/Library/Android/sdk JAVA_HOME=/Applications/Android\ Studio.app/Contents/jbr/Contents/Home npx tauri android build --debug --apk`
  (requires NDK `27.1.12297006` + `platforms;android-36` installed via
  `sdkmanager`). First build needs the toolchain env vars
  (`CC_aarch64_linux_android`/`AR_...`/`CARGO_TARGET_..._LINKER` pointing at
  `$ANDROID_HOME/ndk/<ver>/toolchains/llvm/prebuilt/darwin-x86_64/bin`).
  `reqwest`/`tauri-plugin-http` are pinned to `rustls-tls` so no OpenSSL
  cross-compile is needed.
- **Browser build:** `npm run build:web` → `dist-web/` (static site, OPFS-backed
  filesystem, no git/cloud sync/MCP — feature-gated via `src/web/` shims).

---

## Session Notes

> Full history moved to [`docs/session-log.md`](docs/session-log.md) to keep this file lean.
> Add new entries there, not here.

**Last significant sessions (summary):**

- **2026-02-22** — Project init → Phase 1 scaffold → file tree → model picker → edit/preview → tldraw canvas → sidebar creator → present mode → slide strip (Figma-style).
- **2026-02-23** — Canvas AI hardening → slide strip UX overhaul → image save fix → AI review panel wired → context summarization → slide sync & theme hardening → theme bg fix → slide layouts → format panel v1+v2 (rotation, opacity, align, lock, corner radius, shadow, geo picker, dimensions, layer order, group/ungroup, flip) → AI error recovery.
- **2026-02-28** — Export system v2: added 5 new PDF target capabilities: (1) **Custom CSS** (`pdfCssFile`) — workspace-relative `.css` appended after default styles; (2) **Title page** (`titlePage`) — title/subtitle/author/version page prepended to PDF; (3) **TOC** (`toc: true`) — auto-generates H1/H2 table of contents for merged PDFs; (4) **Output versioning** (`versionOutput: 'timestamp'|'counter'`) — date-stamped or auto-incremented filenames; (5) **Pre-export transformations** (`preProcess`) — strip YAML frontmatter, `### Draft` sections, `<details>` blocks before rendering.
- **2026-03-02** — Agent capability improvements: (1) **`multi_patch` tool** — applies an array of `{path, search, replace, occurrence}` patches across multiple files in one round-trip; files are read once, all patches applied in memory, then written once per file; (2) **Context depth increased** — AGENT.md 3000→8000 chars, documentContext 6000→15000 chars, memory 4000→6000 chars; (3) **Test-aware system prompt** — agent now instructed to run tests (`npm test`, `pytest`, `tsc --noEmit`) after edits in code workspaces and iterate on failures; (4) **Multi/surgical edit guidance** — system prompt now explicitly teaches when to use `patch_workspace_file` vs `multi_patch` vs `write_workspace_file`. (5) **`publish_vercel` improvements** — new `setup` action scaffolds `vercel.json` + `.vercelignore` for `static`/`spa`/`demos`/`node` project types; `deploy` action gains `buildCommand` + `buildOutputDir` params for one-shot build-then-deploy; Demo Hub system prompt updated with setup workflow and vercel.json guidance.
- **2026-05 (this session)** — AGENT.md comprehensive update: documented multi-provider BYOK (`aiProvider.ts`), MCP integration (`mcpClient.ts`), ghost text (`ghostText.ts`), ProseEditor (Tiptap WYSIWYG), BacklinksPanel, BottomPanel (terminal), SpreadsheetViewer / DocxInfoPanel / PptxInfoPanel / RtfViewer / WebPreview, RiskGate + toolRisk, workspaceIndex, taskService, windowing, publishVercel, accountService, mobile app subfolder, all new component subfolders (ai/, canvas/, mobile/, settings/, app/), services/copilot/ and services/ai/ subfolders, utils/tools/ subfolder.
