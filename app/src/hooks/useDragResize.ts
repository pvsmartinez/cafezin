// Source of truth moved to @pvsmartinez/shared
import { useState, useRef, useEffect } from 'react';

/**
 * Local drag-to-resize for sidebar and AI panel.
 * Sidebar: min 48px (icon mode), max 480px.
 * AI panel: snaps to collapsed mode when dragged narrow enough.
 */

const AI_PANEL_COLLAPSED_WIDTH = 40;
const AI_PANEL_MIN_EXPANDED_WIDTH = 260;
const AI_PANEL_COLLAPSE_THRESHOLD = 140;
const AI_PANEL_MAX_WIDTH = 900;

export function useDragResize(
  initialSidebarWidth = 220,
  initialPanelWidth = 340,
) {
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
  const [aiPanelWidth, setAiPanelWidth] = useState(initialPanelWidth);
  const [aiPanelCollapsed, setAiPanelCollapsed] = useState(false);

  const draggingRef = useRef<null | 'sidebar' | 'ai'>(null);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const lastExpandedAiWidthRef = useRef(Math.max(AI_PANEL_MIN_EXPANDED_WIDTH, initialPanelWidth));

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!draggingRef.current) return;
      const delta = e.clientX - dragStartX.current;
      if (draggingRef.current === 'sidebar') {
        setSidebarWidth(Math.max(48, Math.min(480, dragStartWidth.current + delta)));
      } else {
        // Panel resizes from its left edge — dragging left increases width
        const rawWidth = Math.min(AI_PANEL_MAX_WIDTH, dragStartWidth.current - delta);
        if (rawWidth <= AI_PANEL_COLLAPSE_THRESHOLD) {
          setAiPanelCollapsed(true);
          setAiPanelWidth(AI_PANEL_COLLAPSED_WIDTH);
          return;
        }

        const expandedWidth = Math.max(AI_PANEL_MIN_EXPANDED_WIDTH, rawWidth);
        lastExpandedAiWidthRef.current = expandedWidth;
        setAiPanelCollapsed(false);
        setAiPanelWidth(expandedWidth);
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

  function collapseAiPanel() {
    if (!aiPanelCollapsed) lastExpandedAiWidthRef.current = aiPanelWidth;
    setAiPanelCollapsed(true);
    setAiPanelWidth(AI_PANEL_COLLAPSED_WIDTH);
  }

  function expandAiPanel() {
    const nextWidth = Math.max(AI_PANEL_MIN_EXPANDED_WIDTH, lastExpandedAiWidthRef.current);
    setAiPanelCollapsed(false);
    setAiPanelWidth(nextWidth);
  }

  return {
    sidebarWidth,
    setSidebarWidth,
    aiPanelWidth,
    aiPanelCollapsed,
    startSidebarDrag,
    startAiDrag,
    collapseAiPanel,
    expandAiPanel,
  };
}
