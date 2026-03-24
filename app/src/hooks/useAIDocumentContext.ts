import { useState, useEffect } from 'react';
import type { Editor as TldrawEditor } from 'tldraw';

interface UseAIDocumentContextParams {
  activeFile: string | null;
  fileTypeKind: string | undefined;
  canvasEditorRef: React.MutableRefObject<TldrawEditor | null>;
  content: string;
}

// Captures a document context snapshot for the AI panel.
//
// We snapshot only when the active file or its type changes (tab switch, new file,
// canvas ↔ markdown). Content freshness at send-time is provided by
// getAgentContextSnapshot() reading tabContentsRef directly. Avoiding keystroke-driven
// renders keeps:
//   • CodeMirror from reconfiguring (live preview stays alive)
//   • spell-check attributes stable (no Grammarly fight)
//   • AgentSession from DOM-reconciling (text selection in AI panel stays stable)
//
// Canvas editor is never ready at component init, so the initializer always falls
// through to the markdown fallback — the effect sets the real value.
export function useAIDocumentContext({
  activeFile,
  fileTypeKind,
  canvasEditorRef,
  content,
}: UseAIDocumentContextParams) {
  // canvasEditorRef is a ref — intentionally not in deps (changes don't trigger re-render).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const [aiDocumentContext, setAiDocumentContext] = useState(() =>
    fileTypeKind === 'canvas'
      ? `Canvas file: ${activeFile ?? ''} (loading\u2026)`
      : content
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (fileTypeKind === 'canvas') {
      if (!canvasEditorRef.current) {
        setAiDocumentContext(`Canvas file: ${activeFile ?? ''} (loading\u2026)`);
        return;
      }
      const editor = canvasEditorRef.current;
      const file   = activeFile ?? '';
      // Dynamic import keeps tldraw out of the main bundle.
      // By the time this effect fires, CanvasEditor (which statically imports
      // tldraw) is already mounted, so the import resolves from cache instantly.
      import('../utils/canvasAISummary').then(({ canvasAIContext }) => {
        if (canvasEditorRef.current === editor) {
          setAiDocumentContext(canvasAIContext(editor, file));
        }
      });
    } else {
      setAiDocumentContext(content);
    }
  // Only snapshot when file identity changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile, fileTypeKind]);

  return { aiDocumentContext };
}
