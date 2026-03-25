/**
 * PDF text extraction using pdfjs-dist.
 * Accepts raw bytes (Uint8Array) and returns extracted text, one section per page.
 */
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

let workerInitialized = false;

function ensureWorker() {
  if (!workerInitialized) {
    GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).href;
    workerInitialized = true;
  }
}

/** Maximum characters returned from a PDF to avoid flooding the AI context. */
const PDF_CHAR_CAP = 80_000;

export async function extractPdfText(data: Uint8Array): Promise<string> {
  ensureWorker();

  const pdf = await getDocument({ data }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .filter((item): item is TextItem => 'str' in item)
      .map((item) => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (pageText) {
      pages.push(`--- Page ${i} of ${pdf.numPages} ---\n${pageText}`);
    }
  }

  const full = pages.join('\n\n');
  if (full.length > PDF_CHAR_CAP) {
    return `${full.slice(0, PDF_CHAR_CAP)}\n\n[… truncated — PDF text exceeded ${PDF_CHAR_CAP} chars. Only the first portion is shown.]`;
  }
  return full || '[No extractable text found — this PDF may be scanned or image-only.]';
}
