/**
 * Skill tools — on-demand protocol and best-practice guides.
 *
 * Instead of bloating the system prompt with every possible rule, verbose
 * protocols live here as structured Markdown strings. The agent calls
 * `read_skill(name)` when it is about to perform work in that area.
 *
 * Skills available:
 *   book        → Long-form writing workflow
 *   export      → Export target protocol (PDF, ZIP, git-publish, custom)
 *   memory      → Detailed memory management and staleness rules
 *   tasks       → Multi-step task tracking protocol
 */

import type { ToolDefinition, DomainExecutor } from './shared';

// ── Skill content ─────────────────────────────────────────────────────────────

export const SKILL_CONTENT: Record<string, string> = {
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
- \`configure_export_targets(action="add", preset="book")\` — sensible PDF target for long-form writing.`,

  memory: `# Memory Skill — Detailed Memory Management

## Two memory scopes
- \`scope="workspace"\` — facts about THIS workspace (stored in \`.cafezin/memory.md\`).
- \`scope="user"\` — facts about the USER across all workspaces (stored in \`~/.cafezin/user-profile.md\`).

## Memory vs. Routines — choosing the right tool

Before saving, ask: **is this a fact, or a reusable workflow?**

| It's a fact/preference → use \`remember\` | It's a repeatable action → use \`add_routine\` |
|---|---|
| Character name, writing style, tech stack | "Revisar capítulo" → prompt that the user runs monthly |
| Plot decision, world-building rule | "Sintetizar notas da semana" → weekly summarise workflow |
| User preference ("prefer concise answers") | "Planejar próxima aula" → classroom prep routine |
| Coding convention, API endpoint | "Deploy para produção" → multi-step deploy prompt |

**Rule of thumb:** if the user will type roughly the same thing again next session, make it a routine pill. If it's a fact the agent needs to recall, save it to memory.

### Creating a routine
\`\`\`
configure_workspace(action="add_routine", label="Revisar capítulo", prompt="Revise o arquivo aberto...")
\`\`\`
The routine appears as a clickable pill in the agent panel. Custom routines are shown first, before the workspace-type defaults.

## When to save to memory

Save to memory when you learn something DURABLE that won't be obvious by reading the files:
- workspace: character decisions, plot choices, world rules, coding conventions, key decisions made in chat.
- user: working style preferences, corrections to AI mistakes, cross-workspace patterns.

## When NOT to save
- Transient session notes or exploratory ideas.
- Facts derivable by reading workspace files.
- Obvious context (current date, file names visible in the sidebar).
- Unconfirmed guesses or assumptions.
- Step-by-step plans — use \`create_task\` for those.
- Repeatable workflows — use \`add_routine\` for those.

## End-of-session review
After a session with significant discoveries, briefly consider:
1. Did the user express a preference or correction? → \`remember(scope="user")\`
2. Did you learn a durable workspace fact? → \`remember(scope="workspace")\`
3. Did the session reveal a workflow the user will repeat? → \`configure_workspace(action="add_routine")\`
4. Check existing memory first — if the fact is already there, skip it.

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
- \`manage_memory(action="read"|"rewrite"|"delete_entry")\` — inspect and clean up memory.
- \`configure_workspace(action="add_routine"|"update_routine"|"remove_routine")\` — manage reusable workflow pills.`,

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
        + 'Skills: book (long-form writing workflow), export (PDF/ZIP/git-publish rules), '
        + 'memory (memory management detail), tasks (task tracking protocol).',
      parameters: {
        type: 'object' as const,
        properties: {
          name: {
            type: 'string',
            enum: ['book', 'export', 'memory', 'tasks'],
            description:
              'Skill to load. '
              + 'book: long-form writing workflow. '
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
