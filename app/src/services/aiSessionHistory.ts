import { CONFIG_DIR } from './config';
import { exists, readTextFile } from './fs';
import type { ChatMessage } from '../types';

const LOG_FILE_NAME = 'copilot-log.jsonl';

interface CopilotExchangeLogEntry {
  sessionId: string;
  sessionStartedAt: string;
  timestamp: string;
  model: string;
  userMessage: string;
  aiResponse: string;
  toolCalls?: number;
}

interface CopilotArchiveLogEntry {
  entryType: 'archive';
  sessionId: string;
  archivedAt: string;
  summary: string;
}

type CopilotLogLine = CopilotExchangeLogEntry | CopilotArchiveLogEntry;

export interface HistoricalSession {
  sessionId: string;
  startedAt: string;
  savedAt: string;
  model: string;
  messages: ChatMessage[];
  userMessageCount: number;
  preview: string;
  toolCalls: number;
  archiveCount: number;
  archiveSummary?: string;
}

function isExchangeEntry(entry: CopilotLogLine): entry is CopilotExchangeLogEntry {
  return (entry as CopilotArchiveLogEntry).entryType !== 'archive';
}

function parseLogLine(rawLine: string): CopilotLogLine | null {
  const line = rawLine.trim();
  if (!line) return null;
  try {
    return JSON.parse(line) as CopilotLogLine;
  } catch {
    return null;
  }
}

function buildPreview(messages: ChatMessage[]): string {
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (content) return content.replace(/\s+/g, ' ').slice(0, 140);
  }
  return 'Sessão sem mensagem legível';
}

export function parseHistoricalSessions(logContent: string): HistoricalSession[] {
  const sessions = new Map<string, HistoricalSession>();

  for (const rawLine of logContent.split('\n')) {
    const entry = parseLogLine(rawLine);
    if (!entry) continue;

    if (isExchangeEntry(entry)) {
      const existing = sessions.get(entry.sessionId);
      const nextMessages = existing?.messages ? [...existing.messages] : [];

      if (entry.userMessage.trim()) {
        nextMessages.push({ role: 'user', content: entry.userMessage });
      }
      if (entry.aiResponse.trim()) {
        nextMessages.push({ role: 'assistant', content: entry.aiResponse });
      }

      sessions.set(entry.sessionId, {
        sessionId: entry.sessionId,
        startedAt: existing?.startedAt ?? entry.sessionStartedAt,
        savedAt: entry.timestamp,
        model: entry.model,
        messages: nextMessages,
        userMessageCount: nextMessages.filter((message) => message.role === 'user').length,
        preview: buildPreview(nextMessages),
        toolCalls: (existing?.toolCalls ?? 0) + (entry.toolCalls ?? 0),
        archiveCount: existing?.archiveCount ?? 0,
        archiveSummary: existing?.archiveSummary,
      });
      continue;
    }

    const existing = sessions.get(entry.sessionId);
    if (!existing) continue;

    sessions.set(entry.sessionId, {
      ...existing,
      archiveCount: existing.archiveCount + 1,
      archiveSummary: entry.summary || existing.archiveSummary,
      savedAt: entry.archivedAt || existing.savedAt,
    });
  }

  return Array.from(sessions.values())
    .filter((session) => session.messages.length > 0)
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt));
}

export async function loadHistoricalSessions(workspacePath?: string): Promise<HistoricalSession[]> {
  if (!workspacePath) return [];

  const logPath = `${workspacePath}/${CONFIG_DIR}/${LOG_FILE_NAME}`;
  if (!(await exists(logPath))) return [];

  const content = await readTextFile(logPath);
  return parseHistoricalSessions(content);
}
