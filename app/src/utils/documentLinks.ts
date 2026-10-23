import type { FileTreeNode } from '../types';

export interface ParsedDocumentLink {
  rawTarget: string;
  label: string;
  isWiki: boolean;
}

const WIKI_LINK = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;
const SCHEME = /^[a-z][a-z\d+.-]*:/i;

export const normalizePath = (path: string): string =>
  path.replace(/\\/g, '/').trim().replace(/^\.\//, '').replace(/^\//, '');

export const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const labelFromPath = (path: string): string =>
  (normalizePath(path).split('/').pop() ?? '').replace(/\.(md|mdx|markdown|txt)$/i, '');

const isEscaped = (text: string, offset: number): boolean => {
  let backslashes = 0;
  for (let i = offset - 1; i >= 0 && text[i] === '\\'; i--) backslashes++;
  return backslashes % 2 === 1;
};

/** Decode once, rejecting schemes, absolute paths, controls, and ambiguous double encoding. */
const safeTarget = (raw: string): string | null => {
  let target: string;
  try { target = decodeURIComponent(raw.trim().split('#')[0].split('?')[0]); }
  catch { return null; }
  if (!target || /^[\/\\]/.test(target) || SCHEME.test(target) ||
      /[\u0000-\u001f\u007f<>]/.test(target) || /%[\da-f]{2}/i.test(target)) return null;
  return target.replace(/\\/g, '/');
};

/** Never clamp traversal outside the workspace back into it. */
export const resolvePath = (fromDir: string, target: string): string | null => {
  const stack = normalizePath(fromDir).split('/').filter(Boolean);
  for (const part of target.replace(/\\/g, '/').split('/')) {
    if (part === '..') {
      if (!stack.length) return null;
      stack.pop();
    } else if (part && part !== '.') stack.push(part);
  }
  return stack.join('/') || null;
};

export const flattenFileTree = (nodes?: FileTreeNode[]): string[] =>
  (nodes ?? []).flatMap((node) => node.isDirectory
    ? flattenFileTree(node.children) : [node.path]);

/** Relative-first, then root fallback; return the real path/case from the file tree. */
export function resolveDocumentLink(
  rawTarget: string,
  fromDir: string,
  existingPaths?: string[],
): string | null {
  const target = safeTarget(rawTarget);
  if (!target) return null;
  const relative = resolvePath(fromDir, target);
  if (!relative) return null;
  const hasExtension = /\.[^/]+$/.test(target);
  const candidates: string[] = [];
  const add = (path: string | null) => {
    if (!path) return;
    candidates.push(path);
    if (!hasExtension) candidates.push(`${path}.md`);
  };
  add(relative);
  add(resolvePath('', target));
  if (existingPaths === undefined) return hasExtension ? relative : `${relative}.md`;
  for (const candidate of candidates) {
    const exact = existingPaths.find((path) => path === candidate);
    if (exact) return exact;
    const matches = existingPaths.filter((path) => path.toLowerCase() === candidate.toLowerCase());
    if (matches.length === 1) return matches[0];
  }
  return null;
}

interface Segment { text: string; code: boolean }

/** Protect fenced/inline/indented code and HTML tags before rewriting wiki syntax. */
function segments(content: string): Segment[] {
  const result: Segment[] = [];
  let start = 0;
  let index = 0;
  const protect = (end: number) => {
    if (index > start) result.push({ text: content.slice(start, index), code: false });
    result.push({ text: content.slice(index, end), code: true });
    index = end;
    start = end;
  };
  while (index < content.length) {
    const rest = content.slice(index);
    if (index === 0 || content[index - 1] === '\n') {
      const fence = /^( {0,3})(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(rest);
      if (fence) {
        const delimiter = fence[2];
        const closing = new RegExp(`^ {0,3}${delimiter[0]}{${delimiter.length},}[ \\t]*(?:\\r?\\n|$)`, 'gm');
        closing.lastIndex = index + fence[0].length;
        const match = closing.exec(content);
        protect(match ? match.index + match[0].length : content.length);
        continue;
      }
      const indented = /^(?: {4}|\t)[^\n]*(?:\n|$)/.exec(rest);
      if (indented) { protect(index + indented[0].length); continue; }
    }
    if (content[index] === '`' && !isEscaped(content, index)) {
      const delimiter = /^`+/.exec(rest)![0];
      let closing = content.indexOf(delimiter, index + delimiter.length);
      while (closing >= 0 && (content[closing - 1] === '`' ||
          content[closing + delimiter.length] === '`')) {
        closing = content.indexOf(delimiter, closing + delimiter.length);
      }
      if (closing < 0) { index += delimiter.length; continue; }
      protect(closing + delimiter.length);
      continue;
    }
    const wiki = /^\[\[[^\n]*?\]\]/.exec(rest);
    if (wiki && !isEscaped(content, index)) { index += wiki[0].length; continue; }
    if (content[index] === '<') {
      const block = /^<(pre|code|a|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/i.exec(rest);
      const tag = block ?? /^<[^>]*>/.exec(rest);
      if (tag) { protect(index + tag[0].length); continue; }
    }
    index++;
  }
  if (start < content.length) result.push({ text: content.slice(start), code: false });
  return result;
}

export function parseDocumentLinks(content: string): ParsedDocumentLink[] {
  const text = segments(content).map((segment) => segment.code
    ? segment.text.replace(/[^\n]/g, ' ') : segment.text).join('');
  const found: { index: number; link: ParsedDocumentLink }[] = [];
  for (const match of text.matchAll(new RegExp(WIKI_LINK))) {
    if (isEscaped(text, match.index!)) continue;
    const rawTarget = match[1].trim();
    if (!safeTarget(rawTarget)) continue;
    found.push({ index: match.index!, link: {
      rawTarget, label: match[2]?.trim() || labelFromPath(rawTarget), isWiki: true,
    } });
  }
  const markdownLink = /\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of text.matchAll(markdownLink)) {
    if (isEscaped(text, match.index!) || text[match.index! - 1] === '!') continue;
    const rawTarget = match[2].split('#')[0];
    if (!safeTarget(rawTarget)) continue;
    found.push({ index: match.index!, link: {
      rawTarget, label: match[1].trim() || labelFromPath(rawTarget), isWiki: false,
    } });
  }
  return found.sort((left, right) => left.index - right.index).map(({ link }) => link);
}

/** Tiptap's Markdown serializer escapes literal brackets; retain portable wiki references. */
export function restoreProseWikiLinks(markdown: string, source: string): string {
  const unescape = (value: string) => value.replace(/\\([\\`*_{}\[\]()#+\-.!|>])/g, '$1');
  const occurrences = new Map<string, boolean[]>();
  // Track each occurrence, not a set: a document can contain both a real
  // [[reference]] and an escaped example with the exact same label/target.
  for (const segment of segments(source)) {
    if (segment.code) continue;
    for (const match of segment.text.matchAll(/(\\?\[\\?\[)([^\n]+?)(\\?\]\\?\])/g)) {
      const raw = `[[${unescape(match[2])}]]`;
      const bracket = match.index! + (match[1].startsWith('\\') ? 1 : 0);
      const literal = isEscaped(segment.text, bracket) ||
        match[1].slice(-2).startsWith('\\') || match[3].includes('\\');
      occurrences.set(raw, [...(occurrences.get(raw) ?? []), literal]);
    }
  }
  return segments(markdown).map((segment) => segment.code ? segment.text :
    segment.text.replace(/\\\[\\\[([^\n]+?)\\\]\\\]/g, (match, inside: string) => {
      const raw = `[[${unescape(inside)}]]`;
      return occurrences.get(raw)?.shift() ? match : raw;
    }),
  ).join('');
}

export function preprocessWikiLinksToHtml(content: string): string {
  return segments(content).map((segment) => {
    if (segment.code) return segment.text;
    return segment.text.replace(new RegExp(WIKI_LINK),
      (match: string, target: string, label: string | undefined, offset: number) => {
        if (isEscaped(segment.text, offset)) return match;
        if (!safeTarget(target)) return escapeHtml(match);
        const display = escapeHtml(label?.trim() || labelFromPath(target));
        return `<a class="wiki-link" href="${escapeHtml(target.trim())}">${display}</a>`;
      });
  }).join('');
}
