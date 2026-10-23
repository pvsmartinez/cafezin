import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { readTextFile, readFile, writeTextFile } from '../../services/fs';
import { convertFileSrc } from '@tauri-apps/api/core';
import { CaretLeft, SpeakerSimpleHigh, Pen, Eye } from '@phosphor-icons/react';
import { getFileTypeInfo } from '../../utils/fileType';
import type { WorkspaceFeatureConfig } from '../../types';

const MarkdownPreview = lazy(() => import('../MarkdownPreview'));

interface MobilePreviewProps {
  /** Absolute workspace path */
  workspacePath: string;
  /** Relative file path within workspace */
  filePath: string;
  /** Optional per-workspace render capabilities. */
  features?: WorkspaceFeatureConfig;
  onClear: () => void;
}

// ── HTML / webpage viewer ────────────────────────────────────────────────


// ── Markdown viewer (editable) ───────────────────────────────────────────

function MarkdownViewer({ absPath, features }: { absPath: string; features?: WorkspaceFeatureConfig }) {
  return <EditableTextViewer absPath={absPath} features={features} mode="markdown" />;
}

// ── Editable text viewer (markdown + code) ───────────────────────────────

/**
 * Mobile manual editing: preview-first with an Editar/Visualizar toggle and
 * debounced autosave (writes straight back to the workspace file through the
 * platform fs wrapper). No editor library — a plain textarea keeps the mobile
 * bundle small; markdown rendering reuses the desktop MarkdownPreview.
 */
function EditableTextViewer({
  absPath,
  features,
  mode,
}: {
  absPath: string;
  features?: WorkspaceFeatureConfig;
  mode: 'markdown' | 'code';
}) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const savedRef = useRef(content);

  useEffect(() => {
    setLoading(true);
    readTextFile(absPath)
      .then(text => { setContent(text); savedRef.current = text; setLoading(false); })
      .catch(() => { setContent('*Error reading file.*'); setLoading(false); });
  }, [absPath]);

  // Debounced autosave while editing
  useEffect(() => {
    if (!editing) return;
    if (draft === savedRef.current) { setSaveState('saved'); return; }
    setSaveState('dirty');
    const t = setTimeout(() => {
      setSaveState('saving');
      writeTextFile(absPath, draft)
        .then(() => { savedRef.current = draft; setSaveState('saved'); })
        .catch(() => setSaveState('error'));
    }, 800);
    return () => clearTimeout(t);
  }, [draft, editing, absPath]);

  const startEditing = useCallback(() => {
    setDraft(savedRef.current);
    setEditing(true);
  }, []);

  const stopEditing = useCallback(() => {
    // Flush pending save immediately
    writeTextFile(absPath, draft)
      .then(() => { savedRef.current = draft; setContent(draft); })
      .catch(() => setSaveState('error'));
    setEditing(false);
  }, [draft, absPath]);

  if (loading) {
    return <div className="flex justify-center p-8"><div className="spinner" /></div>;
  }

  if (editing) {
    const showSave = saveState === 'saving' || saveState === 'error';
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-4 pt-3 pb-2 border-b border-app-border bg-surface">
          <button
            className="mb-edit-toggle"
            onClick={stopEditing}
            title="Visualizar"
          >
            <Eye weight="bold" size={15} /> Visualizar
          </button>
          <span className={`ml-auto text-[12px] ${saveState === 'error' ? 'text-[#dc2626]' : 'text-muted'}`}>
            {saveState === 'error' ? 'Falha ao salvar' : showSave ? 'Salvando…' : 'Salvo ✓'}
          </span>
        </div>
        <textarea
          className="mb-edit-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          spellCheck={false}
          placeholder={mode === 'markdown' ? 'Escreva em Markdown…' : 'Escreva o código…'}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-end px-4 pt-3">
        <button className="mb-edit-toggle" onClick={startEditing} title="Editar arquivo">
          <Pen weight="bold" size={15} /> Editar
        </button>
      </div>
      <div className="px-5 pt-1 pb-10 overflow-y-auto">
        {mode === 'markdown' ? (
          <Suspense fallback={<div className="flex justify-center p-8"><div className="spinner" /></div>}>
            <MarkdownPreview content={content} features={features} />
          </Suspense>
        ) : (
          <pre className="m-0 text-xs font-mono text-app-text whitespace-pre-wrap break-all leading-[1.6] overflow-wrap-anywhere">{content}</pre>
        )}
      </div>
    </div>
  );
}

// ── Image viewer ─────────────────────────────────────────────────────────

function ImageViewer({ absPath }: { absPath: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    // Use asset:// protocol — works with assetProtocol enabled in tauri.conf.json
    setSrc(convertFileSrc(absPath));
  }, [absPath]);

  if (!src) return null;
  return (
    <div className="flex items-start justify-center p-4 min-h-[200px]">
      <img src={src} alt="" className="max-w-full h-auto rounded-lg" />
    </div>
  );
}

// ── Video viewer ─────────────────────────────────────────────────────────

function VideoViewer({ absPath }: { absPath: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    // Read into Blob to avoid CORS / asset-protocol issues with video seeking
    readFile(absPath).then(bytes => {
      const blob = new Blob([bytes]);
      url = URL.createObjectURL(blob);
      setSrc(url);
    }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [absPath]);

  if (!src) return <div className="flex justify-center p-8"><div className="spinner" /></div>;
  return (
    <div className="p-3">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video src={src} controls className="w-full rounded-lg" />
    </div>
  );
}

// ── Audio player ────────────────────────────────────────────────────────

function AudioViewer({ absPath }: { absPath: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    readFile(absPath).then(bytes => {
      const ext = absPath.split('.').pop()?.toLowerCase() ?? '';
      const mimeMap: Record<string, string> = {
        webm: 'audio/webm', ogg: 'audio/ogg',
        m4a: 'audio/mp4',  mp4: 'audio/mp4',
        mp3: 'audio/mpeg', wav: 'audio/wav',
        aac: 'audio/aac',  opus: 'audio/ogg',
      };
      const mime = mimeMap[ext] ?? 'audio/webm';
      const blob = new Blob([bytes], { type: mime });
      url = URL.createObjectURL(blob);
      setSrc(url);
    }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [absPath]);

  if (!src) {
    return (
      <div className="flex justify-center p-8">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10">
      <div className="opacity-50 text-muted"><SpeakerSimpleHigh weight="thin" size={56} /></div>
      <div className="text-[13px] text-muted text-center break-all">{absPath.split('/').pop()}</div>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio controls src={src} className="w-full max-w-[360px] rounded-lg" />
    </div>
  );
}

// ── PDF viewer ───────────────────────────────────────────────────────────

function PDFViewer({ absPath }: { absPath: string }) {
  const src = convertFileSrc(absPath);
  return (
    <embed src={src} type="application/pdf" className="w-full h-full border-0" />
  );
}

// ── Text / code viewer (editable) ────────────────────────────────────────


// ── Main preview ──────────────────────────────────────────────────────────

export default function MobilePreview({ workspacePath, filePath, features, onClear }: MobilePreviewProps) {
  const absPath = `${workspacePath}/${filePath}`;
  const filename = filePath.split('/').pop() ?? filePath;
  const { kind } = getFileTypeInfo(filename);

  function renderBody() {
    switch (kind) {
      case 'markdown':
        return <MarkdownViewer absPath={absPath} features={features} />;
      case 'image':
        return <ImageViewer absPath={absPath} />;
      case 'video':
        return <VideoViewer absPath={absPath} />;
      case 'audio':
        return <AudioViewer absPath={absPath} />;
      case 'pdf':
        return <PDFViewer absPath={absPath} />;
      default:
        return (
          <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="text-sm text-muted max-w-[280px] leading-[1.5]">Sem preview disponível para este tipo de arquivo.</div>
          </div>
        );
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-3 pb-[10px] border-b border-app-border bg-surface shrink-0">
        <button className="icon-btn" onClick={onClear} title="Voltar">
          <CaretLeft weight="bold" size={18} />
        </button>
        <span className="flex-1 text-[17px] font-semibold truncate">
          {filename === 'index.html' ? (filePath.split('/').slice(-2)[0] ?? filename) : filename}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto scroll-touch">
        {renderBody()}
      </div>
    </>
  );
}
