import { invoke } from '@tauri-apps/api/core';

export interface RagBuildSummary {
  available: boolean;
  model: string;
  schemaVersion: string;
  builtAt?: string | null;
  filesIndexed: number;
  chunksIndexed: number;
  filesScanned: number;
  filesUpdated: number;
  filesRemoved: number;
}

export interface RagSearchHit {
  path: string;
  size: number;
  outline: string;
  chunkType: string;
  title?: string | null;
  startLine: number;
  endLine: number;
  snippet: string;
  semanticScore: number;
  lexicalScore: number;
  combinedScore: number;
  supportingMatches: number;
}

export interface RagSearchResult {
  available: boolean;
  model: string;
  builtAt?: string | null;
  filesIndexed: number;
  chunksIndexed: number;
  hits: RagSearchHit[];
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function rebuildWorkspaceRagIndex(workspacePath: string): Promise<RagBuildSummary | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<RagBuildSummary>('rag_rebuild_index', { workspacePath });
  } catch {
    return null;
  }
}

export async function searchWorkspaceRag(
  workspacePath: string,
  query: string,
  options: {
    limit?: number;
    activeFile?: string;
    recentFiles?: string[];
  } = {},
): Promise<RagSearchResult | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<RagSearchResult>('rag_search', {
      workspacePath,
      query,
      limit: options.limit ?? 10,
      activeFile: options.activeFile,
      recentFiles: options.recentFiles ?? [],
    });
  } catch {
    return null;
  }
}
