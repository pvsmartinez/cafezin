let katexCssPromise: Promise<unknown> | null = null;

export function ensureKatexCss(): Promise<void> {
  if (!katexCssPromise) {
    katexCssPromise = import('katex/dist/katex.min.css');
  }

  return katexCssPromise.then(() => undefined);
}