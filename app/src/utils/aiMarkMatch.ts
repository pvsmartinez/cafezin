import type { AITextRevert } from '../types';

export interface AITextMarkTarget {
  text: string;
  revert?: AITextRevert;
}

export interface AITextMarkRange {
  from: number;
  to: number;
}

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

function findUniqueRange(text: string, search: string): AITextMarkRange | null {
  if (!search || countOccurrences(text, search) !== 1) return null;
  const from = text.indexOf(search);
  if (from === -1) return null;
  return { from, to: from + search.length };
}

function findRevertRange(text: string, revert?: AITextRevert): AITextMarkRange | null {
  if (!revert?.afterText) return null;

  const contextBefore = revert.contextBefore ?? '';
  const contextAfter = revert.contextAfter ?? '';
  if (contextBefore || contextAfter) {
    const exactNeedle = `${contextBefore}${revert.afterText}${contextAfter}`;
    const exactRange = findUniqueRange(text, exactNeedle);
    if (exactRange) {
      return {
        from: exactRange.from + contextBefore.length,
        to: exactRange.from + contextBefore.length + revert.afterText.length,
      };
    }
  }

  return findUniqueRange(text, revert.afterText);
}

export function findAIMarkRange(text: string, mark: AITextMarkTarget | string): AITextMarkRange | null {
  const target = typeof mark === 'string' ? { text: mark } : mark;
  const revertRange = findRevertRange(text, target.revert);
  if (revertRange) return revertRange;

  if (!target.text) return null;
  const from = text.indexOf(target.text);
  if (from === -1) return null;
  return { from, to: from + target.text.length };
}

export function findAIMarkOccurrences(text: string, mark: AITextMarkTarget): AITextMarkRange[] {
  const revertRange = findRevertRange(text, mark.revert);
  if (revertRange) return [revertRange];

  if (!mark.text || mark.text.length < 4) return [];
  const ranges: AITextMarkRange[] = [];
  let cursor = 0;
  let idx: number;
  while ((idx = text.indexOf(mark.text, cursor)) !== -1) {
    ranges.push({ from: idx, to: idx + mark.text.length });
    cursor = idx + mark.text.length;
  }
  return ranges;
}

export function hasAIMarkMatch(text: string, mark: AITextMarkTarget): boolean {
  if (findRevertRange(text, mark.revert)) return true;
  if (mark.revert?.afterText && text.includes(mark.revert.afterText)) return true;
  return !!mark.text && text.includes(mark.text);
}
