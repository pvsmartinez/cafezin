import { marked } from 'marked';
import type { Workspace, WorkspaceFeatureConfig } from '../types';
import { preprocessMath } from './mathPreprocess';
import { linkifyWorkspaceReferencesInHtml } from './assistantFileLinks';

marked.setOptions({ gfm: true, breaks: false });

interface RenderMarkdownOptions {
  features?: WorkspaceFeatureConfig;
}

const MERMAID_BLOCK_REGEX = /(^|\n)```mermaid(?:\s|\n)/;
const RAW_URL_REGEX = /\b((?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:\/[^^\s<]*)?)/gi;
const TRAILING_URL_PUNCTUATION_REGEX = /[),.;!?]+$/;

type MermaidAPI = {
  render: (id: string, code: string) => Promise<{
    svg: string;
    bindFunctions?: (element: Element) => void;
  }>;
};

let mermaidApiPromise: Promise<MermaidAPI> | null = null;

export function hasMermaidCodeBlocks(content: string): boolean {
  return MERMAID_BLOCK_REGEX.test(content);
}

export function isMermaidRenderingEnabled(features?: WorkspaceFeatureConfig): boolean {
  return features?.markdown?.mermaid !== false;
}

export function renderMarkdownBaseHtml(content: string): string {
  try {
    return marked.parse(preprocessMath(content)) as string;
  } catch {
    return '<p style="color:#c97570">Failed to render markdown.</p>';
  }
}

function shouldSkipLinkifyNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  return !!parent.closest('a, code, pre, button, textarea, script, style');
}

function replacePlainUrlsInTextNode(node: Text): void {
  const text = node.textContent ?? '';
  if (!text) return;

  RAW_URL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let changed = false;
  const fragment = document.createDocumentFragment();

  while ((match = RAW_URL_REGEX.exec(text)) !== null) {
    const rawMatch = match[0] ?? '';
    const matchIndex = match.index ?? 0;
    const previousChar = matchIndex > 0 ? text[matchIndex - 1] : '';
    if (previousChar === '@') continue;

    let displayUrl = rawMatch;
    let trailing = '';
    const trailingMatch = displayUrl.match(TRAILING_URL_PUNCTUATION_REGEX);
    if (trailingMatch) {
      trailing = trailingMatch[0];
      displayUrl = displayUrl.slice(0, -trailing.length);
    }
    if (!displayUrl) continue;

    fragment.append(text.slice(lastIndex, matchIndex));

    const anchor = document.createElement('a');
    anchor.href = displayUrl.startsWith('http://') || displayUrl.startsWith('https://')
      ? displayUrl
      : `https://${displayUrl}`;
    anchor.textContent = displayUrl;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    fragment.append(anchor);

    if (trailing) fragment.append(trailing);
    lastIndex = matchIndex + rawMatch.length;
    changed = true;
  }

  if (!changed) return;

  fragment.append(text.slice(lastIndex));
  node.parentNode?.replaceChild(fragment, node);
}

export function linkifyPlainUrlsInHtml(html: string): string {
  if (!html || typeof document === 'undefined') return html;

  const container = document.createElement('div');
  container.innerHTML = html;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current: Node | null;

  while ((current = walker.nextNode())) {
    if (!(current instanceof Text) || shouldSkipLinkifyNode(current)) continue;
    RAW_URL_REGEX.lastIndex = 0;
    if (RAW_URL_REGEX.test(current.textContent ?? '')) {
      textNodes.push(current);
    }
  }

  textNodes.forEach(replacePlainUrlsInTextNode);
  return container.innerHTML;
}

export function renderAssistantMarkdownHtml(content: string): string {
  return linkifyPlainUrlsInHtml(renderMarkdownBaseHtml(content));
}

export function renderAssistantMarkdownHtmlWithWorkspace(
  content: string,
  workspace?: Pick<Workspace, 'path' | 'fileTree'> | null,
): string {
  const withUrls = renderAssistantMarkdownHtml(content);
  return linkifyWorkspaceReferencesInHtml(withUrls, workspace?.fileTree, workspace?.path);
}

async function getMermaidApi(): Promise<MermaidAPI> {
  if (!mermaidApiPromise) {
    mermaidApiPromise = import('mermaid').then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'neutral',
        fontFamily: 'inherit',
        suppressErrorRendering: true,
      });
      return mermaid;
    });
  }
  return mermaidApiPromise;
}

async function renderMermaidBlocks(html: string): Promise<string> {
  const container = document.createElement('div');
  container.innerHTML = html;

  const codeBlocks = Array.from(
    container.querySelectorAll<HTMLElement>('pre > code.language-mermaid, pre > code.lang-mermaid'),
  );

  if (codeBlocks.length === 0) return html;

  const mermaid = await getMermaidApi();

  for (let index = 0; index < codeBlocks.length; index++) {
    const codeBlock = codeBlocks[index];
    const pre = codeBlock.closest('pre');
    const source = codeBlock.textContent?.trim() ?? '';
    if (!pre || !source) continue;

    const host = document.createElement('div');
    host.className = 'mermaid-diagram';

    try {
      const { svg, bindFunctions } = await mermaid.render(`cafezin-mermaid-${Date.now()}-${index}`, source);
      host.innerHTML = svg;
      const svgEl = host.querySelector('svg');
      if (svgEl) {
        svgEl.setAttribute('role', 'img');
        svgEl.setAttribute('aria-label', 'Mermaid diagram');
      }
      bindFunctions?.(host);
    } catch {
      host.classList.add('is-error');
      const fallback = document.createElement('pre');
      const fallbackCode = document.createElement('code');
      fallbackCode.className = 'language-mermaid';
      fallbackCode.textContent = source;
      fallback.appendChild(fallbackCode);
      host.appendChild(fallback);
    }

    pre.replaceWith(host);
  }

  return container.innerHTML;
}

export async function renderMarkdownToHtml(
  content: string,
  options?: RenderMarkdownOptions,
): Promise<string> {
  const baseHtml = renderMarkdownBaseHtml(content);
  if (!isMermaidRenderingEnabled(options?.features) || !hasMermaidCodeBlocks(content)) {
    return baseHtml;
  }
  return renderMermaidBlocks(baseHtml);
}