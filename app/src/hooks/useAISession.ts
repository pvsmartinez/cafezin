import { useState, useRef, useEffect } from 'react';
import { newSessionId } from '../services/copilotLog';
import type { ChatMessage, CopilotModel } from '../types';
import { timeAgo } from '../utils/timeAgo';

// ── Persistence utils ─────────────────────────────────────────────────────────
const LEGACY_LAST_SESSION_KEY = 'cafezin-last-session';
const LEGACY_MIGRATED_KEY = 'cafezin-last-session-migrated';
const SESSION_KEY_PREFIX = 'cafezin:agent-session:';
const GLOBAL_WORKSPACE_ID = '__no-workspace__';

type SavedSessionSource = 'scoped' | 'legacy';

export interface SavedSession {
  messages: ChatMessage[];
  model: string;
  savedAt: string;
}

function readSavedSession(key: string): SavedSession | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as SavedSession) : null;
  } catch { return null; }
}

export function getScopedSessionKey(workspacePath?: string, agentId?: string): string {
  const workspaceId = workspacePath?.trim() || GLOBAL_WORKSPACE_ID;
  const sessionId = agentId?.trim() || 'agent-1';
  return `${SESSION_KEY_PREFIX}${workspaceId}:${sessionId}`;
}

function hasMigratedLegacySession(): boolean {
  try {
    return localStorage.getItem(LEGACY_MIGRATED_KEY) === '1';
  } catch {
    return true;
  }
}

function loadSavedSessionRecord(
  workspacePath?: string,
  agentId?: string,
  allowLegacyRestore = false,
): { session: SavedSession | null; source: SavedSessionSource | null } {
  const scoped = readSavedSession(getScopedSessionKey(workspacePath, agentId));
  if (scoped) return { session: scoped, source: 'scoped' };
  if (!allowLegacyRestore || hasMigratedLegacySession()) {
    return { session: null, source: null };
  }
  const legacy = readSavedSession(LEGACY_LAST_SESSION_KEY);
  return legacy ? { session: legacy, source: 'legacy' } : { session: null, source: null };
}

export function loadSavedSession(
  workspacePath?: string,
  agentId?: string,
  allowLegacyRestore = false,
): SavedSession | null {
  return loadSavedSessionRecord(workspacePath, agentId, allowLegacyRestore).session;
}

export function markLegacySessionMigrated() {
  try {
    localStorage.setItem(LEGACY_MIGRATED_KEY, '1');
    localStorage.removeItem(LEGACY_LAST_SESSION_KEY);
  } catch {
    // Ignore storage failures — future sessions will keep the legacy fallback.
  }
}

export function persistSession(
  msgs: ChatMessage[],
  mdl: string,
  workspacePath?: string,
  agentId?: string,
) {
  // Only persist user/assistant roles; strip attached images (base64) to stay within storage limits
  const slim = msgs
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.activeFile   ? { activeFile: m.activeFile }   : {}),
      ...(m.attachedFile ? { attachedFile: m.attachedFile } : {}),
      ...(m.attachedSelectionLabel ? { attachedSelectionLabel: m.attachedSelectionLabel } : {}),
    } as ChatMessage));
  if (slim.length === 0) return;
  try {
    localStorage.setItem(
      getScopedSessionKey(workspacePath, agentId),
      JSON.stringify({ messages: slim, model: mdl, savedAt: new Date().toISOString() }),
    );
  } catch { /* quota exceeded — skip silently */ }
}

export const fmtRelative = (iso: string): string => timeAgo(iso);

// ── Flatten content to plain text (for copy / insert / log) ──────────────────
export const contentToString = (content: ChatMessage['content']): string =>
  typeof content === 'string'
    ? content
    : (content as import('../types').ContentPart[])
        .filter((p): p is Extract<import('../types').ContentPart, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('');

// ── useAISession ──────────────────────────────────────────────────────────────
interface UseAISessionParams {
  model: CopilotModel;
  agentId: string;
  workspacePath?: string;
  allowLegacyRestore?: boolean;
}

export function useAISession({
  model,
  agentId,
  workspacePath,
  allowLegacyRestore = false,
}: UseAISessionParams) {
  const initialSaved = loadSavedSessionRecord(workspacePath, agentId, allowLegacyRestore);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [savedSession, setSavedSession] = useState<SavedSession | null>(initialSaved.session);
  const savedSessionSourceRef = useRef<SavedSessionSource | null>(initialSaved.source);
  const storageKey = getScopedSessionKey(workspacePath, agentId);

  // Log session identifiers
  const sessionIdRef = useRef<string>(newSessionId());
  const sessionStartedAtRef = useRef<string>(new Date().toISOString());

  useEffect(() => {
    const next = loadSavedSessionRecord(workspacePath, agentId, allowLegacyRestore);
    savedSessionSourceRef.current = next.source;
    setSavedSession(next.session);
    setMessages([]);
    sessionIdRef.current = newSessionId();
    sessionStartedAtRef.current = new Date().toISOString();
  }, [storageKey, allowLegacyRestore, workspacePath, agentId]);

  // Auto-save conversation to localStorage whenever user/assistant messages change.
  // Compute a stable key from the user+assistant turn count so the effect only fires
  // when conversational content actually changes (not on tool/system entries).
  const conversationKey = messages.filter((m) => m.role === 'user' || m.role === 'assistant').length;
  useEffect(() => {
    if (conversationKey === 0) return;
    persistSession(messages, model, workspacePath, agentId);
    savedSessionSourceRef.current = 'scoped';
    setSavedSession(loadSavedSession(workspacePath, agentId));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationKey, model, storageKey]);

  /** Resets messages and session refs. Caller is responsible for clearing stream state. */
  function handleNewChat() {
    setSavedSession(loadSavedSession(workspacePath, agentId));
    setMessages([]);
    sessionIdRef.current = newSessionId();
    sessionStartedAtRef.current = new Date().toISOString();
  }

  /** Returns the restored model string (for the caller to call setModel), or null if no session. */
  function handleRestoreSession(): string | null {
    if (!savedSession) return null;
    persistSession(savedSession.messages, savedSession.model, workspacePath, agentId);
    if (savedSessionSourceRef.current === 'legacy') {
      markLegacySessionMigrated();
      savedSessionSourceRef.current = 'scoped';
    }
    setMessages(savedSession.messages);
    setSavedSession(loadSavedSession(workspacePath, agentId));
    return savedSession.model;
  }

  return {
    messages,
    setMessages,
    savedSession,
    setSavedSession,
    sessionIdRef,
    sessionStartedAtRef,
    handleNewChat,
    handleRestoreSession,
  };
}
