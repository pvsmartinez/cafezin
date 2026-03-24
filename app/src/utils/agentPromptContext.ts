import type { AgentInstructionSource, FileTreeNode, WorkspaceIndex } from '../types';

const MAX_GUIDANCE_CHARS = 3600;
const MAX_FILE_HINTS = 8;
const IMPORTANT_FILE_NAMES = new Set([
  'readme.md',
  'agent.md',
  'copilot-instructions.md',
  'instructions.md',
  'overview.md',
  'summary.md',
  'outline.md',
  'plan.md',
  'brief.md',
  'notes.md',
  'inbox.md',
  'index.md',
]);

interface MarkdownSection {
  heading: string;
  body: string;
  level: number;
  order: number;
}

interface WorkspaceFileSummaryOptions {
  activeFile?: string;
  recentFiles?: string[];
  maxFiles?: number;
  /** Pre-built workspace index — used to enrich top-ranked files with outline snippets. */
  workspaceIndex?: WorkspaceIndex;
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitMarkdownSections(content: string): MarkdownSection[] {
  const lines = content.replace(/\r/g, '').split('\n');
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;
  let order = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      if (current && current.body.trim()) sections.push(current);
      current = {
        heading: headingMatch[2].trim(),
        level: headingMatch[1].length,
        body: '',
        order: order++,
      };
      continue;
    }

    if (!current) {
      current = { heading: 'Context', level: 1, body: '', order: order++ };
    }
    current.body += `${line}\n`;
  }

  if (current && current.body.trim()) sections.push(current);
  return sections;
}

function scoreSection(section: MarkdownSection): number {
  const heading = section.heading.toLowerCase();
  const body = section.body.toLowerCase();
  let score = section.level <= 2 ? 10 : 0;

  const strongKeep = [
    'what this app does',
    'what we are building',
    'workspace behaviour',
    'core philosophy',
    'critical rules',
    'language',
    'file types',
    'key data flows',
    'agent',
    'assistant',
    'context',
    'workflow',
    'capabilities',
    'rules',
    'writing',
    'canvas',
    'spreadsheet',
    // Schema / data model sections — these change over time and are critical anchor points
    'schema',
    'data model',
    'data structure',
    'breaking change',
    'migration',
    'current state',
    'current rules',
    'changed',
    'format',
    'structure',
  ];
  const softKeep = [
    'project',
    'product',
    'target',
    'behavior',
    'behaviour',
    'convention',
    'workspace',
    'tool',
    'document',
  ];
  const drop = [
    'dev workflow',
    'build',
    'deploy',
    'credentials',
    'billing',
    'token',
    'vercel',
    'fastlane',
    'production status',
    'project refs',
    'commands',
  ];

  for (const token of strongKeep) {
    if (heading.includes(token) || body.includes(token)) score += 45;
  }
  for (const token of softKeep) {
    if (heading.includes(token)) score += 18;
  }
  for (const token of drop) {
    if (heading.includes(token)) score -= 35;
  }
  if (/^[-*]\s/m.test(section.body)) score += 8;
  if (section.body.length > 1800) score -= 8;

  return score;
}

function compactSection(section: MarkdownSection, remainingChars: number): string | null {
  const cleanBody = normalizeWhitespace(section.body);
  if (!cleanBody) return null;
  const rendered = `## ${section.heading}\n${cleanBody}`;
  if (rendered.length <= remainingChars) return rendered;

  const cutoff = Math.max(0, remainingChars - (`## ${section.heading}\n…`.length));
  if (cutoff < 120) return null;

  let bodyCut = cleanBody.slice(0, cutoff);
  const boundary = Math.max(
    bodyCut.lastIndexOf('\n- '),
    bodyCut.lastIndexOf('\n• '),
    bodyCut.lastIndexOf('\n\n'),
    bodyCut.lastIndexOf('. '),
    bodyCut.lastIndexOf('\n'),
  );
  if (boundary > 80) bodyCut = bodyCut.slice(0, boundary).trimEnd();
  return `## ${section.heading}\n${bodyCut}\n…`;
}

export function buildAgentGuidanceDigest(
  sourcesOrText?: AgentInstructionSource[] | string,
  maxChars = MAX_GUIDANCE_CHARS,
): string {
  if (!sourcesOrText) return '';

  const sources = typeof sourcesOrText === 'string'
    ? [{ path: 'AGENT.md', content: sourcesOrText }]
    : sourcesOrText.filter((source) => source.content.trim());

  if (sources.length === 0) return '';

  const sections = sources.flatMap((source) =>
    splitMarkdownSections(source.content).map((section) => ({
      ...section,
      heading: source.path === 'AGENT.md'
        ? section.heading
        : `${section.heading} (${source.path})`,
    })),
  );

  const ranked = sections
    .map((section) => ({ section, score: scoreSection(section) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.section.order - right.section.order;
    });

  const selected: string[] = [];
  let remaining = maxChars;
  for (const entry of ranked) {
    const compact = compactSection(entry.section, remaining);
    if (!compact) continue;
    selected.push(compact);
    remaining -= compact.length + 2;
    if (remaining < 160) break;
  }

  if (selected.length === 0) {
    return normalizeWhitespace(sources.map((source) => source.content).join('\n\n')).slice(0, maxChars);
  }

  return selected.join('\n\n').trim();
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

function fileCategory(path: string): 'markdown' | 'canvas' | 'spreadsheet' | 'html' | 'code' | 'other' {
  const lower = path.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.mdx') || lower.endsWith('.txt')) return 'markdown';
  if (lower.endsWith('.tldr.json')) return 'canvas';
  if (/\.(csv|tsv|xlsx|xls|ods|xlsm|xlsb)$/i.test(lower)) return 'spreadsheet';
  if (/\.(html|htm)$/i.test(lower)) return 'html';
  if (/\.(ts|tsx|js|jsx|json|css|py|rs|sh|sql)$/i.test(lower)) return 'code';
  return 'other';
}

function scoreFile(path: string, options: WorkspaceFileSummaryOptions): number {
  const lower = path.toLowerCase();
  const base = lower.split('/').pop() ?? lower;
  const recentIndex = options.recentFiles?.findIndex((item) => item === path) ?? -1;
  let score = 0;

  if (path === options.activeFile) score += 300;
  if (recentIndex >= 0) score += 180 - recentIndex * 15;
  if (IMPORTANT_FILE_NAMES.has(base)) score += 90;

  switch (fileCategory(path)) {
    case 'markdown':
      score += 30;
      break;
    case 'canvas':
    case 'spreadsheet':
      score += 24;
      break;
    case 'html':
      score += 18;
      break;
    case 'code':
      score += 12;
      break;
    default:
      break;
  }

  const segments = path.split('/').length;
  score += Math.max(0, 12 - segments * 2);

  if (options.activeFile && segments > 1) {
    const activeDir = options.activeFile.includes('/')
      ? options.activeFile.slice(0, options.activeFile.lastIndexOf('/'))
      : '';
    if (activeDir && path.startsWith(`${activeDir}/`)) score += 20;
  }

  return score;
}

export function summarizeWorkspaceFiles(
  fileTree: FileTreeNode[] | undefined,
  options: WorkspaceFileSummaryOptions = {},
): string {
  const files = flattenFileTree(fileTree);
  if (files.length === 0) return '';

  const counts = {
    markdown: 0,
    canvas: 0,
    spreadsheet: 0,
    html: 0,
    code: 0,
    other: 0,
  };

  for (const path of files) {
    counts[fileCategory(path)] += 1;
  }

  const topFiles = [...files]
    .sort((left, right) => {
      const scoreDiff = scoreFile(right, options) - scoreFile(left, options);
      if (scoreDiff !== 0) return scoreDiff;
      return left.localeCompare(right, undefined, { sensitivity: 'base' });
    })
    .slice(0, options.maxFiles ?? MAX_FILE_HINTS);

  const lines = [
    `Workspace snapshot: ${files.length} file(s) total ` +
      `(${counts.markdown} markdown, ${counts.canvas} canvas, ${counts.spreadsheet} spreadsheets, ${counts.html} html, ${counts.code} code, ${counts.other} other).`,
  ];

  const labeled = topFiles.map((path) => {
    const tags: string[] = [];
    if (path === options.activeFile) tags.push('active');
    if (options.recentFiles?.includes(path)) tags.push('recent');
    if (IMPORTANT_FILE_NAMES.has(path.toLowerCase().split('/').pop() ?? '')) tags.push('key');
    return tags.length > 0 ? `${path} [${tags.join(', ')}]` : path;
  });

  if (labeled.length > 0) {
    lines.push(`Likely relevant now: ${labeled.join('; ')}`);
  }

  return lines.join('\n');
}

function trimAtNaturalBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const boundary = Math.max(
    slice.lastIndexOf('\n# '),
    slice.lastIndexOf('\n## '),
    slice.lastIndexOf('\n### '),
    slice.lastIndexOf('\n\n'),
    slice.lastIndexOf('\n'),
    slice.lastIndexOf('. '),
  );
  const cut = boundary > Math.floor(maxChars * 0.6) ? boundary : maxChars;
  return `${slice.slice(0, cut).trimEnd()}\n…`;
}

export function truncateDocumentContext(
  documentContext: string,
  activeFile?: string,
  maxChars = 12000,
): string {
  const clean = documentContext.trim();
  if (!clean) return '';
  if (!activeFile) return '';
  const normalized = clean.replace(/\s+/g, ' ').trim().toLowerCase();
  if (
    normalized === '# untitled document start writing here…'
    || normalized === '# untitled document start writing here...'
    || (normalized.includes('untitled document') && normalized.includes('start writing here'))
  ) {
    return '';
  }
  if (clean.length <= maxChars) return clean;

  const lower = activeFile?.toLowerCase() ?? '';
  if (lower.endsWith('.md') || lower.endsWith('.mdx') || lower.endsWith('.txt')) {
    return trimAtNaturalBoundary(clean, maxChars);
  }
  return `${clean.slice(0, maxChars).trimEnd()}\n…`;
}
