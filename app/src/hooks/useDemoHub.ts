import { useState, useRef, useEffect, useCallback } from 'react';
import { deployDemoHub, resolveVercelToken } from '../services/publishVercel';
import type { Workspace } from '../types';

export function useDemoHub(workspace: Workspace | null) {
  const [demoHubToast, setDemoHubToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const demoHubToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (demoHubToastTimerRef.current) clearTimeout(demoHubToastTimerRef.current);
  }, []);

  const handlePublishDemoHub = useCallback(async () => {
    if (!workspace) return;
    const demoHub = workspace.config.vercelConfig?.demoHub;
    if (!demoHub?.projectName) return;
    const token = resolveVercelToken(workspace.config.vercelConfig?.token);
    if (!token) {
      setDemoHubToast({ msg: 'Sem token Vercel. Configure em Settings → API Keys.', ok: false });
      if (demoHubToastTimerRef.current) clearTimeout(demoHubToastTimerRef.current);
      demoHubToastTimerRef.current = setTimeout(() => setDemoHubToast(null), 5000);
      return;
    }
    setDemoHubToast({ msg: 'Publicando demos…', ok: true });
    try {
      const result = await deployDemoHub({
        token,
        projectName: demoHub.projectName,
        teamId: workspace.config.vercelConfig?.teamId,
        workspacePath: workspace.path,
        sourceDir: demoHub.sourceDir,
      });
      const url = result.url.replace(/^\/\//, 'https://');
      setDemoHubToast({ msg: `Publicado ✔ ${url}`, ok: true });
      if (demoHubToastTimerRef.current) clearTimeout(demoHubToastTimerRef.current);
      demoHubToastTimerRef.current = setTimeout(() => setDemoHubToast(null), 8000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDemoHubToast({ msg: `Erro: ${msg}`, ok: false });
      if (demoHubToastTimerRef.current) clearTimeout(demoHubToastTimerRef.current);
      demoHubToastTimerRef.current = setTimeout(() => setDemoHubToast(null), 8000);
    }
  }, [workspace]);

  const clearDemoHubToast = useCallback(() => setDemoHubToast(null), []);

  return { demoHubToast, handlePublishDemoHub, clearDemoHubToast };
}
