import { useState, useEffect } from 'react';

interface UseAIDocumentContextParams {
  activeFile: string | null;
  fileTypeKind: string | undefined;
  content: string;
}

// Captures a document context snapshot for the AI panel.
//
// We snapshot only when the active file or its type changes (tab switch, new file).
// Content freshness at send-time is provided by getAgentContextSnapshot() reading
// tabContentsRef directly. Avoiding keystroke-driven renders keeps:
//   • CodeMirror from reconfiguring (live preview stays alive)
//   • spell-check attributes stable (no Grammarly fight)
//   • AgentSession from DOM-reconciling (text selection in AI panel stays stable)
export function useAIDocumentContext({
  activeFile,
  fileTypeKind,
  content,
}: UseAIDocumentContextParams) {
  const [aiDocumentContext, setAiDocumentContext] = useState(content);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setAiDocumentContext(content);
    // Only snapshot when file identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile, fileTypeKind]);

  return { aiDocumentContext };
}
