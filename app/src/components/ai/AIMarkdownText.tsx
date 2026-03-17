import { useCallback, useEffect, useMemo, useRef } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { renderAssistantMarkdownHtml } from '../../utils/markdownRender';
import 'katex/dist/katex.min.css';
import '../MarkdownPreview.css';

interface AIMarkdownTextProps {
  content: string;
}

export function AIMarkdownText({ content }: AIMarkdownTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => {
    return renderAssistantMarkdownHtml(content);
  }, [content]);

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
    if (href.startsWith('http://') || href.startsWith('https://')) {
      void Promise.resolve(openUrl(href)).catch(() => {
        window.open(href, '_blank', 'noopener,noreferrer');
      });
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="ai-markdown-message md-preview-body"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}