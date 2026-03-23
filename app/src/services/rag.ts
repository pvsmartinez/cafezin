import { invoke } from '@tauri-apps/api/core';

export interface RagBuildSummary {
  available: boolean;
  model: string;
  schemaVersion: string;
  error?: string;
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
  error?: string;
  builtAt?: string | null;
  filesIndexed: number;
  chunksIndexed: number;
  hits: RagSearchHit[];
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function formatInvokeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function rebuildWorkspaceRagIndex(workspacePath: string): Promise<RagBuildSummary | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<RagBuildSummary>('rag_rebuild_index', { workspacePath });
  } catch (error) {
    const message = formatInvokeError(error);
    console.error('[RAG] rebuild failed:', message);
    return {
      available: false,
      model: 'AllMiniLML6V2',
      schemaVersion: '1',
      error: message,
      filesIndexed: 0,
      chunksIndexed: 0,
      filesScanned: 0,
      filesUpdated: 0,
      filesRemoved: 0,
    };
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
  } catch (error) {
    const message = formatInvokeError(error);
    console.error('[RAG] search failed:', message);
    return {
      available: false,
      model: 'AllMiniLML6V2',
      error: message,
      filesIndexed: 0,
      chunksIndexed: 0,
      hits: [],
    };
  }
}

export async function releaseWorkspaceRagResources(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke('rag_release_resources');
  } catch (error) {
    console.error('[RAG] release failed:', formatInvokeError(error));
  }
}
