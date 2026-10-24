/**
 * Manuscript structure — how a workspace folder is presented as a book.
 *
 * Files stay ordinary Markdown on disk. The only thing persisted is the
 * ordered list of chapter paths in `.cafezin/config.json` (`manuscript`).
 * Without that list, chapters are inferred from conventional names
 * (`01-…`, `capitulo-2`, `chapter 3`, or files inside a `capitulos/` folder).
 */
import type { FileTreeNode, WorkspaceConfig } from '../types';
import { getFileTypeInfo } from './fileType';

export interface ManuscriptLayout {
  /** Chapter paths, in reading/export order. */
  chapters: string[];
  /** Other writable texts (notes, characters, reports…). */
  notebook: string[];
  /** Read-only references: PDFs, images, audio, video. */
  research: string[];
  /** Files Cafezin does not open (legacy formats); listed so they never vanish. */
  other: string[];
}

const CHAPTER_NAME = /^(\d{1,3}[\s._-]|cap(i|í)tulo[\s._-]*\d|cap[\s._-]*\d|chapter[\s._-]*\d|parte[\s._-]*\d)/i;
const CHAPTER_DIR = /^(cap(i|í)tulos|chapters|manuscrito|manuscript)$/i;
const AGENT_FILES = /^(AGENTS?|CLAUDE|README)\.md$/i;
/** Generated output (book PDFs and older export targets) is not source material. */
const OUTPUT_DIR = /^(exports|dist)\//;

function flatten(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.flatMap((n) => (n.isDirectory ? flatten(n.children ?? []) : [n]));
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function isLikelyChapter(path: string): boolean {
  const parts = path.split('/');
  const name = parts[parts.length - 1];
  if (parts.slice(0, -1).some((dir) => CHAPTER_DIR.test(dir))) return true;
  return CHAPTER_NAME.test(name);
}

export function buildManuscriptLayout(
  fileTree: FileTreeNode[],
  config: Pick<WorkspaceConfig, 'manuscript'>,
): ManuscriptLayout {
  const files = flatten(fileTree);
  const texts: string[] = [];
  const research: string[] = [];
  const other: string[] = [];
  for (const file of files) {
    if (OUTPUT_DIR.test(file.path)) continue;
    const kind = getFileTypeInfo(file.name).kind;
    if (kind === 'markdown') texts.push(file.path);
    else if (kind === 'pdf' || kind === 'image' || kind === 'video' || kind === 'audio') research.push(file.path);
    else other.push(file.path);
  }

  const existing = new Set(texts);
  const saved = config.manuscript?.chapters;
  const chapters = saved
    ? saved.filter((p) => existing.has(p))
    : texts.filter((p) => isLikelyChapter(p) && !AGENT_FILES.test(p)).sort(collator.compare);

  const inBook = new Set(chapters);
  const notebook = texts
    .filter((p) => !inBook.has(p))
    .sort((a, b) => {
      // Agent instructions sink to the bottom of the notebook.
      const aAgent = AGENT_FILES.test(a.split('/').pop() ?? '');
      const bAgent = AGENT_FILES.test(b.split('/').pop() ?? '');
      if (aAgent !== bAgent) return aAgent ? 1 : -1;
      return collator.compare(a, b);
    });

  return {
    chapters,
    notebook,
    research: research.sort(collator.compare),
    other: other.sort(collator.compare),
  };
}

/** Human title of a text: its first H1, or else its first heading of any level. */
export function extractTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+?)\s*#*\s*$/m) ?? content.match(/^#{2,6}\s+(.+?)\s*#*\s*$/m);
  return match ? match[1].trim() : null;
}

export function countWords(content: string): number {
  const text = content
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[#>*_`~[\]()-]/g, ' ');
  const words = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu);
  return words ? words.length : 0;
}

/** Next free path for a new text, e.g. `capitulo-06.md` or `Sem título 2.md`. */
export function nextFreePath(base: string, ext: string, taken: Set<string>, pad = 0): string {
  for (let i = 1; i < 1000; i++) {
    const suffix = pad ? String(i).padStart(pad, '0') : (i === 1 ? '' : ` ${i}`);
    const candidate = pad ? `${base}-${suffix}.${ext}` : `${base}${suffix}.${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}.${ext}`;
}
