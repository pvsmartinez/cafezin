import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'katex/dist/katex.min.css';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { WorkspaceFeatureConfig } from '../types';
import { hasMermaidCodeBlocks, renderMarkdownBaseHtml, renderMarkdownToHtml } from '../utils/markdownRender';
import './MarkdownPreview.css';

interface MarkdownPreviewProps {
  content: string;
  /** Called when the user clicks a relative Markdown link (e.g. ./notes.md). */
  onNavigate?: (relPath: string) => void;
  /** Absolute path of the file currently being previewed — used to resolve
   *  relative links (e.g. ../folder/other.md → folder/other.md). */
  currentFilePath?: string;
  /** Optional per-workspace render capabilities. */
  features?: WorkspaceFeatureConfig;
}

export default function MarkdownPreview({ content, onNavigate, currentFilePath, features }: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const baseHtml = useMemo(() => renderMarkdownBaseHtml(content), [content]);
  const [html, setHtml] = useState(baseHtml);

  useEffect(() => {
    setHtml(baseHtml);
  }, [baseHtml]);

  useEffect(() => {
    if (!features?.markdown?.mermaid || !hasMermaidCodeBlocks(content)) return;

    let cancelled = false;
    void renderMarkdownToHtml(content, { features })
      .then((nextHtml) => {
        if (!cancelled) setHtml(nextHtml);
      })
      .catch(() => {
        if (!cancelled) setHtml(baseHtml);
      });

    return () => {
      cancelled = true;
    };
  }, [baseHtml, content, features]);

  // Inject copy buttons into every <pre> block after each render.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
      if (pre.querySelector('.md-copy-btn')) return; // already injected
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

  // Intercept link clicks: open external URLs in the system browser.
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const link = (e.target as HTMLElement).closest('a');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href) return;
    e.preventDefault();
    if (href.startsWith('http://') || href.startsWith('https://')) {
      openUrl(href);
      return;
    }
    // Relative file link — resolve against current file's directory
    if (!href.startsWith('#') && onNavigate) {
      let target = href.split('#')[0]; // strip anchor fragment
      if (target) {
        // Resolve relative to the current file's directory
        if (currentFilePath) {
          const dir = currentFilePath.includes('/')
            ? currentFilePath.split('/').slice(0, -1).join('/')
            : '';
          const parts = (dir ? dir + '/' + target : target).split('/');
          const resolved: string[] = [];
          for (const p of parts) {
            if (p === '..') resolved.pop();
            else if (p !== '.') resolved.push(p);
          }
          target = resolved.join('/');
        }
        onNavigate(target);
      }
    }
  }, [onNavigate, currentFilePath]);

  return (
    <div className="md-preview-scroll">
      <div
        ref={containerRef}
        className="md-preview-body"
        onClick={handleClick}
        // marked sanitises nothing — but content is local files the user owns
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
