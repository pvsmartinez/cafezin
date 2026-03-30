import { fetch } from '@tauri-apps/plugin-http';
import type { ChatMessage, CopilotModel } from '../../types';
import { appendArchiveEntry } from '../copilotLog';
import { COPILOT_API_URL } from './constants';
import { modelApiParams } from './models';
import {
  getModelTokenBudgets,
  estimateTokens,
  stripBase64ForLog,
  getCompressionAnchorUserText,
} from './tokenBudget';
import { sanitizeLoop } from './messages';

/**
 * Ask the model to produce a dense summary of the conversation, then rebuild
 * the context window to a compact form:
 *   1. System messages (kept verbatim)
 *   2. A synthetic user message with the [SESSION SUMMARY] + current request
 *   3. One assistant bridge: "Understood — resuming…"
 *   4. Last 8 messages verbatim (for recency context)
 *
 * The full conversation is persisted to the workspace log so the user (or the
 * agent itself, via read_file) can inspect what was pruned.
 */
export async function summarizeAndCompress(
  loop: ChatMessage[],
  headers: Record<string, string>,
  model: CopilotModel,
  workspacePath: string | undefined,
  sessionId: string,
  round: number,
): Promise<ChatMessage[]> {
  const strippedForLog = stripBase64ForLog(loop);

  // ── Ask the model to summarize ───────────────────────────────────────────
  let summaryText = '[Summary unavailable — model did not respond]';
  try {
    const budgets = getModelTokenBudgets(model);
    const summaryRes = await fetch(COPILOT_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are a technical session summarizer. The agent context window is full and needs to be compressed. ' +
              'Respond with EXACTLY these 5 sections. Use the section headers verbatim:\n\n' +
              '## ORIGINAL GOAL\n' +
              'One sentence: the user\'s original goal for this session.\n\n' +
              '## ACCOMPLISHED\n' +
              'Bullet list of everything done: each tool call, file created/modified, canvas change, decision made.\n\n' +
              '## CURRENT STATE\n' +
              'Brief snapshot of where things stand right now.\n\n' +
              '## STILL NEEDED\n' +
              'Bullet list of what remains to fully complete the original goal. Be specific — these are action items.\n\n' +
              '## CRITICAL FACTS\n' +
              'Any schema/format/rules changes, corrected assumptions, or important constraints. ' +
              'State the CURRENT (corrected) version explicitly — old assumptions must be overridden.\n\n' +
              'Be precise and technical. Aim for 350–550 words total.',
          },
          {
            role: 'user',
            content:
              `Conversation to summarize (${strippedForLog.length} messages, after round ${round}):\n\n` +
              JSON.stringify(strippedForLog, null, 2),
          },
        ],
        stream: false,
        ...modelApiParams(model, 0.2, Math.min(budgets.maxOutputTokens ?? 1800, 1800)),
      }),
    });
    if (summaryRes.ok) {
      const data = await summaryRes.json() as any;
      summaryText = data?.choices?.[0]?.message?.content ?? summaryText;
    } else {
      const errText = await summaryRes.text();
      console.warn('[summarizeAndCompress] model returned', summaryRes.status, errText.slice(0, 200));
    }
  } catch (e) {
    console.warn('[summarizeAndCompress] fetch failed:', e);
  }

  // ── Write archive to the workspace log ──────────────────────────────────
  if (workspacePath) {
    await appendArchiveEntry(workspacePath, {
      entryType: 'archive',
      sessionId,
      archivedAt: new Date().toISOString(),
      round,
      estimatedTokens: estimateTokens(loop),
      summary: summaryText,
      messages: strippedForLog,
    });
  }

  // ── Rebuild compact context ─────────────────────────────────────────────
  const systemMsgs = loop.filter((m) => m.role === 'system');
  const currentUserRequest = getCompressionAnchorUserText(loop);

  // Find the last non-summary user message in the FULL loop, then take
  // everything from there to the end. This ensures complete tool-call/result
  // pairs are always included — the old "last 8 after vision filter" approach
  // could leave an assistant with unresolved tool_calls at the end of the tail.
  let tailStart = -1;
  for (let i = loop.length - 1; i >= 0; i--) {
    const m = loop[i];
    if (
      m.role === 'user' &&
      !(typeof m.content === 'string' && m.content.startsWith('[SESSION SUMMARY'))
    ) {
      tailStart = i;
      break;
    }
  }
  // Strip vision payloads from the tail — images can't be re-used after compression
  // and would inflate the token count. For mixed messages (text + image) we keep the
  // text parts so the user message and its context are preserved; pure image-only
  // messages (e.g. canvas-only injections) are dropped entirely.
  const stripTailImages = (m: ChatMessage): ChatMessage | null => {
    if (!Array.isArray(m.content)) return m;
    const textParts = (m.content as any[]).filter((p: any) => p.type !== 'image_url');
    if (textParts.length === 0) return null; // pure vision message — drop
    return { ...m, content: textParts };
  };
  const tail = (tailStart >= 0 ? loop.slice(tailStart) : [])
    .map(stripTailImages)
    .filter((m): m is ChatMessage => m !== null);

  const summaryMsg: ChatMessage = {
    role: 'user',
    content:
      `[SESSION SUMMARY — ${round} rounds archived to workspace log (cafezin/copilot-log.jsonl)]\n\n` +
      `⚑ ORIGINAL GOAL (do not lose track of this):\n${currentUserRequest}\n\n` +
      `Progress summary:\n${summaryText}\n\n` +
      `Priority rule: complete the ORIGINAL GOAL above. If the summary's "STILL NEEDED" section lists pending steps, continue those next.\n\n` +
      `---\nThe full turn-by-turn transcript is in the workspace log (read_file on ` +
      `cafezin/copilot-log.jsonl). Continuing from here:`,
  };

  const bridgeMsg: ChatMessage = {
    role: 'assistant',
    content: `Understood — resuming from the session summary above. I'll continue towards the original goal.`,
  };

  return sanitizeLoop([
    ...systemMsgs,
    summaryMsg,
    bridgeMsg,
    ...tail,
  ]);
}
