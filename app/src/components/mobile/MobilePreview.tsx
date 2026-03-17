import { useState, useEffect } from 'react';
import { readTextFile, readFile } from '../../services/fs';
import { convertFileSrc } from '@tauri-apps/api/core';
import { CaretLeft, SpeakerSimpleHigh } from '@phosphor-icons/react';
import { getFileTypeInfo } from '../../utils/fileType';
import { loadSlidePreviews } from '../../utils/slidePreviews';
import MarkdownPreview from '../MarkdownPreview';
import type { WorkspaceFeatureConfig } from '../../types';

interface MobilePreviewProps {
  /** Absolute workspace path */
  workspacePath: string;
  /** Relative file path within workspace */
  filePath: string;
  /** Optional per-workspace render capabilities. */
  features?: WorkspaceFeatureConfig;
  onClear: () => void;
}

// ── Canvas slide viewer ───────────────────────────────────────────────────

function SlideViewer({ workspacePath, filePath }: { workspacePath: string; filePath: string }) {
  const [urls, setUrls] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setIdx(0);
    loadSlidePreviews(workspacePath, filePath).then(u => {
      setUrls(u);
      setLoading(false);
    });
  }, [workspacePath, filePath]);

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-[#0d0f11]">
        <div className="spinner" />
      </div>
    );
  }

  if (urls.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-[#0d0f11]">
        <div className="flex flex-col items-center justify-center gap-4 px-6 py-8 text-center">
          <div className="text-sm text-muted max-w-[280px] leading-[1.5]">
            Sem slides gerados. Abra este canvas no desktop para gerar as imagens.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col items-center justify-center bg-[#0d0f11] relative">
      <img
        key={urls[idx]}
        src={urls[idx]}
        alt={`Slide ${idx + 1}`}
        className="w-full max-h-[calc(100%-60px)] object-contain"
      />
      <div className="absolute bottom-0 inset-x-0 flex items-center justify-center gap-4 px-4 py-3 bg-black/40">
        <button
          className="bg-white/[0.12] border-0 rounded-lg text-white text-lg w-10 h-10 flex items-center justify-center cursor-pointer disabled:opacity-30 active:opacity-50"
          disabled={idx === 0}
          onClick={() => setIdx(i => i - 1)}
        >‹</button>
        <span className="text-[13px] text-white/60 min-w-[60px] text-center">{idx + 1} / {urls.length}</span>
        <button
          className="bg-white/[0.12] border-0 rounded-lg text-white text-lg w-10 h-10 flex items-center justify-center cursor-pointer disabled:opacity-30 active:opacity-50"
          disabled={idx === urls.length - 1}
          onClick={() => setIdx(i => i + 1)}
        >›</button>
      </div>
    </div>
  );
}

// ── HTML / webpage viewer ────────────────────────────────────────────────

function HtmlViewer({ absPath }: { absPath: string }) {
  const src = convertFileSrc(absPath);
  return (
    <iframe
      src={src}
      title="webpage preview"
      className="w-full flex-1 border-0 block min-h-0"
      sandbox="allow-scripts allow-same-origin"
    />
  );
}

// ── Markdown viewer ──────────────────────────────────────────────────────

function MarkdownViewer({ absPath, features }: { absPath: string; features?: WorkspaceFeatureConfig }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    readTextFile(absPath)
      .then(text => { setContent(text); setLoading(false); })
      .catch(() => { setContent('*Error reading file.*'); setLoading(false); });
  }, [absPath]);

  if (loading) {
    return <div className="flex justify-center p-8"><div className="spinner" /></div>;
  }

  return (
    <div className="px-5 pt-5 pb-10">
      <MarkdownPreview content={content} features={features} />
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

// ── Text / code viewer ────────────────────────────────────────────────────

function TextViewer({ absPath }: { absPath: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    readTextFile(absPath)
      .then(t => setText(t))
      .catch(() => setText('(Could not read file)'));
  }, [absPath]);

  if (text === null) return <div className="flex justify-center p-8"><div className="spinner" /></div>;
  return <pre className="m-0 px-[18px] py-4 pb-10 text-xs font-mono text-app-text whitespace-pre-wrap break-all leading-[1.6] overflow-wrap-anywhere">{text}</pre>;
}

// ── Main preview ──────────────────────────────────────────────────────────

export default function MobilePreview({ workspacePath, filePath, features, onClear }: MobilePreviewProps) {
  const absPath = `${workspacePath}/${filePath}`;
  const filename = filePath.split('/').pop() ?? filePath;
  const { kind } = getFileTypeInfo(filename);

  function renderBody() {
    switch (kind) {
      case 'canvas':
        return <SlideViewer workspacePath={workspacePath} filePath={filePath} />;
      case 'html':
        return <HtmlViewer absPath={absPath} />;
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
      case 'code':
        return <TextViewer absPath={absPath} />;
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

      <div className={`flex-1 overflow-y-auto scroll-touch${kind === 'html' ? ' overflow-hidden flex flex-col' : ''}`}>
        {renderBody()}
      </div>
    </>
  );
}
