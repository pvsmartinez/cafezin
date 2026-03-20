import type { FileTreeNode } from '../types';

export interface WorkspaceFileLinkTarget {
  path: string;
  line?: number;
}

interface WorkspaceFileReferenceIndex {
  exactPaths: Map<string, string>;
  uniqueBasenames: Map<string, string>;
}

const FILE_REFERENCE_REGEX = /(?:\/|\.{1,2}\/)?(?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)?(?:#L\d+(?:C\d+)?)?(?::\d+(?::\d+)?)?/g;
const TRAILING_REFERENCE_PUNCTUATION_REGEX = /[),.;!?]+$/;

/** Display label shown inside the file chip: `basename.ts` or `basename.ts:42` */
function fileChipLabel(path: string, line?: number): string {
  const basename = path.split('/').pop() ?? path;
  return line != null ? `${basename}:${line}` : basename;
}

function flattenFileTree(nodes: FileTreeNode[] | undefined): string[] {
  if (!nodes) return [];
  const files: string[] = [];
  for (const node of nodes) {
    if (node.isDirectory) files.push(...flattenFileTree(node.children));
    else files.push(node.path);
  }
  return files;
}

function buildReferenceIndex(fileTree?: FileTreeNode[]): WorkspaceFileReferenceIndex {
  const exactPaths = new Map<string, string>();
  const basenameCounts = new Map<string, number>();
  const basenameFirstPath = new Map<string, string>();

  for (const path of flattenFileTree(fileTree)) {
    const normalized = path.replace(/\\/g, '/');
    const lower = normalized.toLowerCase();
    exactPaths.set(lower, normalized);
    const base = normalized.split('/').pop()?.toLowerCase();
    if (!base) continue;
    basenameCounts.set(base, (basenameCounts.get(base) ?? 0) + 1);
    if (!basenameFirstPath.has(base)) basenameFirstPath.set(base, normalized);
  }

  const uniqueBasenames = new Map<string, string>();
  basenameCounts.forEach((count, base) => {
    if (count === 1) {
      const path = basenameFirstPath.get(base);
      if (path) uniqueBasenames.set(base, path);
    }
  });

  return { exactPaths, uniqueBasenames };
}

function parseLineSuffix(input: string): { pathCandidate: string; line?: number } {
  const hashMatch = input.match(/#L(\d+)(?:C\d+)?$/i);
  if (hashMatch) {
    return {
      pathCandidate: input.slice(0, -hashMatch[0].length),
      line: Number(hashMatch[1]),
    };
  }

  const colonMatch = input.match(/:(\d+)(?::\d+)?$/);
  if (colonMatch) {
    return {
      pathCandidate: input.slice(0, -colonMatch[0].length),
      line: Number(colonMatch[1]),
    };
  }

  return { pathCandidate: input };
}

function normalizePathCandidate(pathCandidate: string, workspacePath?: string): string {
  let normalized = decodeURIComponent(pathCandidate).trim().replace(/\\/g, '/');
  if (workspacePath) {
    const workspacePrefix = workspacePath.replace(/\\/g, '/').replace(/\/$/, '');
    if (normalized === workspacePrefix) return '';
    if (normalized.startsWith(`${workspacePrefix}/`)) {
      normalized = normalized.slice(workspacePrefix.length + 1);
    }
  }
  normalized = normalized.replace(/^\.\//, '');
  normalized = normalized.replace(/^\//, '');
  return normalized;
}

export function resolveWorkspaceFileReference(
  reference: string,
  fileTree?: FileTreeNode[],
  workspacePath?: string,
): WorkspaceFileLinkTarget | null {
  if (!reference) return null;

  const { pathCandidate, line } = parseLineSuffix(reference.trim());
  const normalized = normalizePathCandidate(pathCandidate, workspacePath);
  if (!normalized) return null;

  const index = buildReferenceIndex(fileTree);
  const lower = normalized.toLowerCase();
  const exact = index.exactPaths.get(lower);
  if (exact) return { path: exact, line };

  if (!normalized.includes('/')) {
    const byBase = index.uniqueBasenames.get(lower);
    if (byBase) return { path: byBase, line };
  }

  return null;
}

function shouldSkipWorkspaceReferenceNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  // Also skip inline <code> spans — they are handled separately by linkifyCodeSpansInHtml
  return !!parent.closest('a, code, pre, textarea, script, style');
}

/**
 * Wraps inline <code> elements (not inside <pre>) in an <a class="ai-file-link"> chip
 * when their entire text content resolves to a single workspace file reference.
 */
function linkifyCodeSpansInHtml(
  container: HTMLElement,
  fileTree?: FileTreeNode[],
  workspacePath?: string,
): void {
  container.querySelectorAll<HTMLElement>('code').forEach((code) => {
    // Skip code blocks (<pre><code>) and already-linked code
    if (code.closest('pre') || code.closest('a')) return;
    const text = code.textContent?.trim() ?? '';
    // Must look like a single file path: no whitespace, contains a dot extension
    if (!text || /\s/.test(text)) return;
    const resolved = resolveWorkspaceFileReference(text, fileTree, workspacePath);
    if (!resolved) return;
    const anchor = document.createElement('a');
    anchor.href = resolved.line != null ? `${resolved.path}#L${resolved.line}` : resolved.path;
    anchor.className = 'ai-file-link';
    anchor.setAttribute('data-file-path', resolved.path);
    if (resolved.line != null) anchor.setAttribute('data-line', String(resolved.line));
    anchor.title = resolved.line != null
      ? `Open ${resolved.path} at line ${resolved.line}`
      : `Open ${resolved.path}`;
    code.parentNode?.insertBefore(anchor, code);
    anchor.appendChild(code);
  });
}

function markExistingLocalLinks(container: HTMLElement, fileTree?: FileTreeNode[], workspacePath?: string): void {
  const anchors = container.querySelectorAll<HTMLAnchorElement>('a[href]');
  anchors.forEach((anchor) => {
    const href = anchor.getAttribute('href')?.trim();
    if (!href || /^(https?:)?\/\//i.test(href) || href.startsWith('mailto:')) return;
    const resolved = resolveWorkspaceFileReference(href, fileTree, workspacePath);
    if (!resolved) return;
    anchor.classList.add('ai-file-link');
    anchor.setAttribute('data-file-path', resolved.path);
    if (resolved.line != null) anchor.setAttribute('data-line', String(resolved.line));
    anchor.title = resolved.line != null
      ? `Open ${resolved.path} at line ${resolved.line}`
      : `Open ${resolved.path}`;
    anchor.textContent = fileChipLabel(resolved.path, resolved.line != null ? resolved.line : undefined);
  });
}

function replaceWorkspaceReferencesInTextNode(
  node: Text,
  fileTree?: FileTreeNode[],
  workspacePath?: string,
): void {
  const text = node.textContent ?? '';
  if (!text) return;

  FILE_REFERENCE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let changed = false;
  const fragment = document.createDocumentFragment();

  while ((match = FILE_REFERENCE_REGEX.exec(text)) !== null) {
    const rawMatch = match[0] ?? '';
    const matchIndex = match.index ?? 0;
    let display = rawMatch;
    let trailing = '';
    const trailingMatch = display.match(TRAILING_REFERENCE_PUNCTUATION_REGEX);
    if (trailingMatch) {
      trailing = trailingMatch[0];
      display = display.slice(0, -trailing.length);
    }
    if (!display) continue;

    const resolved = resolveWorkspaceFileReference(display, fileTree, workspacePath);
    if (!resolved) continue;

    fragment.append(text.slice(lastIndex, matchIndex));

    const anchor = document.createElement('a');
    anchor.href = resolved.line != null ? `${resolved.path}#L${resolved.line}` : resolved.path;
    anchor.className = 'ai-file-link';
    anchor.setAttribute('data-file-path', resolved.path);
    if (resolved.line != null) anchor.setAttribute('data-line', String(resolved.line));
    anchor.title = resolved.line != null
      ? `Open ${resolved.path} at line ${resolved.line}`
      : `Open ${resolved.path}`;
    anchor.textContent = fileChipLabel(resolved.path, resolved.line);
    fragment.append(anchor);

    if (trailing) fragment.append(trailing);
    lastIndex = matchIndex + rawMatch.length;
    changed = true;
  }

  if (!changed) return;
  fragment.append(text.slice(lastIndex));
  node.parentNode?.replaceChild(fragment, node);
}

export function linkifyWorkspaceReferencesInHtml(
  html: string,
  fileTree?: FileTreeNode[],
  workspacePath?: string,
): string {
  if (!html || typeof document === 'undefined' || !fileTree || fileTree.length === 0) return html;

  const container = document.createElement('div');
  container.innerHTML = html;

  markExistingLocalLinks(container, fileTree, workspacePath);
  linkifyCodeSpansInHtml(container, fileTree, workspacePath);

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current: Node | null;

  while ((current = walker.nextNode())) {
    if (!(current instanceof Text) || shouldSkipWorkspaceReferenceNode(current)) continue;
    FILE_REFERENCE_REGEX.lastIndex = 0;
    if (FILE_REFERENCE_REGEX.test(current.textContent ?? '')) {
      textNodes.push(current);
    }
  }

  textNodes.forEach((node) => replaceWorkspaceReferencesInTextNode(node, fileTree, workspacePath));
  return container.innerHTML;
}