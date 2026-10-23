/**
 * useBacklinks — scans workspace markdown files for Zettelkasten-style links.
 *
 * Returns:
 *  backlinks  — files that link TO the current active file
 *  outlinks   — files that the active file links TO
 *
 * Patterns recognised:
 *   [text](filename.md)          standard relative link
 *   [text](./filename.md)
 *   [text](../dir/filename.md)
 *   [[filename]]                 wiki-style (extension optional)
 *   [[dir/filename]]
 *   [[filename|Label]]           wiki-style with custom label
 *
 * Parsing/resolution is shared with MarkdownPreview via utils/documentLinks.
 */
import { useEffect, useRef, useState } from 'react';
import { readTextFile } from '../services/fs';
import { WORKSPACE_MUTATED_EVENT } from '../services/workspace';
import type { Workspace } from '../types';
import {
  labelFromPath,
  parseDocumentLinks,
  resolveDocumentLink,
} from '../utils/documentLinks';

export interface LinkRef {
  /** Workspace-relative path of the file */
  path: string;
  /** Display label (file name without extension) */
  label: string;
}

export interface BacklinksResult {
  backlinks: LinkRef[];
  outlinks: LinkRef[];
  loading: boolean;
}

/** Extract all markdown link targets from a piece of text (shared parser) */
function extractLinks(text: string, sourcePath: string, existingPaths: string[]): string[] {
  const targets: string[] = [];
  const sourceDir = sourcePath.includes('/')
    ? sourcePath.split('/').slice(0, -1).join('/')
    : '';

  const links = parseDocumentLinks(text);
  for (const link of links) {
    const resolved = resolveDocumentLink(link.rawTarget, sourceDir, existingPaths);
    if (resolved) targets.push(resolved);
  }

  return [...new Set(targets)];
}

function sameLinkRefs(left: LinkRef[], right: LinkRef[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index].path !== right[index].path || left[index].label !== right[index].label) {
      return false;
    }
  }
  return true;
}

/** Get all markdown file paths from workspace (flat list) */
function collectMdFiles(workspace: Workspace): string[] {
  const result: string[] = [];
  function walk(nodes: typeof workspace.fileTree) {
    for (const n of nodes) {
      if (n.isDirectory && n.children) { walk(n.children); }
      else if (!n.isDirectory && /\.(md|mdx|txt)$/i.test(n.name)) {
        result.push(n.path);
      }
    }
  }
  walk(workspace.fileTree);
  return result;
}

export function useBacklinks(
  activeFile: string | null,
  workspace: Workspace | null,
  enabled = true,
): BacklinksResult {
  const [backlinks, setBacklinks] = useState<LinkRef[]>([]);
  const [outlinks, setOutlinks] = useState<LinkRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [mutationRevision, setMutationRevision] = useState(0);

  useEffect(() => {
    if (!enabled || !workspace) return;
    const handleMutation = (event: Event) => {
      if ((event as CustomEvent<{ workspacePath?: string }>).detail?.workspacePath === workspace.path) {
        setMutationRevision((revision) => revision + 1);
      }
    };
    window.addEventListener(WORKSPACE_MUTATED_EVENT, handleMutation);
    return () => window.removeEventListener(WORKSPACE_MUTATED_EVENT, handleMutation);
  }, [workspace?.path, enabled]);

  // Cached link map: Map<filePath, outgoing-link-paths[]>
  // Built once per workspace/file-list change; queried cheaply on tab switches.
  const [linkMap, setLinkMap] = useState<Map<string, string[]> | null>(null);

  // Content-based key to avoid rebuilding when fileTree reference changes but
  // the actual file list is identical (e.g. workspace refresh after save).
  const buildKeyRef = useRef('');
  const backlinksRef = useRef<LinkRef[]>([]);
  const outlinksRef = useRef<LinkRef[]>([]);

  // ── Effect 1: rebuild link map when the workspace file list actually changes ─
  // Does NOT depend on activeFile — tab switches no longer trigger file I/O.
  useEffect(() => {
    if (!workspace || !enabled) {
      buildKeyRef.current = '';
      setLinkMap(null);
      setLoading(false);
      if (backlinksRef.current.length > 0) {
        backlinksRef.current = [];
        setBacklinks([]);
      }
      if (outlinksRef.current.length > 0) {
        outlinksRef.current = [];
        setOutlinks([]);
      }
      return;
    }

    const mdFiles = collectMdFiles(workspace);
    const newKey = `${workspace.path}|${mutationRevision}|${mdFiles.join('\0')}`;

    // File list content unchanged — no need to re-read anything.
    if (newKey === buildKeyRef.current) return;

    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(async () => {
      const wsPath = workspace.path;

      // Read all markdown files in parallel — skip exists() check.
      const results = await Promise.all(
        mdFiles.map(async (filePath) => {
          if (cancelled) return null;
          try {
            const text = await readTextFile(`${wsPath}/${filePath}`);
            // Obsidian-style root fallback: any markdown file in the workspace is a
            // candidate target for wiki links, regardless of its directory.
            return { filePath, links: extractLinks(text, filePath, mdFiles) };
          } catch {
            return null; // file unreadable or deleted — skip
          }
        }),
      );

      if (cancelled) return;

      const map = new Map<string, string[]>();
      for (const result of results) {
        if (result) map.set(result.filePath, result.links);
      }
      buildKeyRef.current = newKey;
      setLinkMap(map);
      setLoading(false);
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  // workspace?.fileTree changes reference when files are added/deleted;
  // workspace?.path changes on workspace switch. activeFile is intentionally
  // NOT a dep here — tab switches must not trigger file reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.path, workspace?.fileTree, enabled, mutationRevision]);

  // ── Effect 2: derive backlinks for the active file — pure in-memory ──────
  // Runs on every tab switch but does ZERO file I/O; just filters the cached map.
  useEffect(() => {
    if (!activeFile || !enabled || !linkMap) {
      if (!activeFile || !enabled) {
        if (backlinksRef.current.length > 0) {
          backlinksRef.current = [];
          setBacklinks([]);
        }
        if (outlinksRef.current.length > 0) {
          outlinksRef.current = [];
          setOutlinks([]);
        }
      }
      return;
    }

    if (!/\.(md|mdx|txt)$/i.test(activeFile)) {
      if (backlinksRef.current.length > 0) {
        backlinksRef.current = [];
        setBacklinks([]);
      }
      if (outlinksRef.current.length > 0) {
        outlinksRef.current = [];
        setOutlinks([]);
      }
      return;
    }

    const foundBacklinks: LinkRef[] = [];
    const foundOutlinks: LinkRef[] = [];

    for (const [filePath, links] of linkMap) {
      if (filePath === activeFile) {
        for (const target of links) {
          if (target !== activeFile) {
            foundOutlinks.push({ path: target, label: labelFromPath(target) });
          }
        }
      } else if (links.includes(activeFile)) {
        foundBacklinks.push({ path: filePath, label: labelFromPath(filePath) });
      }
    }

    if (!sameLinkRefs(backlinksRef.current, foundBacklinks)) {
      backlinksRef.current = foundBacklinks;
      setBacklinks(foundBacklinks);
    }
    if (!sameLinkRefs(outlinksRef.current, foundOutlinks)) {
      outlinksRef.current = foundOutlinks;
      setOutlinks(foundOutlinks);
    }
  }, [activeFile, linkMap, enabled]);

  return { backlinks, outlinks, loading };
}
