import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      setError(t('docxPanel.exportFailed', { error: String(err) }));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="docx-panel">
      <div className="docx-panel-inner">
        <div className="docx-icon">📄</div>
        <h2 className="docx-title">{t('docxPanel.title')}</h2>
        <p className="docx-desc">
          {t('docxPanel.descPrefix')} <code>.docx</code> {t('docxPanel.descSuffix')}
        </p>

        <div className="docx-info-grid">
          <div className="docx-info-col docx-info-col--keep">
            <h3>{t('docxPanel.keepTitle')}</h3>
            <ul>
              <li>{t('docxPanel.keepItem1')}</li>
              <li>{t('docxPanel.keepItem2')}</li>
              <li>{t('docxPanel.keepItem3')}</li>
              <li>{t('docxPanel.keepItem4')}</li>
              <li>{t('docxPanel.keepItem5')}</li>
              <li>{t('docxPanel.keepItem6')}</li>
            </ul>
          </div>
          <div className="docx-info-col docx-info-col--lose">
            <h3>{t('docxPanel.loseTitle')}</h3>
            <ul>
              <li>{t('docxPanel.loseItem1')}</li>
              <li>{t('docxPanel.loseItem2')}</li>
              <li>{t('docxPanel.loseItem3')}</li>
              <li>{t('docxPanel.loseItem4')}</li>
              <li>{t('docxPanel.loseItem5')}</li>
              <li>{t('docxPanel.loseItem6')}</li>
            </ul>
          </div>
        </div>

        <div className="docx-actions">
          {exportDone ? (
            <div className="docx-success">
              ✓ {t('docxPanel.exportedAs')} <strong>{exportDone}</strong> {t('docxPanel.opening')}
            </div>
          ) : (
            <button
              className="docx-btn"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? t('docxPanel.exporting') : t('docxPanel.exportButton')}
            </button>
          )}
          {error && <p className="docx-error">{error}</p>}
        </div>

        <p className="docx-note">
          {t('docxPanel.notePrefix')} <code>.docx</code> {t('docxPanel.noteSuffix')}
        </p>
      </div>
    </div>
  );
}
