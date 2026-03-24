import { useState, useEffect, useCallback } from 'react';
import { readDir } from '../services/fs';
import type { PendingVoiceMemo } from '../components/AIPanel';

export function useVoiceMemos(workspacePath: string | undefined) {
  const [pendingVoiceMemos, setPendingVoiceMemos] = useState<PendingVoiceMemo[]>([]);

  async function scanVoiceMemos(wsPath: string) {
    function parseStemDate(stem: string): Date {
      const body = stem.replace(/^memo_/, '');
      const iso  = body.replace(/_([0-9]{2})-([0-9]{2})-([0-9]{2})$/, 'T$1:$2:$3');
      const d = new Date(iso);
      return isNaN(d.getTime()) ? new Date(0) : d;
    }
    const dir = `${wsPath}/.cafezin/voice-memos`;
    const entries = await readDir(dir).catch(() => []);
    const stems = new Map<string, { audioExt?: string; hasTxt: boolean }>();
    for (const e of entries) {
      if (!e.name) continue;
      const dot  = e.name.lastIndexOf('.');
      if (dot < 0) continue;
      const stem = e.name.slice(0, dot);
      const ext  = e.name.slice(dot + 1).toLowerCase();
      if (!stems.has(stem)) stems.set(stem, { hasTxt: false });
      const rec = stems.get(stem)!;
      if (['webm', 'ogg', 'm4a', 'mp4'].includes(ext)) rec.audioExt = ext;
      if (ext === 'txt') rec.hasTxt = true;
    }
    const result: PendingVoiceMemo[] = [];
    for (const [stem, info] of stems) {
      if (!info.audioExt || info.hasTxt) continue;
      result.push({
        stem,
        audioExt:       info.audioExt,
        audioPath:      `${dir}/${stem}.${info.audioExt}`,
        transcriptPath: `${dir}/${stem}.txt`,
        timestamp:      parseStemDate(stem),
      });
    }
    result.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    setPendingVoiceMemos(result);
  }

  // Scan when workspace first loads or changes
  useEffect(() => {
    if (workspacePath) void scanVoiceMemos(workspacePath);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  const handleVoiceMemoHandled = useCallback((stem: string) => {
    setPendingVoiceMemos((prev) => prev.filter((m) => m.stem !== stem));
  }, []);

  return { pendingVoiceMemos, scanVoiceMemos, handleVoiceMemoHandled };
}
