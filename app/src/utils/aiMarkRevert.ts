import type { AITextRevert } from '../types';

function countOccurrences(text: string, search: string): number {
  if (!search) return 0;
  let count = 0;
  let cursor = 0;
  while (true) {
    const idx = text.indexOf(search, cursor);
    if (idx === -1) return count;
    count += 1;
    cursor = idx + search.length;
  }
}

function replaceUnique(text: string, search: string, replace: string): string | null {
  if (!search) return null;
  if (countOccurrences(text, search) !== 1) return null;
  return text.replace(search, replace);
}

export function applyTextMarkRevert(content: string, revert: AITextRevert): string | null {
  const beforeText = revert.beforeText;
  const afterText = revert.afterText;
  const contextBefore = revert.contextBefore ?? '';
  const contextAfter = revert.contextAfter ?? '';

  if (!afterText) return null;

  if (contextBefore || contextAfter) {
    const exactNeedle = `${contextBefore}${afterText}${contextAfter}`;
    const exactReplacement = `${contextBefore}${beforeText}${contextAfter}`;
    return replaceUnique(content, exactNeedle, exactReplacement);
  }

  return replaceUnique(content, afterText, beforeText);
}