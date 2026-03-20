/**
 * canvasAI.ts — barrel re-exporter
 *
 * This file is intentionally thin. All logic lives in:
 *   canvasAISnapshot.ts  — richText helpers + snapshot sanitizer
 *   canvasAISummary.ts   — canvas-to-text summarisation + screenshot helpers
 *   canvasAICommands.ts  — AI command parser + executor + placeImageOnCanvas
 *
 * Existing consumers continue to import from '../utils/canvasAI' without change.
 */

export * from './canvasAISnapshot';
export * from './canvasAISummary';
export * from './canvasAICommands';
