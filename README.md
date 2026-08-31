# Cafezin

Cafezin is a local-first AI book-authoring workspace for writers.

It combines Markdown documents, a focused prose editor, built-in git, reviewable AI edits, and PDF export in one app. The goal is to support the complete writing loop — structure, drafting, revision, continuity, and delivery — without forcing a book into a cloud-first editor or a blank chat box.

## What Cafezin Is For

Cafezin is designed for workflows such as:

- Writing books and long-form drafts
- Organizing chapters, notes, and book research as local files
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
| `scripts/release-version.sh`     | Checkpoint dirty changes, bump `major`/`minor`/`patch`, sync app versions, push, and trigger macOS + Windows + iOS release flows |

Usage:

```sh
bash scripts/sync.sh "optional commit message"
bash scripts/build-windows-store.sh --tag v0.2.0
bash scripts/release-version.sh patch
bash scripts/release-version.sh minor --no-wait-windows
```

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
