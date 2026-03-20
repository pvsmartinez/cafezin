/**
 * Per-workspace session persistence.
 * Saves/restores open tabs, AI panel tabs, and sidebar folder state using localStorage.
 */

const KEY_PREFIX = 'cafezin:session:';

export interface WorkspaceAgentTabSession {
  id: string;
  label: string;
  model?: string;
  createdAt?: string;
}

export interface WorkspaceSession {
  /** Ordered open tab file paths */
  tabs: string[];
  /** Currently active tab */
  activeTabId: string | null;
  /** The single "preview" (temporary) tab, if any */
  previewTabId: string | null;
  /** Expanded folder paths in the sidebar */
  expandedDirs: string[];
  /** Persisted AI panel tabs for this workspace */
  aiTabs: WorkspaceAgentTabSession[];
  /** Currently active AI tab */
  activeAiTabId: string | null;
}

function sessionKey(workspacePath: string): string {
  return `${KEY_PREFIX}${workspacePath}`;
}

export function loadWorkspaceSession(workspacePath: string): WorkspaceSession {
  try {
    const raw = localStorage.getItem(sessionKey(workspacePath));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WorkspaceSession>;
      return {
        tabs: Array.isArray(parsed.tabs) ? parsed.tabs : [],
        activeTabId: parsed.activeTabId ?? null,
        previewTabId: parsed.previewTabId ?? null,
        expandedDirs: Array.isArray(parsed.expandedDirs) ? parsed.expandedDirs : [],
        aiTabs: Array.isArray(parsed.aiTabs)
          ? parsed.aiTabs
              .filter((tab): tab is WorkspaceAgentTabSession => !!tab && typeof tab === 'object')
              .map((tab) => ({
                id: typeof tab.id === 'string' ? tab.id : 'agent-1',
                label: typeof tab.label === 'string' ? tab.label : 'Agente 1',
                ...(typeof tab.model === 'string' && tab.model ? { model: tab.model } : {}),
                ...(typeof tab.createdAt === 'string' && tab.createdAt ? { createdAt: tab.createdAt } : {}),
              }))
          : [],
        activeAiTabId: parsed.activeAiTabId ?? null,
      };
    }
  } catch { /* corrupt data — ignore */ }
  return {
    tabs: [],
    activeTabId: null,
    previewTabId: null,
    expandedDirs: [],
    aiTabs: [],
    activeAiTabId: null,
  };
}

export function saveWorkspaceSession(
  workspacePath: string,
  session: Partial<WorkspaceSession>,
): void {
  try {
    const existing = loadWorkspaceSession(workspacePath);
    const merged: WorkspaceSession = { ...existing, ...session };
    localStorage.setItem(sessionKey(workspacePath), JSON.stringify(merged));
  } catch { /* quota exceeded or similar — ignore */ }
}
