import { useEffect, useState } from 'react';
import { readTextFile, writeTextFile, exists } from '../services/fs';
import { rtfToText } from '../utils/rtfToText';
import './RtfViewer.css';

interface RtfViewerProps {
  absPath: string;
  filename: string;
  workspacePath: string;
  onStat?: (stat: string) => void;
  onOpenFile?: (relPath: string) => void;
}

export default function RtfViewer({
  absPath,
  filename,
  workspacePath,
  onStat,
  onOpenFile,
}: RtfViewerProps) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState<string | null>(null);

  useEffect(() => {
    setText(null);
    setError(null);
    setExportDone(null);
    readTextFile(absPath)
      .then((raw) => {
        const plain = rtfToText(raw);
        setText(plain);
        if (onStat) {
          const words = plain.trim().split(/\s+/).filter(Boolean).length;
          onStat(`${words.toLocaleString()} words`);
        }
      })
      .catch((err) => {
        setError(String(err));
      });
  }, [absPath]);

  async function handleExport() {
    if (!text) return;
    setExporting(true);
    try {
      const mdRelPath = filename.replace(/\.rtf$/i, '.md');
      const mdAbsPath = `${workspacePath}/${mdRelPath}`;

      const alreadyExists = await exists(mdAbsPath);
      let finalRelPath = mdRelPath;

      if (alreadyExists) {
        // Append _converted to avoid overwriting
        const base = mdRelPath.replace(/\.md$/, '');
        finalRelPath = `${base}_converted.md`;
        const finalAbsPath = `${workspacePath}/${finalRelPath}`;
        await writeTextFile(finalAbsPath, text);
      } else {
        await writeTextFile(mdAbsPath, text);
      }

      setExportDone(finalRelPath);
      if (onOpenFile) onOpenFile(finalRelPath);
    } catch (err) {
      setError(`Export failed: ${String(err)}`);
    } finally {
      setExporting(false);
    }
  }

  if (error) {
    return (
      <div className="rtf-viewer rtf-viewer--error">
        <span>Erro ao ler o arquivo: {error}</span>
      </div>
    );
  }

  if (text === null) {
    return (
      <div className="rtf-viewer rtf-viewer--loading">
        <span>Lendo arquivo…</span>
      </div>
    );
  }

  return (
    <div className="rtf-viewer">
      <div className="rtf-toolbar">
        <span className="rtf-toolbar-label">RTF — texto extraído</span>
        <div className="rtf-toolbar-actions">
          {exportDone ? (
            <span className="rtf-badge rtf-badge--ok">Exportado como {exportDone}</span>
          ) : (
            <button
              className="rtf-btn"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? 'Exportando…' : 'Exportar como Markdown'}
            </button>
          )}
        </div>
      </div>
      <div className="rtf-content">
        <pre className="rtf-text">{text}</pre>
      </div>
    </div>
  );
}
