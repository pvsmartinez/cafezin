declare module 'mammoth' {
  interface ConvertResult {
    value: string;
    messages: Array<{ type: string; message: string; paragraph?: unknown }>;
  }

  interface ConvertInput {
    arrayBuffer?: ArrayBuffer;
    buffer?: Buffer;
    path?: string;
  }

  interface ConvertOptions {
    outputFormat?: 'html' | 'markdown';
    styleMap?: string | string[];
    includeDefaultStyleMap?: boolean;
    convertImage?: unknown;
    ignoreEmptyParagraphs?: boolean;
    idPrefix?: string;
  }

  function convertToHtml(input: ConvertInput, options?: ConvertOptions): Promise<ConvertResult>;
  function convertToMarkdown(input: ConvertInput, options?: ConvertOptions): Promise<ConvertResult>;
  function extractRawText(input: ConvertInput): Promise<ConvertResult>;
}
