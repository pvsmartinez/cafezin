/**
 * Pub/sub registry of files currently being modified by the Copilot agent.
 * Locked files show a shimmer in the sidebar and a lock overlay in the editor.
 *
 * Each lock tracks which agentId owns it, so multiple parallel agents don't
 * accidentally release each other's locks on completion.
 */

type Listener = (locked: Set<string>) => void;

/** path → agentId */
const lockedFiles = new Map<string, string>();
const listeners = new Set<Listener>();

function notify() {
  const snapshot = new Set(lockedFiles.keys());
  listeners.forEach((fn) => fn(snapshot));
}

/** Mark a file as actively being edited by Copilot. agentId defaults to 'agent-1'. */
export function lockFile(path: string, agentId = 'agent-1'): void {
  lockedFiles.set(path, agentId);
  notify();
}

/** Release the lock on a specific file. */
export function unlockFile(path: string): void {
  lockedFiles.delete(path);
  notify();
}

/** Release all locks owned by a specific agent. Call on per-agent run completion/stop/error. */
export function unlockAllByAgent(agentId: string): void {
  let changed = false;
  for (const [path, owner] of lockedFiles) {
    if (owner === agentId) { lockedFiles.delete(path); changed = true; }
  }
  if (changed) notify();
}

/** Release ALL locks regardless of agent (e.g. on app restart). */
export function unlockAll(): void {
  if (lockedFiles.size === 0) return;
  lockedFiles.clear();
  notify();
}

/** Get a snapshot of all currently locked file paths. */
export function getLockedFiles(): Set<string> {
  return new Set(lockedFiles.keys());
}

/** Get a snapshot of locked files with their owning agentId. */
export function getLockedFileOwners(): Map<string, string> {
  return new Map(lockedFiles);
}

/**
 * Subscribe to lock-set changes.
 * Returns an unsubscribe function.
 */
export function onLockedFilesChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Wait until a file is no longer locked by another agent.
 *
 * - If the file is not locked (or locked by the same agent), resolves immediately.
 * - Listens to pub/sub events and resolves as soon as the lock is released.
 * - If the lock is not released within `maxWaitMs` (default 60 s), resolves with
 *   `timedOut: true` so the caller can return a descriptive error to the AI.
 *
 * Returns `{ timedOut: false, waitedMs: number }` on success,
 *         `{ timedOut: true,  owner: string }` on timeout.
 */
export function waitForUnlock(
  path: string,
  callerAgentId: string | undefined,
  maxWaitMs = 60_000,
): Promise<{ timedOut: false; waitedMs: number } | { timedOut: true; owner: string }> {
  const caller = callerAgentId ?? 'agent-1';
  const owner = lockedFiles.get(path);
  // Not locked, or locked by the same agent — proceed immediately.
  if (!owner || owner === caller) {
    return Promise.resolve({ timedOut: false, waitedMs: 0 });
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timedOutOwner = owner; // capture at call time in case it changes

    const timer = setTimeout(() => {
      unsub();
      resolve({ timedOut: true, owner: timedOutOwner });
    }, maxWaitMs);

    const unsub = onLockedFilesChange((locked) => {
      if (!locked.has(path)) {
        clearTimeout(timer);
        unsub();
        resolve({ timedOut: false, waitedMs: Date.now() - startedAt });
      }
    });
  });
}
