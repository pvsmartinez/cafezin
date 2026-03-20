import { useState, useRef, useEffect } from 'react';
import { newSessionId } from '../services/copilotLog';
import type { ChatMessage, CopilotModel } from '../types';
import { timeAgo } from '../utils/timeAgo';

// ── Persistence utils ─────────────────────────────────────────────────────────
const LAST_SESSION_KEY = 'cafezin-last-session';

export interface SavedSession {
  messages: ChatMessage[];
  model: string;
  savedAt: string;
}

export function loadSavedSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY);
    return raw ? (JSON.parse(raw) as SavedSession) : null;
  } catch { return null; }
}

export function persistSession(msgs: ChatMessage[], mdl: string) {
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
      LAST_SESSION_KEY,
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
}

export function useAISession({ model }: UseAISessionParams) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [savedSession, setSavedSession] = useState<SavedSession | null>(() => loadSavedSession());

  // Log session identifiers
  const sessionIdRef = useRef<string>(newSessionId());
  const sessionStartedAtRef = useRef<string>(new Date().toISOString());

  // Auto-save conversation to localStorage whenever user/assistant messages change.
  // Compute a stable key from the user+assistant turn count so the effect only fires
  // when conversational content actually changes (not on tool/system entries).
  const conversationKey = messages.filter((m) => m.role === 'user' || m.role === 'assistant').length;
  useEffect(() => {
    if (conversationKey === 0) return;
    persistSession(messages, model);
    setSavedSession(loadSavedSession());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationKey]);

  /** Resets messages and session refs. Caller is responsible for clearing stream state. */
  function handleNewChat() {
    setSavedSession(loadSavedSession());
    setMessages([]);
    sessionIdRef.current = newSessionId();
    sessionStartedAtRef.current = new Date().toISOString();
  }

  /** Returns the restored model string (for the caller to call setModel), or null if no session. */
  function handleRestoreSession(): string | null {
    if (!savedSession) return null;
    setMessages(savedSession.messages);
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
