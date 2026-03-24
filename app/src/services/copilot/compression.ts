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
              'Summarize the conversation below into a dense technical briefing covering:\n' +
              '1. The user\'s original goal\n' +
              '2. Everything accomplished so far — each tool call, file created/modified, canvas change made\n' +
              '3. Current state of the workspace / canvas\n' +
              '4. What still needs to be done to complete the user\'s goal\n' +
              '5. Any important findings, constraints, or decisions\n' +
              '6. **Schema/rules/format changes**: if any data structures, file formats, database schemas, or workspace rules were discussed or corrected during this session, state the CURRENT (corrected) version explicitly. These are the most common source of confusion in future sessions — old assumptions must be overridden.\n\n' +
              'Be precise and technical. Use bullet points. Aim for 400–700 words.',
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
  // Strip vision-only messages; they can't be re-used after compression.
  const tail = (tailStart >= 0 ? loop.slice(tailStart) : []).filter(
    (m) =>
      !(Array.isArray(m.content) &&
        (m.content as any[]).some((p: any) => p.type === 'image_url')),
  );

  const summaryMsg: ChatMessage = {
    role: 'user',
    content:
      `[SESSION SUMMARY — ${round} rounds archived to workspace log (cafezin/copilot-log.jsonl)]\n\n` +
      `Current user request: ${currentUserRequest}\n\n` +
      `Progress summary:\n${summaryText}\n\n` +
      `Priority rule: follow the current user request above if any older goal in the summary conflicts with it.\n\n` +
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
