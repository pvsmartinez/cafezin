import { describe, expect, it } from 'vitest';

import { filterToolsByIntent, inferToolIntent } from '../services/ai/toolIntents';
import type { ToolDefinition } from '../utils/tools/shared';
import { estimateToolDefsTokens } from '../services/copilot/tokenBudget';

function tool(name: string): ToolDefinition {
  return {
    type: 'function',
    function: { name, description: `desc ${name}`, parameters: { type: 'object', properties: {} } },
  };
}

const TOOLS: ToolDefinition[] = [
  tool('read_workspace_file'),
  tool('write_workspace_file'),
  tool('remember'),
  tool('manage_memory'),
  tool('export_workspace'),
  tool('configure_export_targets'),
  tool('configure_workspace'),
  tool('save_desktop_task'),
  tool('delete_workspace_file'),
  tool('rename_workspace_file'),
  tool('scaffold_workspace'),
];

const mkMsg = (role: 'user' | 'assistant' | 'system', content: string) => ({ role, content });

describe('filterToolsByIntent', () => {
  it('returns [] for a bare greeting with no injected context', () => {
    expect(filterToolsByIntent(TOOLS, [mkMsg('user', 'oi')])).toEqual([]);
  });

  it('keeps everything for a generic working message', () => {
    const names = filterToolsByIntent(TOOLS, [mkMsg('user', 'reescreve o capítulo 3 do livro')]).map(
      (t) => t.function.name,
    );
    expect(names).toContain('read_workspace_file');
    expect(names).toContain('write_workspace_file');
  });

  it('drops memory tools unless the message implies memory', () => {
    const withoutMemory = filterToolsByIntent(TOOLS, [mkMsg('user', 'escreve um resumo do arquivo')]);
    expect(withoutMemory.some((t) => t.function.name === 'remember')).toBe(false);

    const withMemory = filterToolsByIntent(TOOLS, [mkMsg('user', 'lembra que eu prefiro português')]);
    expect(withMemory.some((t) => t.function.name === 'remember')).toBe(true);
  });

  it('drops export tools unless the message implies export', () => {
    const withoutExport = filterToolsByIntent(TOOLS, [mkMsg('user', 'melhora a introdução')]);
    expect(withoutExport.some((t) => t.function.name === 'export_workspace')).toBe(false);

    const withExport = filterToolsByIntent(TOOLS, [mkMsg('user', 'gerar pdf do livro')]);
    expect(withExport.some((t) => t.function.name === 'export_workspace')).toBe(true);
  });

  it('drops destructive tools unless the user asks for a destructive mutation', () => {
    const safe = filterToolsByIntent(TOOLS, [mkMsg('user', 'ajusta o título do slide')]);
    expect(safe.some((t) => t.function.name === 'delete_workspace_file')).toBe(false);

    const destructive = filterToolsByIntent(TOOLS, [mkMsg('user', 'apaga o arquivo rascunho.md')]);
    expect(destructive.some((t) => t.function.name === 'delete_workspace_file')).toBe(true);
  });

  it('ignores synthetic vision-injection user messages when inferring intent', () => {
    const intent = inferToolIntent([
      mkMsg('user', 'cria os slides'),
      mkMsg('assistant', 'usando canvas_op'),
      mkMsg('user', 'canvas screenshot after'),
    ]);
    expect(intent.isExport).toBe(false);
    expect(intent.isMemory).toBe(false);
  });
});

describe('estimateToolDefsTokens', () => {
  it('returns 0 for empty/undefined tool lists', () => {
    expect(estimateToolDefsTokens([])).toBe(0);
    expect(estimateToolDefsTokens(undefined as unknown as unknown[])).toBe(0);
  });

  it('returns a positive estimate proportional to serialized size', () => {
    const serialized = JSON.stringify(TOOLS);
    const expected = Math.ceil(serialized.length / 4);
    expect(estimateToolDefsTokens(TOOLS)).toBe(expected);
    expect(estimateToolDefsTokens(TOOLS)).toBeGreaterThan(0);
  });
});
