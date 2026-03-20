import { describe, expect, it } from 'vitest';
import { detectAgentCapabilitiesFromFileTree, getAgentCapabilityState } from '../utils/agentCapabilities';
import type { FileTreeNode, WorkspaceConfig, WorkspaceIndex } from '../types';

const file = (path: string): FileTreeNode => ({
  name: path.split('/').pop() ?? path,
  path,
  isDirectory: false,
});

describe('agentCapabilities', () => {
  it('detects markdown mermaid support automatically when the workspace index marks Mermaid content', () => {
    const workspaceIndex: WorkspaceIndex = {
      version: 3,
      builtAt: new Date().toISOString(),
      entries: [
        { path: 'docs/roteiro.md', size: 100, mtime: 1, outline: '# Roteiro\n  [mermaid]\n  (20 words)' },
      ],
    };

    const state = getAgentCapabilityState({
      config: { name: 'Cafezin' },
      fileTree: [file('docs/roteiro.md'), file('landing/index.html')],
      workspaceIndex,
    });

    expect(state.markdownMermaid).toBe(true);
    expect(state.web).toBe(true);
    expect(state.canvas).toBe(false);
  });

  it('respects manual markdown mermaid overrides', () => {
    const configOn: WorkspaceConfig = {
      name: 'Cafezin',
      features: {
        markdown: { mermaid: true },
      },
    };
    const configOff: WorkspaceConfig = {
      name: 'Cafezin',
      features: {
        markdown: { mermaid: false },
      },
    };

    expect(getAgentCapabilityState(configOn).markdownMermaid).toBe(true);
    expect(getAgentCapabilityState(configOff).markdownMermaid).toBe(false);
  });

  it('falls back to disabled in automatic mode when no compatible files exist', () => {
    const state = getAgentCapabilityState({
      config: { name: 'Cafezin' },
      fileTree: [file('src/lib.rs')],
    });

    expect(state.markdownMermaid).toBe(false);
  });

  it('still detects non-markdown capabilities from the file tree', () => {
    const detected = detectAgentCapabilitiesFromFileTree([
      file('boards/aula.tldr.json'),
      file('site/index.html'),
      file('dados/base.csv'),
    ]);

    expect(detected.markdownMermaid).toBe(false);
    expect(detected.canvas).toBe(true);
    expect(detected.web).toBe(true);
    expect(detected.spreadsheet).toBe(true);
  });
});