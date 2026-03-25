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
    // Try exact context match first (most precise).
    const exactNeedle = `${contextBefore}${revert.afterText}${contextAfter}`;
    const exactIdx = text.indexOf(exactNeedle);
    if (exactIdx !== -1) {
      return {
        from: exactIdx + contextBefore.length,
        to: exactIdx + contextBefore.length + revert.afterText.length,
      };
    }

    // Context may have been shifted by a nearby patch in the same agent turn.
    // Fall back to afterText-only with context used as a tiebreaker when there
    // are multiple candidates.
    const occurrences: number[] = [];
    let cursor = 0;
    let idx: number;
    while ((idx = text.indexOf(revert.afterText, cursor)) !== -1) {
      occurrences.push(idx);
      cursor = idx + revert.afterText.length;
    }
    if (occurrences.length === 1) {
      return { from: occurrences[0], to: occurrences[0] + revert.afterText.length };
    }
    if (occurrences.length > 1) {
      // Pick the candidate whose surrounding text best matches the stored context.
      // Use contextBefore as the primary signal (more stable than contextAfter).
      let best = occurrences[0];
      let bestScore = 0;
      for (const pos of occurrences) {
        const surrounding = text.slice(Math.max(0, pos - contextBefore.length), pos);
        // Count matching characters from the right edge of contextBefore.
        let score = 0;
        for (let i = 0; i < surrounding.length && i < contextBefore.length; i++) {
          if (surrounding[surrounding.length - 1 - i] === contextBefore[contextBefore.length - 1 - i]) {
            score++;
          } else {
            break;
          }
        }
        if (score > bestScore) { bestScore = score; best = pos; }
      }
      return { from: best, to: best + revert.afterText.length };
    }
  }

  // No context, or afterText not found above — require uniqueness to avoid false positives.
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
