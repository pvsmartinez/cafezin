import { useState } from 'react';
import { readFile as tauriReadFile } from '../services/fs';
import { writeTextFile, exists } from '../services/fs';
import './DocxInfoPanel.css';

interface DocxInfoPanelProps {
  absPath: string;
  filename: string;
  workspacePath: string;
  onOpenFile?: (relPath: string) => void;
}

export default function DocxInfoPanel({
  absPath,
  filename,
  workspacePath,
  onOpenFile,
}: DocxInfoPanelProps) {
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const mammoth = await import('mammoth');
      const bytes = await tauriReadFile(absPath);
      const buffer = bytes.buffer as ArrayBuffer;

      const result = await mammoth.convertToMarkdown({ arrayBuffer: buffer });

      const mdRelPath = filename.replace(/\.docx?$/i, '.md');
      const mdAbsPath = `${workspacePath}/${mdRelPath}`;

      const alreadyExists = await exists(mdAbsPath);
      let finalRelPath = mdRelPath;

      if (alreadyExists) {
        const base = mdRelPath.replace(/\.md$/, '');
        finalRelPath = `${base}_converted.md`;
      }

      await writeTextFile(`${workspacePath}/${finalRelPath}`, result.value);
      setExportDone(finalRelPath);
      if (onOpenFile) onOpenFile(finalRelPath);
    } catch (err) {
      setError(`Falha ao exportar: ${String(err)}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="docx-panel">
      <div className="docx-panel-inner">
        <div className="docx-icon">📄</div>
        <h2 className="docx-title">Arquivo Word (.docx)</h2>
        <p className="docx-desc">
          Arquivos <code>.docx</code> não podem ser editados diretamente no Cafezin.
          Mas você pode exportar o conteúdo como Markdown e trabalhar normalmente.
        </p>

        <div className="docx-info-grid">
          <div className="docx-info-col docx-info-col--keep">
            <h3>O que é preservado</h3>
            <ul>
              <li>Títulos (H1, H2, H3…)</li>
              <li>Negrito e itálico</li>
              <li>Listas com marcadores e numeradas</li>
              <li>Parágrafos e quebras de linha</li>
              <li>Links com URL</li>
              <li>Blocos de código inline</li>
            </ul>
          </div>
          <div className="docx-info-col docx-info-col--lose">
            <h3>O que é perdido</h3>
            <ul>
              <li>Imagens e figuras</li>
              <li>Tabelas (estrutura simplificada)</li>
              <li>Comentários e revisões</li>
              <li>Cabeçalhos e rodapés</li>
              <li>Formatação de página (margens, colunas)</li>
              <li>Estilos personalizados de fonte/cor</li>
            </ul>
          </div>
        </div>

        <div className="docx-actions">
          {exportDone ? (
            <div className="docx-success">
              ✓ Exportado como <strong>{exportDone}</strong> — abrindo…
            </div>
          ) : (
            <button
              className="docx-btn"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? 'Exportando…' : 'Exportar como Markdown'}
            </button>
          )}
          {error && <p className="docx-error">{error}</p>}
        </div>

        <p className="docx-note">
          O arquivo <code>.docx</code> original não é modificado.
        </p>
      </div>
    </div>
  );
}
