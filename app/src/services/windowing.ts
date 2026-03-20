import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

const LAUNCH_WORKSPACE_PARAM = 'workspace';

function isDesktopTauriWindowingAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function buildWindowUrl(workspacePath?: string): string {
  const url = new URL(window.location.href);
  url.searchParams.delete(LAUNCH_WORKSPACE_PARAM);
  if (workspacePath) url.searchParams.set(LAUNCH_WORKSPACE_PARAM, workspacePath);
  return url.toString();
}

function buildWindowLabel(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `workspace_${Date.now()}_${rand}`;
}

function normalizeWindowError(payload: unknown): Error {
  if (payload instanceof Error) return payload;
  if (typeof payload === 'string') return new Error(payload);
  return new Error('Failed to create a new window.');
}

async function waitForWindowCreation(windowRef: WebviewWindow): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };

    void windowRef.once('tauri://created', () => finish(resolve));
    void windowRef.once('tauri://error', (event) => {
      finish(() => reject(normalizeWindowError(event.payload)));
    });
  });
}

export async function openWorkspaceWindow(workspacePath?: string): Promise<void> {
  if (!isDesktopTauriWindowingAvailable()) {
    throw new Error('Additional windows are only available in the desktop app.');
  }

  const windowRef = new WebviewWindow(buildWindowLabel(), {
    title: 'Cafezin',
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    url: buildWindowUrl(workspacePath),
  });

  await waitForWindowCreation(windowRef);
}

export function consumeLaunchWorkspacePath(): string | null {
  if (typeof window === 'undefined') return null;

  const url = new URL(window.location.href);
  const workspacePath = url.searchParams.get(LAUNCH_WORKSPACE_PARAM)?.trim() || null;
  if (!workspacePath) return null;

  url.searchParams.delete(LAUNCH_WORKSPACE_PARAM);
  window.history.replaceState({}, document.title, url.toString());
  return workspacePath;
}