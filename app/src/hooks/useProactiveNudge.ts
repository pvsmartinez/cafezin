/**
 * useProactiveNudge — shows a discreet AI suggestion toast after sustained editing.
 *
 * Rules:
 *   - Fires after EDIT_THRESHOLD autosaves (counts typing bursts)
 *   - Max 1 nudge per app session (sessionStorage flag)
 *   - Min COOLDOWN_MS between nudges across sessions (localStorage timestamp)
 *   - Auto-dismisses after AUTO_DISMISS_MS
 */

import { useRef, useState, useCallback, useEffect } from 'react';

export interface NudgePayload {
  text: string;
  aiPrompt: string;
}

const COOLDOWN_MS     = 25 * 60 * 1000; // 25 min between nudges
const EDIT_THRESHOLD  = 20;             // ~10–15 min of active writing
const AUTO_DISMISS_MS = 15_000;         // auto-hide after 15 s

const LS_LAST_SHOWN    = 'cafezin:nudge:lastShown';
const SS_SHOWN_SESSION = 'cafezin:nudge:session';

function canShow(): boolean {
  if (sessionStorage.getItem(SS_SHOWN_SESSION) === '1') return false;
  const ts = localStorage.getItem(LS_LAST_SHOWN);
  if (ts && Date.now() - new Date(ts).getTime() < COOLDOWN_MS) return false;
  return true;
}

function buildNudge(isCanvas: boolean): NudgePayload {
  if (isCanvas) {
    return {
      text: 'Trabalhando no canvas? Posso ajudar a estruturar.',
      aiPrompt: 'Estou trabalhando em um canvas com slides e diagramas no Cafezin. Pode me ajudar a melhorar ou expandir o conteúdo?',
    };
  }
  return {
    text: 'Escrevendo bastante? Quer uma mão?',
    aiPrompt: 'Estou escrevendo um documento no Cafezin. Pode revisar o que escrevi, sugerir melhorias ou continuar de onde parei?',
  };
}

export function useProactiveNudge(isCanvasActive: boolean, enabled = true) {
  const editCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeNudge, setActiveNudge] = useState<NudgePayload | null>(null);

  const dismissNudge = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setActiveNudge(null);
  }, []);

  const recordEdit = useCallback(() => {
    if (!enabled) return;
    editCountRef.current += 1;
    if (editCountRef.current < EDIT_THRESHOLD) return;
    editCountRef.current = 0;
    if (!canShow()) return;

    const nudge = buildNudge(isCanvasActive);
    localStorage.setItem(LS_LAST_SHOWN, new Date().toISOString());
    sessionStorage.setItem(SS_SHOWN_SESSION, '1');
    setActiveNudge(nudge);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setActiveNudge(null);
      timerRef.current = null;
    }, AUTO_DISMISS_MS);
  }, [isCanvasActive, enabled]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { activeNudge, recordEdit, dismissNudge };
}
