// Source of truth moved to @pvsmartinez/shared
import { useState, useRef, useEffect } from 'react';

/**
 * Local drag-to-resize for sidebar and AI panel.
 * Sidebar: min 48px (icon mode), max 480px.
 * AI panel: min 260px, max 900px.
 */
export function useDragResize(
  initialSidebarWidth = 220,
  initialPanelWidth = 340,
) {
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
  const [aiPanelWidth, setAiPanelWidth] = useState(initialPanelWidth);

  const draggingRef = useRef<null | 'sidebar' | 'ai'>(null);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!draggingRef.current) return;
      const delta = e.clientX - dragStartX.current;
      if (draggingRef.current === 'sidebar') {
        setSidebarWidth(Math.max(48, Math.min(480, dragStartWidth.current + delta)));
      } else {
        // Panel resizes from its left edge — dragging left increases width
        setAiPanelWidth(Math.max(260, Math.min(900, dragStartWidth.current - delta)));
      }
    }
    function onMouseUp() {
      if (!draggingRef.current) return;
      draggingRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.classList.remove('is-resizing');
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  function startSidebarDrag(e: React.MouseEvent) {
    draggingRef.current = 'sidebar';
    dragStartX.current = e.clientX;
    dragStartWidth.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.body.classList.add('is-resizing');
  }

  function startAiDrag(e: React.MouseEvent) {
    draggingRef.current = 'ai';
    dragStartX.current = e.clientX;
    dragStartWidth.current = aiPanelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.body.classList.add('is-resizing');
  }

  return { sidebarWidth, setSidebarWidth, aiPanelWidth, startSidebarDrag, startAiDrag };
}
