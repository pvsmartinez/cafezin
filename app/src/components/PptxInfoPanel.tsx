import { useEffect, useState } from 'react';
import JSZip from 'jszip';
import { readFile as tauriReadFile, writeTextFile, exists } from '../services/fs';
import './PptxInfoPanel.css';

const DRAW_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PRES_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';

interface PptxSlide {
  title: string;
  body: string;
}

function parsePptxSlideXml(xmlStr: string): PptxSlide {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlStr, 'application/xml');

  const shapes = doc.getElementsByTagNameNS(PRES_NS, 'sp');
  let title = '';
  const bodyParts: string[] = [];

  for (const sp of Array.from(shapes)) {
    const phEls = sp.getElementsByTagNameNS(PRES_NS, 'ph');
    const phType = phEls[0]?.getAttribute('type') ?? '';
    const isTitle = phType === 'title' || phType === 'ctrTitle';

    // Collect all <a:t> text nodes, preserving paragraph breaks via <a:p>
    const paragraphs = sp.getElementsByTagNameNS(DRAW_NS, 'p');
    const paraTexts: string[] = [];
    for (const para of Array.from(paragraphs)) {
      const runs = para.getElementsByTagNameNS(DRAW_NS, 't');
      const lineText = Array.from(runs).map((r) => r.textContent ?? '').join('');
      if (lineText.trim()) paraTexts.push(lineText);
    }
    const text = paraTexts.join('\n').trim();
    if (!text) continue;

    if (isTitle) {
      title = text;
    } else {
      bodyParts.push(text);
    }
  }

  return { title, body: bodyParts.join('\n\n').trim() };
}

interface PptxInfoPanelProps {
  absPath: string;
  filename: string;
  workspacePath: string;
  onOpenFile?: (relPath: string) => void;
}

export default function PptxInfoPanel({
  absPath,
  filename,
  workspacePath,
  onOpenFile,
}: PptxInfoPanelProps) {
  const [slides, setSlides] = useState<PptxSlide[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Auto-parse on mount to show a slide preview
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const bytes = await tauriReadFile(absPath);
        const zip = await JSZip.loadAsync(bytes);

        const slideEntries = Object.keys(zip.files)
          .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
          .sort((a, b) => {
            const na = parseInt(a.match(/\d+/)?.[0] ?? '0');
            const nb = parseInt(b.match(/\d+/)?.[0] ?? '0');
            return na - nb;
          });

        const parsed: PptxSlide[] = [];
        for (const entry of slideEntries) {
          const xml = await zip.files[entry].async('string');
          parsed.push(parsePptxSlideXml(xml));
        }

        if (!cancelled) setSlides(parsed);
      } catch (err) {
        if (!cancelled) setError(`Não foi possível ler o arquivo: ${String(err)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [absPath]);

  async function handleImport() {
    if (!slides || slides.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      // Derive output filename — place beside the .pptx file
      const canvasRelPath = filename.replace(/\.pptx?$/i, '.tldr.json');
      const canvasAbsPath = `${workspacePath}/${canvasRelPath}`;

      const alreadyExists = await exists(canvasAbsPath);
      const finalRelPath = alreadyExists
        ? canvasRelPath.replace(/\.tldr\.json$/, '_imported.tldr.json')
        : canvasRelPath;

      // Write a proper tldraw snapshot that embeds slide data in document meta.
      // CanvasEditor.handleMount detects meta.pptxImport and creates the shapes
      // via the live editor API (using toRichText, createShapeId, etc.).
      const snapshot = {
        document: {
          store: {
            'document:document': {
              id: 'document:document',
              typeName: 'document',
              gridSize: 10,
              name: '',
              meta: {
                slideLocked: true,
                pptxImport: { slides },
              },
            },
            'page:page': {
              id: 'page:page',
              typeName: 'page',
              name: 'Page 1',
              index: 'a1',
              meta: {},
            },
          },
          schema: { schemaVersion: 2, sequences: {} },
        },
        session: {},
      };

      await writeTextFile(`${workspacePath}/${finalRelPath}`, JSON.stringify(snapshot));
      setDone(finalRelPath);
      if (onOpenFile) onOpenFile(finalRelPath);
    } catch (err) {
      setError(`Falha ao importar: ${String(err)}`);
    } finally {
      setImporting(false);
    }
  }

  const slideCount = slides?.length ?? 0;

  return (
    <div className="pptx-panel">
      <div className="pptx-panel-inner">
        <div className="pptx-icon">📊</div>
        <h2 className="pptx-title">Apresentação PowerPoint (.pptx)</h2>
        <p className="pptx-desc">
          Arquivos <code>.pptx</code> não podem ser editados diretamente no Cafezin.
          Você pode importar o conteúdo como um Canvas — cada slide vira um frame editável.
        </p>

        <div className="pptx-info-grid">
          <div className="pptx-info-col pptx-info-col--keep">
            <h3>O que é preservado</h3>
            <ul>
              <li>Títulos de cada slide</li>
              <li>Texto do corpo (bullet points, parágrafos)</li>
              <li>Ordem dos slides</li>
              <li>Estrutura título + corpo por slide</li>
            </ul>
          </div>
          <div className="pptx-info-col pptx-info-col--lose">
            <h3>O que é perdido</h3>
            <ul>
              <li>Imagens e formas</li>
              <li>Cores e fontes personalizadas</li>
              <li>Animações e transições</li>
              <li>Gráficos e tabelas</li>
            </ul>
          </div>
        </div>

        {loading && (
          <div className="pptx-loading">Lendo apresentação…</div>
        )}

        {!loading && error && (
          <div className="pptx-error">{error}</div>
        )}

        {!loading && slides && slideCount === 0 && (
          <div className="pptx-loading">Nenhum slide encontrado nesta apresentação.</div>
        )}

        {!loading && slides && slideCount > 0 && (
          <>
            <div className="pptx-slides-header">
              <span>{slideCount} slide{slideCount !== 1 ? 's' : ''} encontrado{slideCount !== 1 ? 's' : ''}</span>
            </div>
            <div className="pptx-slides-list">
              {slides.slice(0, 8).map((slide, i) => (
                <div key={i} className="pptx-slide-item">
                  <span className="pptx-slide-num">{i + 1}</span>
                  <div className="pptx-slide-text">
                    <span className="pptx-slide-title">{slide.title || '(sem título)'}</span>
                    {slide.body && (
                      <span className="pptx-slide-body">
                        {slide.body.slice(0, 80)}{slide.body.length > 80 ? '…' : ''}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {slideCount > 8 && (
                <div className="pptx-more">+ {slideCount - 8} slide{slideCount - 8 !== 1 ? 's' : ''} mais</div>
              )}
            </div>

            {done ? (
              <div className="pptx-done">
                Canvas criado: <strong>{done}</strong>
              </div>
            ) : (
              <button
                className="pptx-btn"
                onClick={handleImport}
                disabled={importing}
              >
                {importing ? 'Importando…' : '🖼 Importar como Canvas'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
