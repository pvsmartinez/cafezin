/**
 * useFeedbackNudge — shows a feedback request card after a few app sessions.
 *
 * Rules:
 *   - Increments a session counter on every mount
 *   - Shows after SESSION_THRESHOLD sessions (default 3)
 *   - Waits DELAY_MS after workspace opens (so it doesn't interrupt startup)
 *   - Auto-dismisses after AUTO_DISMISS_MS
 *   - Never shows again once dismissed or after the user clicks "Dar feedback"
 */

import { useEffect, useState } from 'react';

const SESSION_THRESHOLD = 3;
const DELAY_MS          = 6_000;   // 6 s after workspace opens
const AUTO_DISMISS_MS   = 30_000;  // auto-hide after 30 s

const LS_SESSION_COUNT = 'cafezin:feedback:sessions';
const LS_DONE          = 'cafezin:feedback:done';

function incrementAndGet(): number {
  const prev = parseInt(localStorage.getItem(LS_SESSION_COUNT) ?? '0', 10);
  const next = isNaN(prev) ? 1 : prev + 1;
  localStorage.setItem(LS_SESSION_COUNT, String(next));
  return next;
}

export function useFeedbackNudge() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(LS_DONE) === '1') return;

    const count = incrementAndGet();
    if (count < SESSION_THRESHOLD) return;

    const showTimer = setTimeout(() => setShow(true), DELAY_MS);
    return () => clearTimeout(showTimer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once per mount

  useEffect(() => {
    if (!show) return;
    const dismissTimer = setTimeout(() => {
      setShow(false);
      localStorage.setItem(LS_DONE, '1');
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(dismissTimer);
  }, [show]);

  function dismiss() {
    setShow(false);
    localStorage.setItem(LS_DONE, '1');
  }

  return { showFeedbackNudge: show, dismissFeedbackNudge: dismiss };
}
