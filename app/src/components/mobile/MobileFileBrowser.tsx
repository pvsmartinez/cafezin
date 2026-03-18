import { useState } from 'react';
import {
  FolderSimple, GlobeSimple, FileText, PaintBrush, FilePdf,
  Image, FilmStrip, SpeakerSimpleHigh, FileCode, Paperclip, House,
} from '@phosphor-icons/react';
import type { FileTreeNode } from '../../types';
import { getFileTypeInfo } from '../../utils/fileType';

// File kinds that can be previewed on mobile
const PREVIEWABLE_KINDS = new Set(['markdown', 'pdf', 'image', 'video', 'canvas', 'html', 'code']);

function FileIcon({ name, isDir }: { name: string; isDir: boolean }) {
  const sz = 16;
  const w = 'thin' as const;
  if (isDir) return <FolderSimple weight={w} size={sz} />;
  const info = getFileTypeInfo(name);
  switch (info.kind) {
    case 'markdown': return <FileText    weight={w} size={sz} />;
    case 'canvas':   return <PaintBrush  weight={w} size={sz} />;
    case 'pdf':      return <FilePdf     weight={w} size={sz} />;
    case 'image':    return <Image       weight={w} size={sz} />;
    case 'video':    return <FilmStrip   weight={w} size={sz} />;
    case 'audio':    return <SpeakerSimpleHigh weight={w} size={sz} />;
    case 'html':     return <GlobeSimple weight={w} size={sz} />;
    case 'code':     return <FileCode    weight={w} size={sz} />;
    default:         return <Paperclip   weight={w} size={sz} />;
  }
}

function isPreviewable(name: string): boolean {
  return PREVIEWABLE_KINDS.has(getFileTypeInfo(name).kind);
}

interface TreeNodeProps {
  node: FileTreeNode;
  depth: number;
  selectedPath?: string;
  onSelect: (path: string) => void;
}

function TreeNode({ node, depth, selectedPath, onSelect }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2);

  const nodeBase = 'mb-tap flex items-center gap-1.5 py-[9px] cursor-pointer transition-colors duration-100';

  if (node.isDirectory) {
    // Folder that contains an index.html → treat as a renderable webpage
    const webpageChild = node.children?.find(c => c.name === 'index.html');
    if (webpageChild) {
      const selected = webpageChild.path === selectedPath;
      return (
        <div
          className={`${nodeBase} ${selected ? 'bg-[rgba(var(--accent-rgb),0.12)]' : ''}`}
          style={{ paddingLeft: `${16 + depth * 18}px`, paddingRight: 16 }}
          onClick={() => onSelect(webpageChild.path)}
        >
          <span className="w-3.5 shrink-0" />
          <span className="text-base shrink-0"><GlobeSimple weight="thin" size={16} /></span>
          <span className="flex-1 text-sm leading-[1.3] truncate text-app-text">{node.name}</span>
          <span className="text-[10px] text-muted shrink-0 tracking-[0.3px] uppercase">webpage</span>
        </div>
      );
    }

    return (
      <>
        <div
          className={`${nodeBase}`}
          style={{ paddingLeft: `${16 + depth * 18}px`, paddingRight: 16 }}
          onClick={() => setExpanded(v => !v)}
        >
          <span className="text-[11px] text-muted w-3.5 shrink-0 flex items-center justify-center">
            {expanded ? '▾' : '▸'}
          </span>
          <span className="text-base shrink-0"><FolderSimple weight="thin" size={16} /></span>
          <span className="flex-1 text-sm leading-[1.3] truncate font-medium text-app-text">{node.name}</span>
        </div>
        {expanded && node.children?.map(child => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
      </>
    );
  }

  const previewa = isPreviewable(node.name);
  const selected = node.path === selectedPath;

  return (
    <div
      className={`${nodeBase} ${selected ? 'bg-[rgba(var(--accent-rgb),0.12)]' : ''} ${!previewa ? 'cursor-default' : ''}`}
      style={{ paddingLeft: `${16 + depth * 18 + 14}px`, paddingRight: 16 }}
      onClick={() => previewa && onSelect(node.path)}
    >
      <span className="text-base shrink-0"><FileIcon name={node.name} isDir={false} /></span>
      <span className={`flex-1 text-sm leading-[1.3] truncate ${previewa ? 'text-app-text' : 'text-muted'}`}>
        {node.name}
      </span>
    </div>
  );
}

interface MobileFileBrowserProps {
  fileTree: FileTreeNode[];
  selectedPath?: string;
  onFileSelect: (path: string) => void;
  /** Called when the user taps the back / home button in the empty state. */
  onBack?: () => void;
}

export default function MobileFileBrowser({
  fileTree,
  selectedPath,
  onFileSelect,
  onBack,
}: MobileFileBrowserProps) {
  return (
    <>
      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="py-1 pb-6">
          {fileTree.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 px-6 py-12 text-center">
              <div className="opacity-40 text-muted"><FolderSimple weight="thin" size={48} /></div>
              <div className="text-sm text-muted max-w-[280px] leading-[1.5]">
                Nenhum arquivo encontrado. O repositório pode não estar sincronizado neste dispositivo.
              </div>
              {onBack && (
                <button
                  className="btn-secondary mt-2 text-sm gap-2"
                  onClick={onBack}
                >
                  <House weight="thin" size={16} /> Voltar e sincronizar
                </button>
              )}
            </div>
          ) : (
            fileTree.map(node => (
              <TreeNode
                key={node.path}
                node={node}
                depth={0}
                selectedPath={selectedPath}
                onSelect={onFileSelect}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}

