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
        'List every file in the workspace. Call this first when you need to know what documents exist before reading or searching.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_workspace_file',
      description:
        'Read the content of a file. Returns the full text or a specific line range. ' +
        'For files larger than 40 KB the response is truncated — call again with start_line/end_line to page through the rest. ' +
        'NOTE: .tldr.json canvas files are BLOCKED — they contain base64 images and will overflow the context. Use list_canvas_shapes to inspect a canvas (it includes shape positions, asset IDs, and text).',
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
            description: '1-based line number to stop reading at (inclusive). Omit to read to the end (up to the 40 KB cap).',
          },
        },
        required: ['path'],
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
        'Search for a word or phrase across all text files in the workspace. Returns matching lines with file context. Good for finding where a topic is mentioned.',
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
        'Use when the user asks to set up a project layout, create a chapter structure, ' +
        'scaffold a course, or initialise any multi-file structure. ' +
        'Each entry can be a folder (path ending with /) or a file (with optional stub content). ' +
        'IMPORTANT: canvas files (.tldr.json) are ALWAYS created empty regardless of any content supplied — do NOT put tldraw JSON in the content field. Use canvas_op AFTER opening the file instead.',
      parameters: {
        type: 'object',
        properties: {
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
        required: ['entries'],
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
      return `${files.length} file(s) in workspace:\n${files.join('\n')}`;
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

        const CAP = 40_000;
        if (text.length > CAP) {
          const capText = text.slice(0, CAP);
          const capLines = capText.split('\n');
          const lastFullLine = capLines.length - 1;
          const truncated = capLines.slice(0, lastFullLine).join('\n');
          return `${truncated}\n\n[… truncated after line ${lastFullLine} of ${totalLines} total. ` +
            `Re-call with start_line=${lastFullLine + 1} to continue reading.]`;
        }
        return text;
      } catch (e) {
        return `Error reading file: ${e}`;
      }
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

      const needle = query.toLowerCase();
      const hits: string[] = [];
      const MAX_HITS = 30;

      for (const rel of textFiles) {
        if (hits.length >= MAX_HITS) break;
        let text: string;
        try { text = await readTextFile(`${workspacePath}/${rel}`); } catch { continue; }
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (hits.length >= MAX_HITS) break;
          if (lines[i].toLowerCase().includes(needle)) {
            const before = i > 0 ? `  ${lines[i - 1]}` : '';
            const after  = i < lines.length - 1 ? `  ${lines[i + 1]}` : '';
            hits.push(`${rel}:${i + 1}:\n${before}\n> ${lines[i]}\n${after}`);
          }
        }
      }

      if (hits.length === 0) return `No matches found for "${query}" across ${textFiles.length} files.`;
      return `Found ${hits.length} match(es) for "${query}":\n\n${hits.join('\n\n')}`;
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
      const raw = String(args.entries ?? '').trim();
      if (!raw) return 'Error: entries is required.';
      let entries: Array<{ path: string; content?: string }>;
      try {
        entries = JSON.parse(raw);
        if (!Array.isArray(entries)) return 'Error: entries must be a JSON array.';
      } catch (e) { return `Error: entries is not valid JSON: ${e}`; }

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
