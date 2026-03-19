# Cafezin

Cafezin is a local-first AI writing and knowledge workspace for writers, educators, creators, and serious note-takers.

It combines Markdown documents, a visual canvas, slide creation, voice capture, built-in git, and reviewable AI edits in one app. The goal is to give non-technical knowledge workers the kind of deep, contextual AI workflow that developers get from VS Code and Copilot, without forcing their work into a cloud-first editor or a blank chat box.

## What Cafezin Is For

Cafezin is designed for workflows such as:

- Writing books, essays, scripts, and long-form drafts
- Building classes, lessons, courses, and curricula
- Organizing research, notes, and second-brain style knowledge bases
- Planning ideas visually on a canvas and turning them into slides
- Using AI to draft, revise, summarize, and brainstorm with real workspace context

## Core Product Ideas

- Local-first by default: files stay on the user's device
- Plain Markdown files: portable, readable, and git-friendly
- Visual canvas: map ideas, flows, and structures beside documents
- Reviewable AI edits: AI suggestions stay inspectable before becoming final
- Built-in version history: workspaces can keep git history from the start
- Voice capture: record and transcribe ideas into the same workspace
- BYOK AI model access: users can connect providers such as GitHub Copilot, OpenAI, or Anthropic

## Who It Is For

- Writers who want AI help without losing voice or editorial control
- Educators who move between notes, lesson plans, and slide-ready structures
- Content creators who need drafting, outlining, and visual planning in one place
- Knowledge workers who want a calmer local-first alternative to scattered note, whiteboard, and chat tools

## Status

Cafezin is in active early development.

Current public positioning:

- Desktop-first product for macOS and Windows
- Web experience is primarily marketing and account management today
- iPhone and Android experiences are planned and partially in progress

## Repository Structure

- `app/` — Tauri + React application
- `landing/` — static marketing site and public pages
- `supabase/` — auth, billing, and sync-related backend resources
- `scripts/` — build, sync, and release helpers

## Scripts

| Script            | Description                                          |
| ----------------- | ---------------------------------------------------- |
| `scripts/sync.sh` | Stage all changes, commit, and push to `origin/main` |

Usage:

```sh
bash scripts/sync.sh "optional commit message"
```

## Getting Started

```sh
git clone https://github.com/pvsmartinez/cafezin.git
cd cafezin
```

For project-specific implementation details, product direction, and AI session context, see [AGENT.md](AGENT.md).
