/**
 * Skill tools — on-demand protocol and best-practice guides.
 *
 * Instead of bloating the system prompt with every possible rule, verbose
 * protocols live here as structured Markdown strings. The agent calls
 * `read_skill(name)` when it is about to perform work in that area.
 *
 * Skills available:
 *   canvas      → Canvas / tldraw editing commands and layout rules
 *   book        → Long-form writing workflow
 *   spreadsheet → CSV / XLSX editing rules
 *   html        → Interactive HTML/CSS demo guidance
 *   code        → TypeScript / Node verification and editing
 *   export      → Export target protocol (PDF, ZIP, git-publish, custom)
 *   memory      → Detailed memory management and staleness rules
 *   tasks       → Multi-step task tracking protocol
 */

import type { ToolDefinition, DomainExecutor } from './shared';

// ── Skill content ─────────────────────────────────────────────────────────────

export const SKILL_CONTENT: Record<string, string> = {
  canvas: `# Canvas Skill — tldraw Editing Protocol

## Core rules (non-negotiable)
- **Never** write raw JSON to .tldr.json files. Only \`canvas_op\` may modify canvases.
- **Never** read .tldr.json with \`read_workspace_file\` — raw JSON contains huge base64 blobs. Use \`list_canvas_shapes\` instead.
- \`canvas_op\` always requires the \`expected_file\` parameter (relative path to the .tldr.json file).
- \`list_canvas_shapes\` only describes the **currently open** canvas. Confirm the "Canvas file:" header matches before editing.
- Call \`canvas_screenshot\` after every editing pass and fix visible problems before replying.

## Workflow before editing
1. Call \`list_canvas_shapes\` → read current shape IDs, positions, and occupied area.
2. Plan new shapes to avoid overlaps. Safe margins: x 80–1200, y 20–680 (inside 1280×720 slides).
3. Minimum gap between shapes: 20px. Text width >= 200px. Geo label width >= 120px.

## canvas_op command reference (one JSON object per call)
\`\`\`
{"op":"add_slide"}
{"op":"duplicate_slide","slide":"<frameId>"}
{"op":"apply_theme","slide":"<frameId>","theme":"dark"|"light"|"warm"|"cool"|"brand"}
{"op":"set_slide_background","slide":"<frameId>","color":"#xxxxxx"}
{"op":"recolor_slide","slide":"<frameId>","from":"<color>","to":"<color>"}

{"op":"create_lesson","slide":"<frameId>","title":"...","points":["...","..."]}
{"op":"add_two_col","slide":"<frameId>","left":["..."],"right":["..."]}
{"op":"add_bullet_list","slide":"<frameId>","items":["..."],"x":100,"y":100}

{"op":"add_note","slide":"<frameId>","text":"...","x":100,"y":100}
{"op":"add_geo","slide":"<frameId>","geo":"rectangle","x":100,"y":100,"w":200,"h":80,"label":"..."}
{"op":"add_arrow","from":"<shapeId>","to":"<shapeId>"}
{"op":"add_image","slide":"<frameId>","src":"<url_or_base64>","x":100,"y":100,"w":300,"h":200}

{"op":"move","id":"<shapeId>","x":200,"y":150}
{"op":"update","id":"<shapeId>","text":"new label","color":"blue","size":"xl"}
{"op":"delete","id":"<shapeId>"}

{"op":"clear","confirm":"yes"}  ← ⚠️ DANGER: wipes all shapes. Only when user says "limpar tudo" / "clear everything".
\`\`\`

## Style defaults
- Font: sans (default)
- Text sizes: title → xl | section → l | body → m | caption → s
- Max 3 colors per slide. Default palette: white, black, blue, grey
- Keep visual hierarchy clear — every slide should have one focal point

## Lesson workflow (new canvas)
1. Call \`list_workspace_files\` to see existing lesson canvases for reference.
2. Call \`create_folder\` or \`write_workspace_file\` to create the .tldr.json (use \`canvas_op\` to init).
3. One \`create_lesson\` call per slide for the main content flow.
4. Call \`canvas_screenshot\` → fix issues → reply with summary.

## Lesson workflow (add to existing canvas)
1. \`list_canvas_shapes\` to get existing frame IDs and layout.
2. Append new slides with \`canvas_op\` commands.
3. \`canvas_screenshot\` → fix → reply.`,

  book: `# Book-Writing Skill

## Core principle
Human-first: never write whole chapters unprompted. Work in small, reviewable increments.

## Before writing
1. \`outline_workspace\` — understand the document tree and what files exist.
2. Read \`.cafezin/memory.md\` (already injected in prompt) for characters, plot, world, style decisions.
3. \`search_workspace("<character name>"|"<key term>")\` for continuity clues before writing new scenes.

## Writing workflow
- Draft one section, scene, or paragraph at a time. Summarize what you wrote, then pause for review.
- \`mark_for_review\` on substantial AI-generated passages so the user can inspect and accept.
- \`patch_workspace_file\` for targeted edits. \`write_workspace_file\` only for new files or full rewrites the user explicitly requested.

## What to remember (workspace scope)
Use \`remember(scope="workspace")\` for durable facts:
- Characters: name, role, physical description, arc, relationships
- Plot: key events, scene order, twists decided
- World: rules, places, timeline, lore
- Glossary: invented terms and definitions
- Style guide: POV, tense, tone, words to avoid, sentence rhythm

## Word count
Call \`word_count\` when the user asks progress or after a major session.

## Export / publish
Use \`configure_export_targets(preset="book")\` to create a book PDF target, then \`export_workspace\`.`,

  spreadsheet: `# Spreadsheet Skill — CSV / XLSX Rules

## Tool selection
- \`read_spreadsheet\` — table-aware read; returns data as Markdown table with row numbers. Prefer for structured inspection.
- \`write_spreadsheet\` — create or surgically edit rows, cells, and columns.
- \`read_workspace_file\` — fine for raw source text or when you need exact line-level content.
- For XLSX files: always use \`read_spreadsheet\` / \`write_spreadsheet\` — never \`read_workspace_file\`.

## Editing rules
- Preserve headers, column order, delimiters, and row alignment unless restructuring is explicitly requested.
- Be careful with: numeric IDs (no rounding), dates (preserve original format), locale-specific decimals (comma vs period), empty cells (don't auto-fill).
- For a single cell change: \`write_spreadsheet(action="set_cell", ...)\`.
- To add a row: \`write_spreadsheet(action="append_row", ...)\`.
- To delete a row: \`write_spreadsheet(action="delete_row", ...)\`.
- Full rewrite via \`write_spreadsheet(action="write_all", ...)\` only when user asks for a rebuild from scratch.

## Before large edits
1. \`read_spreadsheet\` to inspect current shape and data types.
2. Describe the intended transformation to the user.
3. Confirm before proceeding with destructive changes.`,

  html: `# HTML / Interactive Demo Skill

## Overview
The active .html/.htm file renders live in the preview panel. Changes reflect immediately after \`write_workspace_file\` or \`patch_workspace_file\`.

## Best practices
- Use relative units (%, rem, vh/vw) and CSS variables for scalable layouts.
- Prefer flex/grid — avoid absolute/fixed positioning for main content areas.
- Readable line width: max 65–80ch for body text.
- Clear spacing (padding/margin), accessible color contrast (WCAG AA: ≥ 4.5:1 for text).
- Add :hover and :focus states for all interactive elements (buttons, links, inputs).

## Assets
- Inline images as base64 data URLs or use https:// URLs — local file:// paths are blocked by the WebKit sandbox.
- Keep total HTML under 500KB for smooth preview rendering.
- Prefer system fonts (sans-serif, serif, monospace) for offline demos to avoid CDN dependencies.

## Workflow
1. \`read_workspace_file\` — read the current file before editing.
2. \`patch_workspace_file\` — targeted CSS or HTML changes.
3. \`screenshot_preview\` — capture and inspect the result.
4. Fix any layout, spacing, or contrast issues.
5. \`screenshot_preview\` again after fixes before replying.

## JavaScript
- Vanilla JS preferred for demos — no bundler needed.
- Guard DOM access with \`DOMContentLoaded\` or place scripts at end of \`<body>\`.
- Console errors visible in screenshot_preview output — fix before reporting done.`,

  code: `# Code Workspace Skill — TypeScript / Node Verification

## Before editing
1. \`outline_workspace\` — understand project structure, entry points, config files.
2. Read relevant \`package.json\`, \`tsconfig.json\`, \`vite.config.ts\`, or framework config.
3. \`search_workspace("<symbol>")\` — find the exact function, type, or variable before modifying it.
4. Never guess at type signatures, imports, or existing code — read the actual files.

## Editing
- \`patch_workspace_file\` for surgical changes. \`multi_patch\` for coordinated edits across multiple files.
- \`write_workspace_file\` only for genuinely new files or when the user explicitly wants a full rewrite.
- On large existing files, avoid full rewrites — they make verification harder and increase error surface.

## Verification flow (TypeScript / Node)
After every non-trivial change, verify in this order:
1. \`run_command("npx tsc --noEmit")\` — zero errors required.
2. If tests configured: \`run_command("npm test")\` or \`run_command("npx vitest run")\`.
3. If lint configured: \`run_command("npm run lint")\`.
4. Report pass/fail status honestly. Never mark done while verification is failing.

## Error handling
1. Read the full error message — locate failing file and line.
2. \`read_workspace_file(path, start_line, end_line)\` — get context around the error.
3. \`patch_workspace_file\` the exact location.
4. Re-run the failing command to confirm fixed.
5. Repeat until clean.

## If no test/lint setup exists
Skip tests and lint silently. Only run tsc if TypeScript is present in package.json.`,

  export: `# Export Skill — PDF, ZIP, Git-Publish, Custom

## Workflow
1. \`configure_export_targets(action="list")\` — inspect currently configured targets.
2. Choose an existing target if one fits the request. Prefer reuse over creating new ones.
3. If no target fits: \`configure_export_targets(action="add", ...)\` or \`action="update"\`.
4. \`export_workspace(targetName="...", dryRun=true)\` — preview what will be exported.
5. Confirm file list with user before actual export.
6. \`export_workspace(targetName="...")\` — run the real export.

## Formats
- \`pdf\` — converts Markdown files to PDF. Options: merge, pdfCssFile, toc, titlePage, versionOutput.
- \`canvas-png\` — exports each canvas slide as a PNG image.
- \`canvas-pdf\` — exports canvas slides merged into a PDF.
- \`zip\` — bundles files into a ZIP archive.
- \`git-publish\` — commits and pushes to a git remote. Options: remote, branch, commitMessage, skipCommitWhenNoChanges.
- \`custom\` — runs a workspace-root shell command. Modes: auto, batch, per-file.

## File selection
- \`includeFiles\`: explicit list of files (overrides \`include\` extensions).
- \`include\`: glob patterns or extensions (e.g., ["*.md"]).
- \`excludeFiles\`: files to exclude after selection.

## Custom target placeholders
\`$FILE\`, \`$OUTPUT_DIR\`, \`$WORKSPACE_PATH\`, \`$TARGET_NAME\` (and quoted/batch variants).
- Progress lines: start with \`CAFEZIN_PROGRESS:\`
- Artifact lines (output files): start with \`CAFEZIN_ARTIFACT:\`

## Presets
- \`configure_export_targets(action="add", preset="book")\` — sensible PDF target for long-form writing.
- \`configure_export_targets(action="add", preset="slides")\` — per-slide PNG export for canvases.`,

  memory: `# Memory Skill — Detailed Memory Management

## Two memory scopes
- \`scope="workspace"\` — facts about THIS workspace (stored in \`.cafezin/memory.md\`).
- \`scope="user"\` — facts about the USER across all workspaces (stored in \`~/.cafezin/user-profile.md\`).

## When to save
Save to memory when you learn something DURABLE that won't be obvious by reading the files:
- workspace: character decisions, plot choices, world rules, coding conventions, key decisions made in chat.
- user: working style preferences, corrections to AI mistakes, cross-workspace patterns.

## When NOT to save
- Transient session notes or exploratory ideas.
- Facts derivable by reading workspace files.
- Obvious context (current date, file names visible in the sidebar).
- Unconfirmed guesses or assumptions.
- Step-by-step plans — use \`create_task\` for those.

## Checking before saving
The memory digest is injected in the system prompt. Check it before calling \`remember\` — if the fact is already there, DO NOT save again. Duplicate entries are the #1 memory problem.

## After 4+ entries in one session
Run \`manage_memory(action="read")\` and consolidate any redundant or stale entries.

## Memory quality rules
- Memory is capped at ~2200 chars when injected — quality beats quantity.
- One precise entry beats ten vague ones.
- If a memory entry is flagged \`needs_review\`, check the linked source files before relying on it.

## Breaking changes
When schemas, file formats, rules, or data structures change, update workspace memory IMMEDIATELY with the new version and mark the old entry as superseded or delete it. Stale memory is worse than no memory.

## API
- \`remember(content, heading, scope)\` — append a fact under a heading.
- \`manage_memory(action="read"|"rewrite"|"delete_entry")\` — inspect and clean up memory.`,

  tasks: `# Task Skill — Multi-Step Task Tracking

## When to use tasks
Create a tracked task when the user's goal has **3 or more ordered steps**. Skip for:
- Quick one-shot edits.
- Q&A questions.
- Any work completable in a single response.

## Creating a task
\`create_task(title, description?, steps)\` — steps is an array of {title, description?}.
- Keep step titles short and concrete: one clear, verifiable action per step.
- Max ~8 steps. If more needed, group into phases.

## Step lifecycle (STRICT)
1. Mark step **[in-progress]** BEFORE you start working on it.
2. Do the work.
3. Mark step **[done]** IMMEDIATELY after it is verifiably complete.
4. Never batch updates at the end of a session.

## Checking task state
At the start of every turn, if an active task exists, read its current step states from the injected task summary in the system prompt. Continue from the first non-done step.

## Completing a task
Before reporting "done", verify every step is marked [done] or [skipped]. Confirm with the user before closing.

## One task rule
Create ONE tracked task per chat. If the user pivots to a different goal, update or close the existing task first before creating a new one. Never have two active tasks for the same chat.`,
};

// ── Tool definition ───────────────────────────────────────────────────────────

export const SKILL_TOOL_DEFS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_skill',
      description:
        'Load detailed protocol, command reference, and best-practice instructions for a specific skill area. '
        + 'Call this BEFORE performing complex work in that area — it contains the full rules the system prompt only summarises. '
        + 'Skills: canvas (tldraw commands and layout), book (long-form writing workflow), '
        + 'spreadsheet (CSV/XLSX editing), html (interactive demo guidance), code (TypeScript verification), '
        + 'export (PDF/ZIP/git-publish rules), memory (memory management detail), tasks (task tracking protocol).',
      parameters: {
        type: 'object' as const,
        properties: {
          name: {
            type: 'string',
            enum: ['canvas', 'book', 'spreadsheet', 'html', 'code', 'export', 'memory', 'tasks'],
            description:
              'Skill to load. '
              + 'canvas: full canvas_op command reference + layout rules. '
              + 'book: long-form writing and chapter workflow. '
              + 'spreadsheet: CSV/XLSX reading and editing rules. '
              + 'html: interactive HTML/CSS demo guidance. '
              + 'code: TypeScript/Node editing and verification. '
              + 'export: export target protocol for PDF, ZIP, git, and custom commands. '
              + 'memory: detailed memory management, staleness rules, and deduplication. '
              + 'tasks: multi-step task creation and lifecycle.',
          },
        },
        required: ['name'],
      },
    },
  },
];

// ── Executor ──────────────────────────────────────────────────────────────────

export const executeSkillTools: DomainExecutor = async (
  name,
  args,
) => {
  if (name !== 'read_skill') return null;

  const skillName = String(args.name ?? '').trim().toLowerCase();
  const content = SKILL_CONTENT[skillName];
  if (!content) {
    const available = Object.keys(SKILL_CONTENT).join(', ');
    return `Unknown skill "${skillName}". Available skills: ${available}`;
  }
  return content;
};
