/** Writing formats and read-only research attachments supported by Cafezin. */
export type FileKind = 'markdown' | 'pdf' | 'video' | 'audio' | 'image' | 'unsupported';

export interface FileTypeInfo {
  kind: FileKind;
  supportsPreview: boolean;
  defaultMode: 'edit' | 'preview';
  /** Kept for Markdown consumers; Cafezin is not a source-code editor. */
  language: string;
}

export function getFileTypeInfo(filename: string): FileTypeInfo {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (['md', 'mdx', 'markdown', 'txt'].includes(ext)) {
    return {
      kind: 'markdown', supportsPreview: ext !== 'txt', defaultMode: 'edit', language: 'markdown',
    };
  }
  let kind: FileKind = 'unsupported';
  if (ext === 'pdf') kind = 'pdf';
  else if (['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv', 'avi'].includes(ext)) kind = 'video';
  else if (['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'opus', 'weba', 'wma'].includes(ext)) {
    kind = 'audio';
  } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff', 'tif'].includes(ext)) {
    kind = 'image';
  }
  // Binary, Office, canvas and development files are never loaded into an editable
  // buffer. They remain visible on disk without risking accidental text overwrites.
  return { kind, supportsPreview: false, defaultMode: kind === 'unsupported' ? 'edit' : 'preview', language: '' };
}
