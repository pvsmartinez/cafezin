import { describe, expect, it } from 'vitest';
import {
  detectAgentCapabilitiesFromFileTree,
  getAgentCapabilityState,
  getAgentWorkspaceProfile,
  isToolEnabledByWorkspace,
} from '../utils/agentCapabilities';
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
  });

  it('keeps web search available in a markdown/empty workspace without HTML files', () => {
    const markdownSource = {
      config: { name: 'Livro' },
      fileTree: [file('01_Manuscript/chapter-01.md'), file('notes/outline.md')],
    };
    const markdownWorkspace = getAgentCapabilityState(markdownSource);
    expect(markdownWorkspace.search).toBe(true);
    expect(markdownWorkspace.development).toBe(false);

    const emptyWorkspace = getAgentCapabilityState({ name: 'Vazio' });
    expect(emptyWorkspace.search).toBe(true);
    expect(emptyWorkspace.development).toBe(false);
    expect(emptyWorkspace.web).toBe(false);

    expect(isToolEnabledByWorkspace('web_search', markdownSource)).toBe(true);
    expect(isToolEnabledByWorkspace('fetch_url', markdownSource)).toBe(true);
    expect(isToolEnabledByWorkspace('search_images', markdownSource)).toBe(true);
  });

  it('keeps run_command/publish_vercel unavailable (removed development tools)', () => {
    const source = {
      config: { name: 'App' },
      fileTree: [
        file('package.json'),
        file('src/App.tsx'),
        file('src/main.tsx'),
        file('src/utils.ts'),
        file('src/data.ts'),
        file('src/lib.ts'),
        file('src/view.tsx'),
        file('src/api.ts'),
      ],
    };

    const state = getAgentCapabilityState(source);
    expect(state.development).toBe(false);
    expect(isToolEnabledByWorkspace('run_command', source)).toBe(false);
    expect(isToolEnabledByWorkspace('publish_vercel', source)).toBe(false);
    expect(isToolEnabledByWorkspace('canvas_op', source)).toBe(false);
    expect(isToolEnabledByWorkspace('write_spreadsheet', source)).toBe(false);

    expect(state.web).toBe(false);
  });

  it('does not resurrect removed tools from old development overrides', () => {
    const markdownTree = [
      file('01_Manuscript/chapter-01.md'),
      file('01_Manuscript/chapter-02.md'),
      file('notes/outline.md'),
      file('notes/characters.md'),
      file('notes/research.md'),
      file('notes/timeline.md'),
    ];

    const optInSource = {
      config: { name: 'Livro', features: { development: { agentTools: true } } },
      fileTree: markdownTree,
    };
    const optIn = getAgentCapabilityState(optInSource);
    expect(optIn.development).toBe(false);
    expect(isToolEnabledByWorkspace('run_command', optInSource)).toBe(false);

    const codeTree = [
      file('package.json'),
      file('src/a.ts'),
      file('src/b.ts'),
      file('src/c.ts'),
      file('src/d.ts'),
      file('src/e.ts'),
      file('src/f.ts'),
      file('src/g.ts'),
    ];
    const optOutSource = {
      config: { name: 'App', features: { development: { agentTools: false } } },
      fileTree: codeTree,
    };
    const optOut = getAgentCapabilityState(optOutSource);
    expect(optOut.development).toBe(false);
  });

  it('disables web search via the existing features.web.agentTools=false override', () => {
    const source = {
      config: { name: 'Livro', features: { web: { agentTools: false } } },
      fileTree: [file('notes/outline.md')],
    };
    const state = getAgentCapabilityState(source);
    expect(state.search).toBe(false);
    expect(isToolEnabledByWorkspace('web_search', source)).toBe(false);
    expect(isToolEnabledByWorkspace('fetch_url', source)).toBe(false);
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
    expect(detected.web).toBe(true); // HTML file still drives the web guidance capability
    expect(detected.search).toBe(true);
    expect(detected.canvas).toBeUndefined();
  });

  it('detects a long-form writing workspace from many chapter-like markdown files', () => {
    const profile = getAgentWorkspaceProfile({
      config: { name: 'Livro' },
      fileTree: [
        file('01_Manuscript/chapter-01.md'),
        file('01_Manuscript/chapter-02.md'),
        file('01_Manuscript/chapter-03.md'),
        file('01_Manuscript/chapter-04.md'),
        file('notes/outline.md'),
        file('notes/characters.md'),
      ],
    });

    expect(profile.longFormWriting).toBe(true);
    expect(profile.codeWorkspace).toBe(false);
  });

  it('detects a code workspace from project markers and source files', () => {
    const profile = getAgentWorkspaceProfile({
      config: { name: 'App' },
      fileTree: [
        file('package.json'),
        file('tsconfig.json'),
        file('src/App.tsx'),
        file('src/main.tsx'),
        file('src/utils.ts'),
        file('src/data.ts'),
        file('src/lib.ts'),
        file('src/view.tsx'),
      ],
    });

    expect(profile.codeWorkspace).toBe(true);
    expect(profile.longFormWriting).toBe(false);
  });
});
