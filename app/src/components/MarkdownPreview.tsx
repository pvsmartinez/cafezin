import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { FileTreeNode, WorkspaceFeatureConfig } from '../types';
import { ensureKatexCss } from '../utils/ensureKatexCss';
import { flattenFileTree, resolveDocumentLink } from '../utils/documentLinks';
import {
  hasMermaidCodeBlocks,
  isMermaidRenderingEnabled,
  renderMarkdownBaseHtml,
  renderMarkdownToHtml,
} from '../utils/markdownRender';
import './MarkdownPreview.css';

interface MarkdownPreviewProps {
  content: string;
  /** Called when the user clicks a relative Markdown link (e.g. ./notes.md). */
  onNavigate?: (relPath: string) => void;
  /** Workspace-relative path of the file currently being previewed — used to resolve
   *  relative links (e.g. ../folder/other.md → folder/other.md). */
  currentFilePath?: string;
  /** Optional per-workspace render capabilities. */
  features?: WorkspaceFeatureConfig;
  /** Workspace file tree — enables Obsidian-style root fallback for wiki links
   *  ([[file]] resolves even when the file is outside the current document dir).
   *  Contract: parent (AppEditorArea) should pass workspace.fileTree here. */
  workspaceFileTree?: FileTreeNode[];
}

export default function MarkdownPreview({
  content,
  onNavigate,
  currentFilePath,
  features,
  workspaceFileTree,
}: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [missingTarget, setMissingTarget] = useState<string | null>(null);

  useEffect(() => { setMissingTarget(null); }, [content, currentFilePath]);

  useEffect(() => {
    void ensureKatexCss();
  }, []);

  const baseHtml = useMemo(() => renderMarkdownBaseHtml(content), [content]);
  const [html, setHtml] = useState(baseHtml);

  useEffect(() => {
    setHtml(baseHtml);
  }, [baseHtml]);

  useEffect(() => {
    if (!isMermaidRenderingEnabled(features) || !hasMermaidCodeBlocks(content)) return;

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
    if (/^https?:\/\//i.test(href)) {
      openUrl(href);
      return;
    }
    // Relative file link (markdown or wiki) — resolve via the shared resolver
    if (!href.startsWith('#') && onNavigate) {
      const target = href.split('#')[0]; // strip anchor fragment
      if (target) {
        const dir = currentFilePath?.includes('/')
          ? currentFilePath.split('/').slice(0, -1).join('/')
          : '';
        const existingPaths = workspaceFileTree ? flattenFileTree(workspaceFileTree) : undefined;
        const resolved = resolveDocumentLink(target, dir, existingPaths);
        if (resolved) { setMissingTarget(null); onNavigate(resolved); }
        else setMissingTarget(target);
      }
    }
  }, [onNavigate, currentFilePath, workspaceFileTree]);

  return (
    <div className="md-preview-scroll">
      <div
        ref={containerRef}
        className="md-preview-body"
        onClick={handleClick}
        // renderMarkdownBaseHtml sanitizes all generated HTML with DOMPurify.
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {missingTarget && <p className="md-missing-link" role="status">
        Referência não encontrada: {missingTarget}. Nenhum arquivo foi criado.
      </p>}
    </div>
  );
}
