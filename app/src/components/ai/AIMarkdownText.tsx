import { useCallback, useEffect, useMemo, useRef } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Workspace } from '../../types';
import { renderAssistantMarkdownHtmlWithWorkspace } from '../../utils/markdownRender';
import { resolveWorkspaceFileReference } from '../../utils/assistantFileLinks';
import 'katex/dist/katex.min.css';
import '../MarkdownPreview.css';

interface AIMarkdownTextProps {
  content: string;
  workspace?: Pick<Workspace, 'path' | 'fileTree'> | null;
  onOpenFileReference?: (relPath: string, lineNo?: number) => void | Promise<void>;
  onOpenSettings?: (tab?: string) => void;
}

export function AIMarkdownText({
  content,
  workspace,
  onOpenFileReference,
  onOpenSettings,
}: AIMarkdownTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => {
    return renderAssistantMarkdownHtmlWithWorkspace(content, workspace);
  }, [content, workspace]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
      if (pre.querySelector('.md-copy-btn')) return;

      const btn = document.createElement('button');
      btn.className = 'md-copy-btn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const code = pre.querySelector('code');
        navigator.clipboard.writeText(code?.textContent ?? '').then(() => {
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
        });
      });

      pre.appendChild(btn);
    });
  }, [html]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const link = (e.target as HTMLElement).closest('a');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href) return;
    e.preventDefault();
    // cafezin://settings?tab=<tab> — opens the Settings modal at the right tab
    if (href.startsWith('cafezin://settings')) {
      const url = new URL(href);
      const tab = url.searchParams.get('tab') ?? undefined;
      onOpenSettings?.(tab);
      return;
    }
    if (href.startsWith('http://') || href.startsWith('https://')) {
      void Promise.resolve(openUrl(href)).catch(() => {
        window.open(href, '_blank', 'noopener,noreferrer');
      });
      return;
    }
    // Prefer pre-resolved data attributes set during render (avoids re-resolution failure)
    const filePath = link.getAttribute('data-file-path');
    if (filePath && onOpenFileReference) {
      const lineStr = link.getAttribute('data-line');
      const line = lineStr != null ? Number(lineStr) : undefined;
      void Promise.resolve(onOpenFileReference(filePath, line));
      return;
    }
    // Fallback: re-resolve from href
    const resolved = resolveWorkspaceFileReference(href, workspace?.fileTree, workspace?.path);
    if (resolved && onOpenFileReference) {
      void Promise.resolve(onOpenFileReference(resolved.path, resolved.line));
    }
  }, [onOpenFileReference, workspace]);

  return (
    <div
      ref={containerRef}
      className="ai-markdown-message md-preview-body"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}