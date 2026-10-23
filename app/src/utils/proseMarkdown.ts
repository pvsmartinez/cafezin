/**
 * Post-processing for markdown serialized by the Prose (Tiptap) editor.
 *
 * Tiptap has no task-list extension enabled, so `- [x] item` is parsed as a
 * plain list item whose text starts with `[x]`, and the serializer escapes the
 * brackets. Restoring them keeps GFM task lists intact across Prose edits.
 */
export function restoreProseTaskMarkers(markdown: string): string {
  return markdown.replace(/^(\s*(?:[-*+]|\d+[.)]) )\\\[([ xX])\\\]/gm, '$1[$2]');
}
