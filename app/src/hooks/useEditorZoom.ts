import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { EDITOR_FONT_SIZE_MIN, EDITOR_FONT_SIZE_MAX, DEFAULT_EDITOR_FONT_SIZE } from '../utils/appUtils';
import { APP_SETTINGS_KEY } from '../types';
import type { AppSettings } from '../types';

interface UseEditorZoomOptions {
  editorAreaRef: MutableRefObject<HTMLDivElement | null>;
  setAppSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export function useEditorZoom({ editorAreaRef, setAppSettings }: UseEditorZoomOptions) {
  const clampedSet = (delta: number) => {
    setAppSettings((prev) => {
      const next = Math.max(EDITOR_FONT_SIZE_MIN, Math.min(EDITOR_FONT_SIZE_MAX, prev.editorFontSize + delta));
      if (next === prev.editorFontSize) return prev;
      const updated = { ...prev, editorFontSize: next };
      localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  function zoomEditor(delta: number) {
    clampedSet(delta);
  }

  function resetEditorZoom() {
    setAppSettings((prev) => {
      if (prev.editorFontSize === DEFAULT_EDITOR_FONT_SIZE) return prev;
      const updated = { ...prev, editorFontSize: DEFAULT_EDITOR_FONT_SIZE };
      localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(updated));
      return updated;
    });
  }

  // Ctrl/Cmd + scroll to zoom the editor
  useEffect(() => {
    const el = editorAreaRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      const step = e.deltaY < 0 ? 1 : -1;
      clampedSet(step);
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  // editorAreaRef.current is stable (assigned on first render)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { zoomEditor, resetEditorZoom };
}
