import { describe, expect, it } from 'vitest';
import { getFileTypeInfo } from '../utils/fileType';

describe('writing file types', () => {
  it.each(['capitulo.md', 'notes.mdx', 'report.markdown', 'BOOK.MD', 'folder/book.v2.md'])(
    'edits %s as Markdown', (name) => {
      expect(getFileTypeInfo(name)).toEqual({
        kind: 'markdown', language: 'markdown', supportsPreview: true, defaultMode: 'edit',
      });
    },
  );

  it('keeps plain text editable without pretending it needs a Markdown preview', () => {
    expect(getFileTypeInfo('notes.txt')).toEqual({
      kind: 'markdown', language: 'markdown', supportsPreview: false, defaultMode: 'edit',
    });
  });

  it.each([
    ['research.pdf', 'pdf'], ['photo.png', 'image'], ['diagram.svg', 'image'],
    ['photo.JPG', 'image'], ['memo.m4a', 'audio'], ['interview.mp3', 'audio'],
    ['reference.mp4', 'video'],
  ])('opens %s as a read-only research attachment', (name, kind) => {
    expect(getFileTypeInfo(name)).toMatchObject({ kind, defaultMode: 'preview', language: '' });
  });

  it.each([
    'slides.tldr.json', 'slides.TLDR.JSON', 'presentation.pptx', 'slides.ppt',
    'data.xlsx', 'data.csv', 'data.tsv', 'data.ods', 'notes.rtf', 'draft.docx',
    'draft.doc', 'app.tsx', 'index.html', 'style.css', 'package.json', 'script.sh',
    'unknown.bin', 'archive.zip', 'README', 'hidden.exe',
  ])('does not open %s as editable text', (name) => {
    expect(getFileTypeInfo(name)).toEqual({
      kind: 'unsupported', supportsPreview: false, defaultMode: 'edit', language: '',
    });
  });
});
