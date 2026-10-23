# Cafezin

Cafezin is a local-first writing workspace for books, reports, and connected Markdown notes.

It combines Markdown documents, a focused prose editor, built-in git, reviewable AI edits, and PDF export in one app. The goal is to support the complete writing loop — structure, drafting, revision, continuity, and delivery — without forcing a book into a cloud-first editor or a blank chat box.

## What Cafezin Is For

Cafezin is designed for workflows such as:

- Writing books, reports, and long-form drafts
- Organizing chapters, notes, and research as local Markdown files
- Connecting documents with clickable `[[wiki links]]` and relative Markdown links
- Using AI to draft, revise, summarize, and check continuity with real workspace context
- Exporting a manuscript to a configured PDF target

## Core Product Ideas

- Local-first by default: files stay on the user's device
- Plain Markdown files: portable, readable, and git-friendly
- Book-first workspace: Markdown and plain text are the primary authoring formats
- Reviewable AI edits: AI suggestions stay inspectable before becoming final
- Built-in version history: workspaces can keep git history from the start
- BYOK AI model access: users can connect providers such as GitHub Copilot, OpenAI, or Anthropic

## Who It Is For

- Writers who want AI help without losing voice or editorial control
- Authors who need drafting, outlining, continuity, and export in one local workspace

## Status

Cafezin is in active early development as a focused Mac/desktop book-authoring tool.

Current public positioning:

- Desktop-first product for macOS (Windows remains a Tauri target)
- Mobile companion work is out of scope for this authoring slice

## Repository Structure

- `app/` — Tauri + React application
- `landing/` — static marketing site and public pages
- `supabase/` — auth, billing, and sync-related backend resources
- `scripts/` — build, sync, and release helpers

## Scripts

| Script                           | Description                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/sync.sh`                | Stage all changes, commit, and push to `origin/main`                                                                             |
| `scripts/build-windows-store.sh` | Trigger the Microsoft Store Windows MSI build in GitHub Actions                                                                  |
| `scripts/release-version.sh`     | Checkpoint changes, bump version, push, and release macOS + Windows; iOS requires `--with-ios` |
| `scripts/build-all.sh`           | Desktop release entrypoint; mobile targets are explicit opt-ins |
| `scripts/clean-builds.py`        | Preview disposable build outputs; add `--apply` to remove them safely |

Usage:

```sh
bash scripts/sync.sh "optional commit message"
bash scripts/build-windows-store.sh --tag v0.2.0
bash scripts/release-version.sh patch
bash scripts/release-version.sh minor --no-wait-windows
# Only when intentionally working on the parked mobile target:
bash scripts/release-version.sh patch --with-ios
```

Release commands publish artifacts and may commit/push changes; they are not validation commands.

## Keeping Local Builds Small

```sh
python3 scripts/clean-builds.py          # preview only
# Stop Cargo, Gradle, Xcode and dev/build processes first:
python3 scripts/clean-builds.py --apply
python3 scripts/test-clean-builds.py    # safety tests in temporary directories
```

The cleaner removes only allowlisted Rust/Android/iOS build outputs, frontend outputs,
and Vercel staging output. It refuses tracked files and symlinked output paths. It keeps
native project sources, dependencies, videos, git history, credentials, and writing workspaces.
The next native build will be slower. Rust development builds use line-table debug symbols
and no incremental cache to limit disk growth; release settings are unchanged.

## Focused Writing, Not a General-Purpose Workbench

The product centers on Markdown/plain text, Prose editing, connected references, research,
reviewable AI changes, git history, and manuscript PDF export. Canvas/slides, PowerPoint,
spreadsheet/Office viewers, shell tools, and Vercel publishing are outside the product.
Removing a reader must never delete the corresponding file or load binary data into a text editor.

The assistant stays beside the document. Text changes are marked for human review; users can
inspect, accept, or reject them instead of losing track of what the AI changed.

See [the simplification notes](docs/authoring-simplification.md) for the implementation scope.

## Windows Store Build

Cafezin's Windows Store path generates a real MSIX package — no Authenticode certificate required.

- The CI runner generates a self-signed certificate on the fly.
- Microsoft re-signs the MSIX with their certificate when you submit via Partner Center.
- End users install from the Store and receive the Microsoft-signed version (no SmartScreen warning).

**How it works:**

1. GitHub Actions (`windows-latest`) builds the Cafezin binary + frontend
2. Packages it as an MSIX using the Windows SDK's `makeappx.exe`
3. Signs with the ephemeral self-signed cert
4. Uploads the artifact → you download `Cafezin.msix` and submit to Partner Center

**Trigger the build:**

```sh
# First run (uses placeholder identity — fine for testing)
bash scripts/build-windows-store.sh --tag v0.1.9

# After registering on Partner Center, pass your assigned values:
bash scripts/build-windows-store.sh --tag v0.1.9 \
  --identity "12345AbcDef.Cafezin" \
  --publisher "CN=Pedro Martinez, O=PedroMartinez, ..."
```

Download the `windows-store-msix` artifact from the Actions run and submit `Cafezin.msix` in Partner Center.

**One-time Partner Center setup (free for individuals):**

1. Register at https://partner.microsoft.com/dashboard/registration/developer
2. Reserve the app name → note the assigned **Identity Name** and **Publisher** values
3. Run the build script above with those values before submitting

## Getting Started

```sh
git clone https://github.com/pvsmartinez/cafezin.git
cd cafezin
```

For project-specific implementation details, product direction, and AI session context, see [AGENT.md](AGENT.md).
