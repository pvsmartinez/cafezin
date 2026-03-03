/**
 * File-system workspace tools: list, read, write, patch, search, rename,
 * delete, scaffold, and check files.
 */

import {
  readTextFile,
  writeTextFile,
  mkdir,
  exists,
  rename,
  remove,
  stat,
} from '../../services/fs';
import { walkFilesFlat } from '../../services/workspace';
import { lockFile, unlockFile, waitForUnlock } from '../../services/copilotLock';
import type { ToolDefinition, DomainExecutor } from './shared';
import { TEXT_EXTS, safeResolvePath } from './shared';

// ── Tool definitions ─────────────────────────────────────────────────────────

export const FILE_TOOL_DEFS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_workspace_files',
      description:
        'List every file in the workspace with its size in KB. ' +
        'Call this first to understand what exists and how large each file is before deciding whether to read or paginate. ' +
        'For a richer view of what each file CONTAINS (headings, exports, tables) use outline_workspace instead.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'outline_workspace',
      description:
        'Return a structural outline of every file in the workspace — without reading their full content. ' +
        'Far more useful than list_workspace_files when you need to understand WHAT each file contains: ' +
        '• Markdown: YAML title, headings (H1‒H3), word count ' +
        '• TypeScript/JavaScript: exported functions, classes, types, interfaces ' +
        '• Python: top-level def and class names ' +
        '• SQL: CREATE TABLE / FUNCTION / VIEW names ' +
        '• Shell scripts: description comment ' +
        '• JSON/YAML/TOML: top-level keys ' +
        'Use this as your first call on an unfamiliar workspace — it tells you exactly which files to read next.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_workspace_file',
      description:
        'Read the content of a single file. Returns the full text or a specific line range. ' +
        'Files up to 80 KB are returned in full; larger files are truncated — call again with start_line/end_line to page through the rest. ' +
        'To read several files at once use read_multiple_files. ' +
        'NOTE: .tldr.json canvas files are BLOCKED — they contain base64 images that overflow the context. Use list_canvas_shapes instead.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path from workspace root, e.g. "chapter1.md" or "notes/ideas.md"',
          },
          start_line: {
            type: 'number',
            description: '1-based line number to start reading from (inclusive). Omit to start at the beginning.',
          },
          end_line: {
            type: 'number',
            description: '1-based line number to stop reading at (inclusive). Omit to read to the end (up to the 80 KB cap).',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_multiple_files',
      description:
        'Read up to 8 files in parallel in a single call. ' +
        'Use this whenever you need to read more than one file — it is far faster than calling read_workspace_file repeatedly. ' +
        'Each file is returned with a clear header and its content (up to 80 KB each). ' +
        'NOTE: .tldr.json canvas files are BLOCKED — use list_canvas_shapes for those.',
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'string',
            description:
              'JSON array of relative paths from workspace root, e.g. ["chapter1.md", "notes/ideas.md"]. Maximum 8 paths.',
          },
        },
        required: ['paths'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_workspace_file',
      description:
        'Create a new file or completely overwrite an existing one. Use for generating new documents, drafts, or outlines.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path from workspace root, e.g. "chapter2.md". Include the extension.',
          },
          content: {
            type: 'string',
            description: 'The complete file content to write.',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'patch_workspace_file',
      description:
        'Make a targeted find-and-replace edit inside a file without overwriting the whole thing. ' +
        'Reads the file, replaces the specified occurrence of `search` with `replace`, then writes back. ' +
        'Use this for surgical edits — fixing a sentence, updating a heading, changing a value — instead of ' +
        'rewriting the entire file with write_workspace_file. Set occurrence=0 to replace all occurrences.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path from workspace root, e.g. "chapter1.md"',
          },
          search: {
            type: 'string',
            description: 'Exact text to find — must match character-for-character including whitespace and newlines.',
          },
          replace: {
            type: 'string',
            description: 'Text to substitute in place of the match. Use an empty string to delete the match.',
          },
          occurrence: {
            type: 'number',
            description: '1-based index of which match to replace. Defaults to 1 (first match). Pass 0 to replace all occurrences.',
          },
        },
        required: ['path', 'search', 'replace'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_workspace',
      description:
        'Search for a word or phrase across all text files in the workspace. ' +
        'Returns up to 50 matches with 2 lines of context around each hit. ' +
        'Supports plain text (case-insensitive) or a JavaScript regular expression when query starts and ends with /. ' +
        'Searches: .md, .txt, .ts, .tsx, .js, .jsx, .json, .css, .html, .rs, .toml, .yaml, .yml, .sh, .py, .sql and similar text formats.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The text to search for (case-insensitive). Can be a word, phrase, or sentence fragment.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_file',
      description:
        'Validate a file for common errors after creating or editing it. ' +
        'For Markdown (.md): checks YAML front-matter is well-formed and that internal [text](path) links resolve to existing files. ' +
        'For canvas files (.tldr.json): checks the JSON is a valid tldraw snapshot.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path to the file to check, e.g. "chapter1.md" or "diagrams/overview.tldr.json".',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_workspace_file',
      description:
        'Rename or move a file or folder to a new path within the workspace. ' +
        'Creates any missing parent directories in the destination path automatically. ' +
        'Use this when the user asks to rename, move, or reorganise files.',
      parameters: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description: 'Current relative path from workspace root, e.g. "drafts/chapter1.md".',
          },
          to: {
            type: 'string',
            description: 'New relative path from workspace root, e.g. "book/part1/chapter1.md". Include the filename.',
          },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_workspace_file',
      description:
        'Permanently delete a file or folder from the workspace. ' +
        'Folders are deleted recursively (all contents removed). ' +
        'Only use when the user explicitly asks to delete or remove a file or folder.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path from workspace root of the file or folder to delete. Folder deletion is recursive.',
          },
          confirm: {
            type: 'string',
            description: 'Must be the exact string "yes" to confirm the deletion. Safety gate — never pass "yes" without the user explicitly authorising the delete.',
          },
        },
        required: ['path', 'confirm'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'multi_patch',
      description:
        'Apply multiple targeted find-and-replace edits across one or more files in a single operation. ' +
        'Use this instead of calling patch_workspace_file repeatedly when you need to make coordinated edits ' +
        'across different files (e.g. refactor a heading in three chapters, update a config value everywhere). ' +
        'Each file is read once, all its patches are applied in order in memory, then written back once — ' +
        'much more efficient than round-tripping through the API for each edit.',
      parameters: {
        type: 'object',
        properties: {
          patches: {
            type: 'string',
            description:
              'JSON array of patch objects. Each object has:\n' +
              '  { "path": "relative/path.md", "search": "exact text to find", "replace": "replacement text", "occurrence": 1 }\n' +
              '"occurrence" defaults to 1 (first match); pass 0 to replace all occurrences.\n' +
              'Patches targeting the same file are applied in array order on the accumulated in-memory text.',
          },
          description: {
            type: 'string',
            description: 'Brief human-readable summary of what these patches accomplish, e.g. "rename Chapter 1 heading across 3 files".',
          },
        },
        required: ['patches'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scaffold_workspace',
      description:
        'Create a folder structure and stub files in one atomic operation. ' +
        'PREFERRED: use preset="book" or preset="course" for standard project types — no entries needed. ' +
        'Use when the user asks to set up a project layout, create a chapter structure, ' +
        'scaffold a course, or initialise any multi-file structure. ' +
        'Each entry can be a folder (path ending with /) or a file (with optional stub content). ' +
        'IMPORTANT: canvas files (.tldr.json) are ALWAYS created empty regardless of any content supplied — do NOT put tldraw JSON in the content field. Use canvas_op AFTER opening the file instead.',
      parameters: {
        type: 'object',
        properties: {
          preset: {
            type: 'string',
            enum: ['book', 'course'],
            description:
              'Use instead of entries for standard project types. ' +
              '"book" → zero-padded chapter files (cap01.md … capNN.md) + notas.md + memory.md pre-seeded with headings. ' +
              '"course" → aulas/ folder with one .tldr.json canvas + one -notas.md per lesson, plus recursos/ folder. ' +
              'Combine with title, author, chapters to personalise.',
          },
          title: {
            type: 'string',
            description: 'Book or course title, used in YAML frontmatter and memory.md. Used with preset only.',
          },
          author: {
            type: 'string',
            description: 'Author name. Used in YAML frontmatter and memory.md. Used with preset only.',
          },
          chapters: {
            type: 'number',
            description: 'Number of chapters (book) or aulas (course) to generate. Default: 5. Used with preset only.',
          },
          entries: {
            type: 'string',
            description:
              'JSON array of objects. Each object has:\n' +
              '  { "path": "relative/path/file.md", "content": "optional stub text" }\n' +
              '  { "path": "relative/folder/" }  ← trailing slash = create directory only\n' +
              'Paths are relative to the workspace root. Parent directories are created automatically.',
          },
          description: {
            type: 'string',
            description: 'Brief human-readable description of the structure being created, e.g. "3-part book scaffold".',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'word_count',
      description:
        'Count words in one Markdown file or across the entire workspace. ' +
        'Returns per-file word counts sorted by filename, plus a grand total. ' +
        'Useful for writers tracking chapter length, book progress, or meeting word-count goals. ' +
        'Skips YAML front-matter, HTML tags, code fences, and canvas files when counting.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Relative path to a single file, e.g. "chapters/cap1.md". ' +
              'Omit to count ALL Markdown files in the workspace.',
          },
        },
        required: [],
      },
    },
  },
];

// ── Executor ─────────────────────────────────────────────────────────────────

export const executeFileTools: DomainExecutor = async (name, args, ctx) => {
  const { workspacePath, onFileWritten, onMarkRecorded } = ctx;

  switch (name) {

    // ── list_workspace_files ──────────────────────────────────────────────
    case 'list_workspace_files': {
      const files = await walkFilesFlat(workspacePath);
      if (files.length === 0) return 'The workspace is empty.';
      // Attach sizes in parallel so the AI knows what to paginate
      const withSizes = await Promise.all(
        files.map(async (rel) => {
          try {
            const s = await stat(`${workspacePath}/${rel}`);
            const kb = ((s.size ?? 0) / 1024).toFixed(1);
            return `${rel}  (${kb} KB)`;
          } catch {
            return rel;
          }
        }),
      );
      return `${files.length} file(s) in workspace:\n${withSizes.join('\n')}`;
    }

    // ── outline_workspace ──────────────────────────────────────────────
    case 'outline_workspace': {
      const allFiles = await walkFilesFlat(workspacePath);
      const textFiles = allFiles.filter((f) => {
        if (f.endsWith('.tldr.json')) return false;
        const ext = f.split('.').pop()?.toLowerCase() ?? '';
        return TEXT_EXTS.has(ext);
      });
      if (textFiles.length === 0) return 'No text files found in workspace.';

      /** Extract structural outline from a file's text based on its extension. */
      function extractOutline(rel: string, text: string): string {
        const ext = rel.split('.').pop()?.toLowerCase() ?? '';
        const lines: string[] = [];

        if (ext === 'md' || ext === 'mdx') {
          // YAML frontmatter title
          if (text.startsWith('---')) {
            const fmEnd = text.indexOf('\n---', 3);
            if (fmEnd !== -1) {
              const fm = text.slice(3, fmEnd);
              const titleMatch = /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm);
              if (titleMatch) lines.push(`  title: "${titleMatch[1].trim()}"`);
            }
          }
          // H1–H3 headings
          const headingRe = /^(#{1,3})\s+(.+)$/gm;
          let hm: RegExpExecArray | null;
          while ((hm = headingRe.exec(text)) !== null) {
            const indent = '  '.repeat(hm[1].length);
            lines.push(`${indent}${hm[1]} ${hm[2].trim()}`);
          }
          // Word count
          const words = text.replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean).length;
          lines.push(`  (${words} words)`);

        } else if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) {
          // Named exports: export function/class/const/type/interface/enum Name
          const namedRe = /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|type|interface|enum)\s+(\w+)/gm;
          const names: string[] = [];
          let nm: RegExpExecArray | null;
          while ((nm = namedRe.exec(text)) !== null) names.push(nm[1]);
          // Re-export blocks: export { A, B, C }
          const reRe = /^export\s+\{([^}]+)\}/gm;
          while ((nm = reRe.exec(text)) !== null) {
            nm[1].split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).forEach((n) => names.push(n));
          }
          if (names.length) lines.push(`  exports: ${[...new Set(names)].join(', ')}`);
          else lines.push('  (no exports detected)');

        } else if (ext === 'py') {
          // Top-level def / class (no indentation)
          const pyRe = /^(def|class)\s+(\w+)/gm;
          const names: string[] = [];
          let pm: RegExpExecArray | null;
          while ((pm = pyRe.exec(text)) !== null) names.push(`${pm[1]} ${pm[2]}`);
          if (names.length) lines.push(`  ${names.join(', ')}`);

        } else if (ext === 'sql') {
          // CREATE TABLE / VIEW / FUNCTION / INDEX / TRIGGER
          const sqlRe = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|INDEX|TRIGGER|TYPE|SEQUENCE)\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi;
          const names: string[] = [];
          let sm: RegExpExecArray | null;
          while ((sm = sqlRe.exec(text)) !== null) names.push(sm[1]);
          // Also catch ALTER TABLE
          const altRe = /ALTER\s+TABLE\s+["'`]?(\w+)["'`]?/gi;
          const altered = new Set<string>();
          while ((sm = altRe.exec(text)) !== null) altered.add(sm[1]);
          if (names.length) lines.push(`  creates: ${names.join(', ')}`);
          if (altered.size) lines.push(`  alters: ${[...altered].join(', ')}`);

        } else if (ext === 'sh') {
          // First meaningful comment (not shebang)
          const shLines = text.split('\n');
          for (const l of shLines) {
            const m = /^#\s+(.+)/.exec(l);
            if (m && !l.startsWith('#!/')) { lines.push(`  # ${m[1].trim()}`); break; }
          }

        } else if (['json', 'toml', 'yaml', 'yml'].includes(ext)) {
          // Top-level keys
          try {
            if (ext === 'json') {
              const obj = JSON.parse(text) as Record<string, unknown>;
              if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                const keys = Object.keys(obj).slice(0, 20);
                lines.push(`  keys: ${keys.join(', ')}${Object.keys(obj).length > 20 ? ', …' : ''}`);
              }
            } else {
              // YAML/TOML: just extract top-level key names with a simple regex
              const keyRe = /^([a-zA-Z_][\w.-]*)\s*[=:]/gm;
              const keys = new Set<string>();
              let km: RegExpExecArray | null;
              while ((km = keyRe.exec(text)) !== null) keys.add(km[1]);
              if (keys.size) lines.push(`  keys: ${[...keys].slice(0, 20).join(', ')}`);
            }
          } catch { /* ignore parse errors */ }
        }

        return lines.join('\n');
      }

      // Read all text files in parallel batches and build per-file outlines
      const BATCH = 12;
      const outlines: string[] = [];
      for (let b = 0; b < textFiles.length; b += BATCH) {
        const batch = textFiles.slice(b, b + BATCH);
        const results = await Promise.all(
          batch.map(async (rel) => {
            try {
              const s = await stat(`${workspacePath}/${rel}`);
              const kb = ((s.size ?? 0) / 1024).toFixed(1);
              // Skip very large files — outline would be noisy and we'd hit the tool result cap
              if ((s.size ?? 0) > 200_000) return `📄 ${rel}  (${kb} KB — too large to outline, use read_workspace_file with pagination)`;
              const text = await readTextFile(`${workspacePath}/${rel}`);
              const outline = extractOutline(rel, text);
              return `📄 ${rel}  (${kb} KB)${outline ? '\n' + outline : ''}`;
            } catch {
              return `📄 ${rel}  (unreadable)`;
            }
          }),
        );
        outlines.push(...results);
      }

      return `Workspace outline — ${textFiles.length} file(s):\n\n${outlines.join('\n\n')}`;
    }

    // ── read_workspace_file ───────────────────────────────────────────────
    case 'read_workspace_file': {
      const relPath = String(args.path ?? '');
      if (!relPath) return 'Error: path is required.';
      // Canvas files contain base64-encoded images — reading them raw floods the
      // context window and causes API 400 errors. Use list_canvas_shapes instead.
      if (relPath.endsWith('.tldr.json')) {
        return 'Error: .tldr.json canvas files cannot be read with read_workspace_file — ' +
          'their raw content contains base64 images that overflow the context. ' +
          'Use list_canvas_shapes to inspect the open canvas (it shows shape positions, text, colors, and assetIds for images).';
      }
      let abs: string;
      try { abs = safeResolvePath(workspacePath, relPath); }
      catch (e) { return String(e); }
      if (!(await exists(abs))) return `File not found: ${relPath}`;
      try {
        const text = await readTextFile(abs);
        const lines = text.split('\n');
        const totalLines = lines.length;

        const hasRange = typeof args.start_line === 'number' || typeof args.end_line === 'number';
        if (hasRange) {
          const startLine = typeof args.start_line === 'number' ? Math.max(1, args.start_line) : 1;
          const endLine   = typeof args.end_line   === 'number' ? Math.min(totalLines, args.end_line) : totalLines;
          const slice = lines.slice(startLine - 1, endLine).join('\n');
          return `[Lines ${startLine}–${endLine} of ${totalLines} in ${relPath}]\n${slice}`;
        }

        const CAP = 80_000;
        if (text.length > CAP) {
          const capText = text.slice(0, CAP);
          const capLines = capText.split('\n');
          const lastFullLine = capLines.length - 1;
          const truncated = capLines.slice(0, lastFullLine).join('\n');
          const pct = Math.round((lastFullLine / totalLines) * 100);
          return `${truncated}\n\n[… truncated — showed lines 1–${lastFullLine} of ${totalLines} (${pct}%). ` +
            `Call again with start_line=${lastFullLine + 1} to read the next chunk.]`;
        }
        return text;
      } catch (e) {
        return `Error reading file: ${e}`;
      }
    }

    // ── read_multiple_files ───────────────────────────────────────────────
    case 'read_multiple_files': {
      let pathList: string[];
      try {
        const raw = String(args.paths ?? '');
        pathList = JSON.parse(raw) as string[];
        if (!Array.isArray(pathList)) throw new Error('not an array');
      } catch {
        return 'Error: paths must be a JSON array of strings, e.g. ["file1.md","file2.md"].';
      }
      pathList = pathList.slice(0, 8); // hard cap
      if (pathList.length === 0) return 'Error: paths array is empty.';

      const CAP = 80_000;
      const results = await Promise.all(
        pathList.map(async (relPath) => {
          const label = `\n${'─'.repeat(60)}\n📄 ${relPath}\n${'─'.repeat(60)}`;
          if (relPath.endsWith('.tldr.json')) {
            return `${label}\n[BLOCKED: canvas file — use list_canvas_shapes instead.]`;
          }
          let abs: string;
          try { abs = safeResolvePath(workspacePath, relPath); }
          catch (e) { return `${label}\n[Error: ${e}]`; }
          if (!(await exists(abs))) return `${label}\n[File not found]`;
          try {
            const text = await readTextFile(abs);
            const lines = text.split('\n');
            if (text.length > CAP) {
              const capText = text.slice(0, CAP);
              const capLines = capText.split('\n');
              const lastFullLine = capLines.length - 1;
              const pct = Math.round((lastFullLine / lines.length) * 100);
              return `${label}\n${capLines.slice(0, lastFullLine).join('\n')}\n\n[… truncated — showed ${lastFullLine}/${lines.length} lines (${pct}%). Use read_workspace_file with start_line to continue.]`;
            }
            return `${label}\n${text}`;
          } catch (e) {
            return `${label}\n[Error reading: ${e}]`;
          }
        }),
      );
      return results.join('\n');
    }

    // ── patch_workspace_file ──────────────────────────────────────────────
    case 'patch_workspace_file': {
      const relPath = String(args.path    ?? '');
      const search  = String(args.search  ?? '');
      const replace = String(args.replace ?? '');
      if (!relPath) return 'Error: path is required.';
      if (!search)  return 'Error: search string is required (may not be empty).';
      if (relPath.endsWith('.tldr.json')) {
        return 'Error: canvas files (.tldr.json) cannot be patched — use canvas_op instead.';
      }
      let abs: string;
      try { abs = safeResolvePath(workspacePath, relPath); }
      catch (e) { return String(e); }
      if (!(await exists(abs))) return `File not found: ${relPath}`;
      // Prefer in-memory editor content (unsaved edits) over stale disk version
      let text: string;
      if (ctx.activeFile === relPath && ctx.activeFileContent != null) {
        text = ctx.activeFileContent;
      } else {
        try { text = await readTextFile(abs); } catch (e) { return `Error reading file: ${e}`; }
      }

      const occurrence = typeof args.occurrence === 'number' ? args.occurrence : 1;
      let newText: string;
      let replacementCount = 0;

      if (occurrence === 0) {
        const parts = text.split(search);
        if (parts.length === 1) {
          return `Error: search string not found in ${relPath}. No changes made. ` +
            `(searched for: "${search.slice(0, 80)}${search.length > 80 ? '…' : ''}")`;
        }
        replacementCount = parts.length - 1;
        newText = parts.join(replace);
      } else {
        let pos = -1;
        let n = 0;
        let cursor = 0;
        while (n < occurrence) {
          const idx = text.indexOf(search, cursor);
          if (idx === -1) break;
          pos = idx;
          n++;
          cursor = idx + search.length;
        }
        if (pos === -1) {
          const total = text.split(search).length - 1;
          const preview = `"${search.slice(0, 80)}${search.length > 80 ? '…' : ''}"`;
          if (total === 0) {
            return `Error: search string not found in ${relPath}. No changes made. (searched for: ${preview})`;
          }
          return `Error: occurrence ${occurrence} requested but only ${total} match(es) found in ${relPath}. No changes made.`;
        }
        newText = text.slice(0, pos) + replace + text.slice(pos + search.length);
        replacementCount = 1;
      }

      const lockWait = await waitForUnlock(relPath, ctx.agentId);
      if (lockWait.timedOut) {
        return (
          `Cannot patch "${relPath}" — it is currently being edited by another Copilot agent (${lockWait.owner}). ` +
          `Please let the user know: "I tried to edit ${relPath} but it is locked by a parallel task. ` +
          `Please let me know when the other task finishes so I can retry."`
        );
      }
      lockFile(relPath, ctx.agentId);
      await new Promise<void>((r) => setTimeout(r, 0));
      try {
        await writeTextFile(abs, newText);
      } catch (e) {
        unlockFile(relPath);
        return `Error writing file: ${e}`;
      }
      try {
        onFileWritten?.(relPath);
        onMarkRecorded?.(relPath, newText);
        await new Promise<void>((r) => setTimeout(r, 400));
      } finally {
        unlockFile(relPath);
      }

      const occStr = occurrence === 0 ? `all ${replacementCount}` : `occurrence ${occurrence}`;
      return `Patched ${relPath}: replaced ${occStr} occurrence(s) successfully (${text.length} → ${newText.length} chars).`;
    }

    // ── write_workspace_file ──────────────────────────────────────────────
    case 'write_workspace_file': {
      const relPath = String(args.path ?? '');
      const content = String(args.content ?? '');
      if (!relPath) return 'Error: path is required.';
      if (!content) return 'Error: content is empty — the file was not written. Check argument parsing.';
      if (relPath.endsWith('.tldr.json')) {
        return 'Error: canvas files (.tldr.json) cannot be written with write_workspace_file — use the canvas_op tool instead. Writing raw JSON to a canvas file would corrupt its tldraw format.';
      }
      console.debug('[write_workspace_file] path:', relPath, 'content length:', content.length);
      let abs: string;
      try { abs = safeResolvePath(workspacePath, relPath); }
      catch (e) { return String(e); }
      const dir = abs.split('/').slice(0, -1).join('/');
      const lwWrite = await waitForUnlock(relPath, ctx.agentId);
      if (lwWrite.timedOut) {
        return (
          `Cannot write "${relPath}" — it is currently being edited by another Copilot agent (${lwWrite.owner}). ` +
          `Please let the user know: "I tried to write ${relPath} but it is locked by a parallel task. ` +
          `Please let me know when the other task finishes so I can retry."`
        );
      }
      lockFile(relPath, ctx.agentId);
      await new Promise<void>((r) => setTimeout(r, 0));
      try {
        if (!(await exists(dir))) {
          await mkdir(dir, { recursive: true });
        }
        await writeTextFile(abs, content);
        console.debug('[write_workspace_file] success:', abs);
      } catch (e) {
        console.error('[write_workspace_file] FAILED:', e);
        unlockFile(relPath);
        return `Error writing file: ${e}`;
      }
      try {
        onFileWritten?.(relPath);
        onMarkRecorded?.(relPath, content);
        await new Promise<void>((r) => setTimeout(r, 400));
      } finally {
        unlockFile(relPath);
      }
      return `File written successfully: ${relPath} (${content.length} chars)`;
    }

    // ── search_workspace ──────────────────────────────────────────────────
    case 'search_workspace': {
      const query = String(args.query ?? '').trim();
      if (!query) return 'Error: query is required.';
      const files = await walkFilesFlat(workspacePath);
      const textFiles = files.filter((f) => {
        if (f.endsWith('.tldr.json')) return false;
        const ext = f.split('.').pop()?.toLowerCase() ?? '';
        return TEXT_EXTS.has(ext);
      });

      // Support optional JS regex: query wrapped in /.../ or /.../i
      let matchLine: (line: string) => boolean;
      const reMatch = /^\/(.+)\/([gi]*)$/.exec(query);
      if (reMatch) {
        try {
          const re = new RegExp(reMatch[1], reMatch[2] || 'i');
          matchLine = (line) => re.test(line);
        } catch {
          return `Error: invalid regular expression: ${query}`;
        }
      } else {
        const needle = query.toLowerCase();
        matchLine = (line) => line.toLowerCase().includes(needle);
      }

      const hits: string[] = [];
      const MAX_HITS = 50;
      const CONTEXT = 2; // lines before/after each hit

      // Read files in parallel batches of 10 — same behaviour, ~10× faster on large workspaces
      const BATCH = 10;
      for (let b = 0; b < textFiles.length && hits.length < MAX_HITS; b += BATCH) {
        const batch = textFiles.slice(b, b + BATCH);
        const batchHits = await Promise.all(
          batch.map(async (rel) => {
            try {
              const text = await readTextFile(`${workspacePath}/${rel}`);
              const lines = text.split('\n');
              const fileHits: string[] = [];
              for (let i = 0; i < lines.length; i++) {
                if (!matchLine(lines[i])) continue;
                const ctxLines: string[] = [];
                for (let c = Math.max(0, i - CONTEXT); c <= Math.min(lines.length - 1, i + CONTEXT); c++) {
                  ctxLines.push(c === i ? `> ${lines[c]}` : `  ${lines[c]}`);
                }
                fileHits.push(`${rel}:${i + 1}:\n${ctxLines.join('\n')}`);
              }
              return fileHits;
            } catch { return []; }
          }),
        );
        for (const fileHits of batchHits) {
          for (const hit of fileHits) {
            if (hits.length >= MAX_HITS) break;
            hits.push(hit);
          }
          if (hits.length >= MAX_HITS) break;
        }
      }

      const scanned = Math.min(textFiles.length, Math.ceil((hits.length > 0 ? textFiles.length : textFiles.length)));
      if (hits.length === 0) return `No matches found for "${query}" across ${scanned} file(s).`;
      const cap = hits.length >= MAX_HITS ? ` (showing first ${MAX_HITS} — refine query for more)` : '';
      return `Found ${hits.length} match(es) for "${query}" across ${scanned} file(s)${cap}:\n\n${hits.join('\n\n')}`;
    }

    // ── check_file ────────────────────────────────────────────────────────
    case 'check_file': {
      const relPath = String(args.path ?? '').trim();
      if (!relPath) return 'Error: path is required.';
      let abs: string;
      try { abs = safeResolvePath(workspacePath, relPath); }
      catch (e) { return String(e); }
      if (!(await exists(abs))) return `File not found: ${relPath}`;
      let text: string;
      try { text = await readTextFile(abs); } catch (e) { return `Error reading file: ${e}`; }

      const issues: string[] = [];

      if (relPath.endsWith('.tldr.json')) {
        try {
          const json = JSON.parse(text) as Record<string, unknown>;
          const hasKeys = json.document !== undefined || json.store !== undefined || json.records !== undefined;
          if (!hasKeys) {
            issues.push('JSON parses but is missing expected tldraw keys (document/store/records). The canvas may be corrupted.');
          } else {
            const store = json.store as Record<string, unknown> | undefined;
            const records = json.records as Array<{ typeName?: string }> | undefined;
            const shapeCount = store
              ? Object.keys(store).filter((k) => k.startsWith('shape:')).length
              : (records ?? []).filter((r) => r?.typeName === 'shape').length;
            return `✓ Valid tldraw canvas (${shapeCount} shape(s)).`;
          }
        } catch (e) {
          issues.push(`Invalid JSON: ${e}`);
        }
      } else if (relPath.endsWith('.md') || relPath.endsWith('.mdx')) {
        if (text.startsWith('---')) {
          const fmEnd = text.indexOf('\n---', 3);
          if (fmEnd === -1) {
            issues.push('Front-matter: opening "---" found but no closing "---" delimiter. The block is unclosed.');
          } else {
            const fmLines = text.slice(3, fmEnd).split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
            for (const line of fmLines) {
              if (!/^[ \t]*[a-zA-Z0-9_-]+\s*:/.test(line) && !/^[ \t]*-/.test(line) && !/^[ \t]+/.test(line)) {
                issues.push(`Front-matter: possibly malformed line: "${line.trim()}". Expected "key: value" format.`);
              }
            }
          }
        }
        const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
        let m: RegExpExecArray | null;
        while ((m = linkRe.exec(text)) !== null) {
          const href = m[2].split('#')[0].trim();
          if (!href || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('/')) continue;
          const fileDir = relPath.split('/').slice(0, -1).join('/');
          const raw = fileDir ? `${fileDir}/${href}` : href;
          const segs: string[] = [];
          for (const seg of raw.split('/')) {
            if (seg === '..') segs.pop();
            else if (seg !== '.') segs.push(seg);
          }
          const linkedAbs = `${workspacePath}/${segs.join('/')}`;
          if (!(await exists(linkedAbs))) {
            issues.push(`Broken link: [${m[1]}](${m[2]}) → "${segs.join('/')}" not found in workspace.`);
          }
        }
      } else {
        return `check_file only supports .md, .mdx, and .tldr.json files (got: ${relPath}).`;
      }

      if (issues.length === 0) return `✓ No issues found in ${relPath}.`;
      return `Found ${issues.length} issue(s) in ${relPath}:\n${issues.map((is, n) => `${n + 1}. ${is}`).join('\n')}`;
    }

    // ── word_count ────────────────────────────────────────────────────────
    case 'word_count': {
      /** Strip YAML front-matter, HTML, code fences, then count whitespace tokens. */
      function countWords(text: string): number {
        let t = text;
        // Strip YAML front-matter
        if (t.startsWith('---')) {
          const end = t.indexOf('\n---', 3);
          if (end !== -1) t = t.slice(end + 4);
        }
        // Strip fenced code blocks (``` or ~~~)
        t = t.replace(/^```[\s\S]*?^```/gm, '').replace(/^~~~[\s\S]*?^~~~/gm, '');
        // Strip inline code
        t = t.replace(/`[^`]*`/g, '');
        // Strip HTML tags
        t = t.replace(/<[^>]+>/g, '');
        // Strip Markdown image/link syntax
        t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
        return t.split(/\s+/).filter((w) => w.length > 0).length;
      }

      const singlePath = String(args.path ?? '').trim();

      if (singlePath) {
        let abs: string;
        try { abs = safeResolvePath(workspacePath, singlePath); }
        catch (e) { return String(e); }
        if (!(await exists(abs))) return `File not found: ${singlePath}`;
        let text: string;
        try { text = await readTextFile(abs); } catch (e) { return `Error reading file: ${e}`; }
        const count = countWords(text);
        return `${singlePath}: ${count.toLocaleString()} words`;
      }

      // Whole-workspace count
      const allFiles = await walkFilesFlat(workspacePath);
      const mdFiles = allFiles
        .filter((f) => f.endsWith('.md') || f.endsWith('.mdx'))
        .sort();

      if (mdFiles.length === 0) return 'No Markdown files found in workspace.';

      const results = await Promise.all(
        mdFiles.map(async (absPath) => {
          try {
            const text = await readTextFile(absPath);
            const rel = absPath.replace(workspacePath + '/', '');
            return { rel, count: countWords(text) };
          } catch {
            return { rel: absPath.replace(workspacePath + '/', ''), count: 0 };
          }
        }),
      );

      const total = results.reduce((s, r) => s + r.count, 0);
      const lines = results.map((r) => `  ${r.rel.padEnd(50)} ${r.count.toLocaleString()} words`);
      return `Word count across ${results.length} Markdown file(s):\n\n${lines.join('\n')}\n\n${'─'.repeat(60)}\n  TOTAL${' '.repeat(45)} ${total.toLocaleString()} words`;
    }

    // ── rename_workspace_file ─────────────────────────────────────────────
    case 'rename_workspace_file': {
      const fromRel = String(args.from ?? '').trim();
      const toRel   = String(args.to   ?? '').trim();
      if (!fromRel) return 'Error: from is required.';
      if (!toRel)   return 'Error: to is required.';
      if (fromRel === toRel) return 'Error: from and to are the same path — nothing to do.';
      let fromAbs: string, toAbs: string;
      try {
        fromAbs = safeResolvePath(workspacePath, fromRel);
        toAbs   = safeResolvePath(workspacePath, toRel);
      } catch (e) { return String(e); }
      if (!(await exists(fromAbs))) return `File not found: ${fromRel}`;
      if (await exists(toAbs)) return `Error: destination already exists: ${toRel}. Choose a different name or delete it first.`;
      const toDir = toAbs.split('/').slice(0, -1).join('/');
      if (!(await exists(toDir))) await mkdir(toDir, { recursive: true });
      const lwRename = await waitForUnlock(fromRel, ctx.agentId);
      if (lwRename.timedOut) {
        return (
          `Cannot rename "${fromRel}" — it is currently being edited by another Copilot agent (${lwRename.owner}). ` +
          `Please let the user know: "I tried to rename ${fromRel} but it is locked by a parallel task. ` +
          `Please let me know when the other task finishes so I can retry."`
        );
      }
      lockFile(fromRel, ctx.agentId);
      await new Promise<void>((r) => setTimeout(r, 0));
      try {
        await rename(fromAbs, toAbs);
        onFileWritten?.(toRel);
        await new Promise<void>((r) => setTimeout(r, 400));
      } catch (e) {
        unlockFile(fromRel);
        return `Error renaming file: ${e}`;
      }
      unlockFile(fromRel);
      return `Renamed "${fromRel}" → "${toRel}" successfully.`;
    }

    // ── delete_workspace_file ─────────────────────────────────────────────
    case 'delete_workspace_file': {
      const relPath = String(args.path    ?? '').trim();
      const confirm = String(args.confirm ?? '').trim();
      if (!relPath)          return 'Error: path is required.';
      if (confirm !== 'yes') return 'Error: confirm must be "yes" to delete a file. Do not pass "yes" without explicit user authorisation.';
      if (relPath === '.cafezin/memory.md') {
        return 'Error: .cafezin/memory.md is the workspace memory file. Use the remember tool to edit it — do not delete it.';
      }
      let abs: string;
      try { abs = safeResolvePath(workspacePath, relPath); }
      catch (e) { return String(e); }
      if (!(await exists(abs))) return `File not found: ${relPath}.`;
      const lwDelete = await waitForUnlock(relPath, ctx.agentId);
      if (lwDelete.timedOut) {
        return (
          `Cannot delete "${relPath}" — it is currently being edited by another Copilot agent (${lwDelete.owner}). ` +
          `Please let the user know: "I tried to delete ${relPath} but it is locked by a parallel task. ` +
          `Please let me know when the other task finishes so I can retry."`
        );
      }
      lockFile(relPath, ctx.agentId);
      await new Promise<void>((r) => setTimeout(r, 0));
      try {
        const info = await stat(abs);
        const isDir = info.isDirectory;
        await remove(abs, { recursive: isDir });
        onFileWritten?.(relPath);
        await new Promise<void>((r) => setTimeout(r, 400));
        return isDir
          ? `Deleted folder "${relPath}" and all its contents permanently.`
          : `Deleted "${relPath}" permanently.`;
      } catch (e) {
        return `Error deleting: ${e}`;
      } finally {
        unlockFile(relPath);
      }
    }

    // ── multi_patch ───────────────────────────────────────────────────────
    case 'multi_patch': {
      const raw = String(args.patches ?? '').trim();
      if (!raw) return 'Error: patches is required.';
      let patches: Array<{ path: string; search: string; replace: string; occurrence?: number }>;
      try {
        patches = JSON.parse(raw);
        if (!Array.isArray(patches)) return 'Error: patches must be a JSON array.';
      } catch (e) { return `Error: patches is not valid JSON: ${e}`; }

      // Read each file once and accumulate edits in memory before writing.
      const fileCache = new Map<string, { abs: string; text: string }>();
      const patchResults: string[] = [];
      const patchErrors: string[] = [];

      for (const patch of patches) {
        const relPath = String(patch.path    ?? '').trim();
        const search  = String(patch.search  ?? '');
        const replace = String(patch.replace ?? '');
        const occurrence = typeof patch.occurrence === 'number' ? patch.occurrence : 1;

        if (!relPath) { patchErrors.push('Patch with empty path — skipped.'); continue; }
        if (!search)  { patchErrors.push(`${relPath}: search is required — skipped.`); continue; }
        if (relPath.endsWith('.tldr.json')) {
          patchErrors.push(`${relPath}: canvas files cannot be patched — use canvas_op instead.`);
          continue;
        }

        let abs: string;
        try { abs = safeResolvePath(workspacePath, relPath); }
        catch (e) { patchErrors.push(String(e)); continue; }

        if (!fileCache.has(relPath)) {
          if (!(await exists(abs))) { patchErrors.push(`File not found: ${relPath}`); continue; }
          try {
            // Use in-memory editor content for the active file to avoid
            // overwriting unsaved user edits with a stale disk-based patch
            const text = (ctx.activeFile === relPath && ctx.activeFileContent != null)
              ? ctx.activeFileContent
              : await readTextFile(abs);
            fileCache.set(relPath, { abs, text });
          } catch (e) { patchErrors.push(`Error reading ${relPath}: ${e}`); continue; }
        }

        const entry = fileCache.get(relPath)!;
        let newText: string;
        let replacementCount = 0;

        if (occurrence === 0) {
          const parts = entry.text.split(search);
          if (parts.length === 1) { patchErrors.push(`${relPath}: search string not found.`); continue; }
          replacementCount = parts.length - 1;
          newText = parts.join(replace);
        } else {
          let pos = -1;
          let n = 0;
          let cursor = 0;
          while (n < occurrence) {
            const idx = entry.text.indexOf(search, cursor);
            if (idx === -1) break;
            pos = idx;
            n++;
            cursor = idx + search.length;
          }
          if (pos === -1) {
            const total = entry.text.split(search).length - 1;
            if (total === 0) patchErrors.push(`${relPath}: search string not found.`);
            else patchErrors.push(`${relPath}: occurrence ${occurrence} requested but only ${total} match(es) found.`);
            continue;
          }
          newText = entry.text.slice(0, pos) + replace + entry.text.slice(pos + search.length);
          replacementCount = 1;
        }

        const occStr = occurrence === 0 ? `all ${replacementCount}` : `occurrence ${occurrence}`;
        patchResults.push(`${relPath}: replaced ${occStr} occurrence(s)`);
        entry.text = newText;
      }

      // Write back only modified files (those still in cache after all patches).
      // Wait for any conflicting locks first (all in parallel), then lock all at once.
      type WaitResult = { relPath: string } & Awaited<ReturnType<typeof waitForUnlock>>;
      const writeErrors: string[] = [];
      const lockedPaths: string[] = [];
      const waitResults: WaitResult[] = await Promise.all(
        Array.from(fileCache.keys()).map((relPath) =>
          waitForUnlock(relPath, ctx.agentId).then((r): WaitResult => ({ relPath, ...r }))
        )
      );
      const timedOutFiles = waitResults.filter((r): r is WaitResult & { timedOut: true; owner: string } => r.timedOut);
      if (timedOutFiles.length > 0) {
        const names = timedOutFiles.map((r) => `"${r.relPath}"`).join(', ');
        const owner = timedOutFiles[0].owner;
        return (
          `Cannot apply patches — the following file(s) are locked by another Copilot agent (${owner}): ${names}. ` +
          `Please let the user know: "I tried to edit ${names} but they are locked by a parallel task. ` +
          `Please let me know when the other task finishes so I can retry."`
        );
      }
      // Lock ALL files first so the shimmer overlay is visible for the full duration,
      // then write, then hold the lock for 400ms so the UI has time to render it.
      for (const relPath of fileCache.keys()) {
        lockFile(relPath, ctx.agentId);
        lockedPaths.push(relPath);
      }
      await new Promise<void>((r) => setTimeout(r, 0));
      try {
        for (const [relPath, { abs, text }] of fileCache) {
          try {
            await writeTextFile(abs, text);
            onFileWritten?.(relPath);
            onMarkRecorded?.(relPath, text);
          } catch (e) {
            writeErrors.push(`Failed to write ${relPath}: ${e}`);
          }
        }
        await new Promise<void>((r) => setTimeout(r, 400));
      } finally {
        for (const relPath of lockedPaths) unlockFile(relPath);
      }

      const desc = args.description ? ` (${args.description})` : '';
      const parts: string[] = [`multi_patch complete${desc}: ${fileCache.size} file(s) modified.`];
      if (patchResults.length) parts.push(`✓ ${patchResults.join('\n✓ ')}`);
      if (patchErrors.length)  parts.push(`Skipped:\n✗ ${patchErrors.join('\n✗ ')}`);
      if (writeErrors.length)  parts.push(`Write errors:\n✗ ${writeErrors.join('\n✗ ')}`);
      return parts.join('\n');
    }

    // ── scaffold_workspace ────────────────────────────────────────────────
    case 'scaffold_workspace': {
      // ── Preset builder ─────────────────────────────────────────────────
      const preset   = String(args.preset  ?? '').trim();
      const projTitle = String(args.title  ?? '').trim();
      const projAuthor = String(args.author ?? '').trim();
      const numChapters = Math.max(1, Math.min(50, Number(args.chapters ?? 5)));

      let entries: Array<{ path: string; content?: string }>;

      if (preset === 'book') {
        const pad = (n: number) => String(n).padStart(2, '0');
        const titleLine = projTitle ? `title: "${projTitle}"
` : '';
        const authorLine = projAuthor ? `author: "${projAuthor}"
` : '';
        entries = [
          ...Array.from({ length: numChapters }, (_, i) => ({
            path: `cap${pad(i + 1)}.md`,
            content: `---
${titleLine}${authorLine}chapter: ${i + 1}
title: "Capítulo ${i + 1}"
draft: true
---

`,
          })),
          {
            path: 'notas.md',
            content: `# Notas e Pesquisa

`,
          },
          {
            path: '.cafezin/memory.md',
            content: [
              projTitle  ? `# Projeto

Título: ${projTitle}${projAuthor ? `
Autor: ${projAuthor}` : ''}
` : '# Projeto

',
              '# Personagens

',
              '# Plot Notes

',
              '# World Building

',
              '# Glossário

',
              '# Style Preferences

',
            ].join('
'),
          },
        ];
      } else if (preset === 'course') {
        const pad = (n: number) => String(n).padStart(2, '0');
        const courseLabel = projTitle || 'Curso';
        entries = [
          { path: 'aulas/' },
          { path: 'recursos/' },
          ...Array.from({ length: numChapters }, (_, i) => {
            const n = pad(i + 1);
            return [
              { path: `aulas/Aula-${n}.tldr.json` },
              {
                path: `aulas/Aula-${n}-notas.md`,
                content: `---
title: "${courseLabel} — Aula ${i + 1}"
lesson: ${i + 1}
draft: true
---

## Objetivos

## Conteúdo

## Exercícios

`,
              },
            ];
          }).flat(),
          {
            path: '.cafezin/memory.md',
            content: [
              projTitle ? `# Projeto

Curso: ${projTitle}${projAuthor ? `
Professor: ${projAuthor}` : ''}
` : '# Projeto

',
              '# Course Structure

',
              '# Style Preferences

',
            ].join('
'),
          },
        ];
      } else {
        const raw = String(args.entries ?? '').trim();
        if (!raw) return 'Error: either preset ("book" or "course") or entries is required.';
        try {
          entries = JSON.parse(raw);
          if (!Array.isArray(entries)) return 'Error: entries must be a JSON array.';
        } catch (e) { return `Error: entries is not valid JSON: ${e}`; }
      }

      const created: string[] = [];
      const skipped: string[] = [];
      const errors: string[] = [];

      for (const entry of entries) {
        const entryPath = String(entry?.path ?? '').trim();
        if (!entryPath) { errors.push('Entry with empty path — skipped.'); continue; }
        const isDir = entryPath.endsWith('/');
        let abs: string;
        try { abs = safeResolvePath(workspacePath, entryPath.replace(/\/$/, '')); }
        catch (e) { errors.push(`Path traversal: ${entryPath}`); continue; }

        if (await exists(abs)) { skipped.push(entryPath); continue; }

        try {
          if (isDir) {
            await mkdir(abs, { recursive: true });
            created.push(`${entryPath} (dir)`);
          } else {
            const dir = abs.split('/').slice(0, -1).join('/');
            if (!(await exists(dir))) await mkdir(dir, { recursive: true });
            // Canvas files (.tldr.json) must always be created empty — writing raw
            // tldraw JSON here would produce a broken schema and a migration-error.
            const isCanvas = entryPath.endsWith('.tldr.json');
            const stubContent = isCanvas ? '' : (typeof entry.content === 'string' ? entry.content : '');
            await writeTextFile(abs, stubContent);
            onFileWritten?.(entryPath);
            created.push(isCanvas ? `${entryPath} (canvas — created empty, use canvas_op to populate)` : entryPath);
          }
        } catch (e) {
          errors.push(`Failed to create ${entryPath}: ${e}`);
        }
      }

      const desc = args.description ? ` (${args.description})` : '';
      const parts: string[] = [`Scaffold complete${desc}.`];
      if (created.length)  parts.push(`Created (${created.length}): ${created.join(', ')}`);
      if (skipped.length)  parts.push(`Skipped — already exist (${skipped.length}): ${skipped.join(', ')}`);
      if (errors.length)   parts.push(`Errors (${errors.length}): ${errors.join('; ')}`);
      return parts.join('\n');
    }

    default:
      return null;
  }
};
