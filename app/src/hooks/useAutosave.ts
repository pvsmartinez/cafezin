/**
 * useAutosave
 *
 * Owns the debounced-write lifecycle for editable text files.
 * Creates and exposes `scheduleAutosave`, `cancelAutosave`, and
 * `autosaveDelayRef` (runtime-configurable delay).
 *
 * Call `scheduleAutosave(ws, filePath, newContent)` on every content change.
 * The hook updates the dirty-file set immediately and flushes the write after
 * `autosaveDelayRef.current` milliseconds.  A delay of 0 means "never auto-save".
 *
 * `trackFileEdit` (config.json write) is rate-limited to once per minute to
 * avoid a second I/O write on every autosave tick.
 */
import { useRef, useCallback, useEffect } from 'react';
import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import type { Workspace } from '../types';
import { writeFile, trackFileEdit } from '../services/workspace';

// Config.json records lastEditedAt — only needed for "workspace last edited" display.
// Writing it every autosave (potentially 1×/second) was causing a second disk write
// and a root setWorkspace re-render per keystroke cycle. 60s is plenty.
const TRACK_EDIT_RATE_MS = 60_000;

export interface UseAutosaveOptions {
  savedContentRef: MutableRefObject<Map<string, string>>;
  setDirtyFiles: (fn: (prev: Set<string>) => Set<string>) => void;
  setSaveError:  Dispatch<SetStateAction<string | null>>;
  setWorkspace:  Dispatch<SetStateAction<Workspace | null>>;
  /** Delay in ms from initSettings.autosaveDelay; default 1000. */
  initialDelay?: number;
}

export function useAutosave({
  savedContentRef,
  setDirtyFiles,
  setSaveError,
  setWorkspace,
  initialDelay = 1000,
}: UseAutosaveOptions) {
  const saveTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveDelayRef = useRef<number>(initialDelay);
  const pendingSaveFileRef = useRef<string | null>(null);
  // Timestamp of the last config.json write via trackFileEdit
  const lastTrackEditRef = useRef<number>(0);

  const scheduleAutosave = useCallback(
    (ws: Workspace, file: string, newContent: string) => {
      const lastSaved = savedContentRef.current.get(file);
      const isDirty   = newContent !== lastSaved;

      setDirtyFiles((prev) => {
        const wasDirty = prev.has(file);
        if (isDirty === wasDirty) return prev;
        const next = new Set(prev);
        if (isDirty) next.add(file); else next.delete(file);
        return next;
      });

      if (!isDirty) {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        pendingSaveFileRef.current = null;
        return;
      }

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (autosaveDelayRef.current === 0) return;
      pendingSaveFileRef.current = file;

      saveTimerRef.current = setTimeout(async () => {
        // Guard: if an external writer (e.g. AI agent tool) already saved a
        // different version since this timer was scheduled, skip the write.
        // handleFileWritten updates savedContentRef immediately after the AI
        // write succeeds, so a diverged value here means the disk is already
        // at the newer version and we would be rolling it back.
        const currentSaved = savedContentRef.current.get(file);
        if (currentSaved !== undefined && currentSaved !== newContent) {
          if (pendingSaveFileRef.current === file) pendingSaveFileRef.current = null;
          return;
        }
        try {
          await writeFile(ws, file, newContent);
          savedContentRef.current.set(file, newContent);
          setDirtyFiles((prev) => {
            if (!prev.has(file)) return prev;
            const next = new Set(prev);
            next.delete(file);
            return next;
          });
          setSaveError(null);
          // Rate-limit config.json writes: skip if written recently.
          const now = Date.now();
          if (now - lastTrackEditRef.current >= TRACK_EDIT_RATE_MS) {
            lastTrackEditRef.current = now;
            trackFileEdit(ws).then((updated) => {
              setWorkspace(updated);
            }).catch(() => {});
          }
        } catch (err) {
          console.error('Auto-save failed:', err);
          setSaveError(String((err as Error)?.message ?? err));
        } finally {
          if (pendingSaveFileRef.current === file) pendingSaveFileRef.current = null;
        }
      }, autosaveDelayRef.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const cancelAutosave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingSaveFileRef.current = null;
  }, []);

  // Cancel any pending write on unmount to avoid setState-on-unmounted-component
  // warnings in React 18+ and prevent ghost saves after workspace switch.
  useEffect(() => {
    return cancelAutosave;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { saveTimerRef, autosaveDelayRef, pendingSaveFileRef, scheduleAutosave, cancelAutosave };
}
