/**
 * Unit tests for the risk gate logic (applyRiskGate) and the risk mapping
 * (getToolRiskLevel). These are fully deterministic — no LLM required.
 *
 * Run: cd cafezin/app && npx vitest run --reporter=verbose riskGate
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyRiskGate } from '../utils/riskGate';
import { getToolRiskLevel } from '../utils/toolRisk';
import type { RiskLevel } from '../utils/toolRisk';
import type { ToolExecutor } from '../utils/tools/shared';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeExecutor(): { executor: ToolExecutor; calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const executor: ToolExecutor = vi.fn(async (name, args) => {
    calls.push({ name, args });
    return `ok:${name}`;
  });
  return { executor, calls };
}

function makeAskUser(answer: string): (q: string, opts?: string[]) => Promise<string> {
  return vi.fn().mockResolvedValue(answer);
}

// ── Tool risk mapping ─────────────────────────────────────────────────────────

describe('getToolRiskLevel', () => {
  it('classifies read tools as low', () => {
    expect(getToolRiskLevel('read_workspace_file')).toBe('low');
    expect(getToolRiskLevel('list_workspace_files')).toBe('low');
    expect(getToolRiskLevel('search_workspace')).toBe('low');
    expect(getToolRiskLevel('web_search')).toBe('low');
    expect(getToolRiskLevel('fetch_url')).toBe('low');
    expect(getToolRiskLevel('canvas_screenshot')).toBe('low');
  });

  it('classifies write/edit tools as low', () => {
    expect(getToolRiskLevel('write_workspace_file')).toBe('low');
    expect(getToolRiskLevel('patch_workspace_file')).toBe('low');
    expect(getToolRiskLevel('multi_patch')).toBe('low');
    expect(getToolRiskLevel('canvas_op')).toBe('low');
    expect(getToolRiskLevel('write_spreadsheet')).toBe('low');
    expect(getToolRiskLevel('create_task')).toBe('low');
    expect(getToolRiskLevel('update_task_step')).toBe('low');
    expect(getToolRiskLevel('list_tasks')).toBe('low');
  });

  it('classifies structural tools as medium', () => {
    expect(getToolRiskLevel('rename_workspace_file')).toBe('medium');
    expect(getToolRiskLevel('scaffold_workspace')).toBe('medium');
  });

  it('classifies destructive tools as high', () => {
    expect(getToolRiskLevel('delete_workspace_file')).toBe('high');
    expect(getToolRiskLevel('run_command')).toBe('high');
    expect(getToolRiskLevel('publish_vercel')).toBe('high');
  });

  it('defaults unknown tools to medium (safe fallback)', () => {
    expect(getToolRiskLevel('some_unknown_future_tool')).toBe('medium');
  });
});

// ── applyRiskGate — low risk ──────────────────────────────────────────────────

describe('applyRiskGate — low-risk tools', () => {
  it('passes through without prompting the user', async () => {
    const { executor, calls } = makeExecutor();
    const onAskUser = makeAskUser('');
    const gated = applyRiskGate(executor, { onAskUser, sessionGranted: new Set() });

    const result = await gated('read_workspace_file', { path: 'notes.md' });

    expect(result).toBe('ok:read_workspace_file');
    expect(calls).toHaveLength(1);
    expect(onAskUser).not.toHaveBeenCalled();
  });

  it('passes write_workspace_file without prompting', async () => {
    const { executor } = makeExecutor();
    const onAskUser = makeAskUser('');
    const gated = applyRiskGate(executor, { onAskUser, sessionGranted: new Set() });

    await gated('write_workspace_file', { path: 'file.md', content: 'hello' });
    expect(onAskUser).not.toHaveBeenCalled();
  });
});

// ── applyRiskGate — medium risk, no prior grant ───────────────────────────────

describe('applyRiskGate — medium-risk, no prior grant', () => {
  it('prompts the user before executing', async () => {
    const { executor, calls } = makeExecutor();
    const onAskUser = makeAskUser('Permitir nesta sessão');
    const gated = applyRiskGate(executor, { onAskUser, sessionGranted: new Set() });

    await gated('rename_workspace_file', { from: 'a.md', to: 'b.md' });

    expect(onAskUser).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(1); // executed after grant
  });

  it('blocks the tool when user denies', async () => {
    const { executor, calls } = makeExecutor();
    const onAskUser = makeAskUser('Não permitir');
    const gated = applyRiskGate(executor, { onAskUser, sessionGranted: new Set() });

    const result = await gated('rename_workspace_file', { from: 'a.md', to: 'b.md' });

    expect(result).toContain('bloqueada');
    expect(calls).toHaveLength(0);
  });

  it('blocks the tool when user sends empty string (dialog dismissed)', async () => {
    const { executor, calls } = makeExecutor();
    const onAskUser = makeAskUser('');
    const gated = applyRiskGate(executor, { onAskUser, sessionGranted: new Set() });

    const result = await gated('rename_workspace_file', {});

    expect(result).toContain('bloqueada');
    expect(calls).toHaveLength(0);
  });
});

// ── applyRiskGate — session grant ─────────────────────────────────────────────

describe('applyRiskGate — session-level grant', () => {
  it('skips the prompt on second call after session grant', async () => {
    const { executor } = makeExecutor();
    const onAskUser = makeAskUser('Permitir nesta sessão');
    const sessionGranted: Set<RiskLevel> = new Set();
    const gated = applyRiskGate(executor, { onAskUser, sessionGranted });

    await gated('rename_workspace_file', { from: 'a.md', to: 'b.md' });
    await gated('rename_workspace_file', { from: 'b.md', to: 'c.md' });

    // onAskUser should only have been called ONCE (first call)
    expect(onAskUser).toHaveBeenCalledOnce();
    expect(sessionGranted.has('medium')).toBe(true);
  });

  it('session grant for medium does not unlock high', async () => {
    const { executor } = makeExecutor();
    const denyHigh = vi.fn().mockResolvedValue('Não permitir');
    const sessionGranted: Set<RiskLevel> = new Set<RiskLevel>(['medium']); // pre-granted
    const gated = applyRiskGate(executor, { onAskUser: denyHigh, sessionGranted });

    await gated('delete_workspace_file', { path: 'secret.md' });

    // high-risk tool must still prompt even when medium is granted
    expect(denyHigh).toHaveBeenCalledOnce();
  });
});

// ── applyRiskGate — forever (workspace) grant ─────────────────────────────────

describe('applyRiskGate — forever workspace grant', () => {
  it('skips prompt when riskPermissions.medium is "forever"', async () => {
    const { executor, calls } = makeExecutor();
    const onAskUser = makeAskUser('');
    const gated = applyRiskGate(executor, {
      onAskUser,
      sessionGranted: new Set(),
      workspaceConfig: { name: 'test', riskPermissions: { medium: 'forever' } },
    });

    await gated('rename_workspace_file', { from: 'a.md', to: 'b.md' });
    expect(onAskUser).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it('persists forever grant to workspace config', async () => {
    const { executor } = makeExecutor();
    const onAskUser = makeAskUser('Permitir sempre (este workspace)');
    const onWorkspaceConfigChange = vi.fn();
    const gated = applyRiskGate(executor, {
      onAskUser,
      sessionGranted: new Set(),
      workspaceConfig: { name: 'test' },
      onWorkspaceConfigChange,
    });

    await gated('delete_workspace_file', { path: 'old.md' });

    expect(onWorkspaceConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        riskPermissions: expect.objectContaining({ high: 'forever' }),
      }),
    );
  });

  it('merges forever grant with existing riskPermissions', async () => {
    const { executor } = makeExecutor();
    const onAskUser = makeAskUser('Permitir sempre (este workspace)');
    const onWorkspaceConfigChange = vi.fn();
    const gated = applyRiskGate(executor, {
      onAskUser,
      sessionGranted: new Set(),
      workspaceConfig: { name: 'test', riskPermissions: { medium: 'forever' } },
      onWorkspaceConfigChange,
    });

    await gated('delete_workspace_file', { path: 'old.md' });

    expect(onWorkspaceConfigChange).toHaveBeenCalledWith({
      riskPermissions: { medium: 'forever', high: 'forever' },
    });
  });

  it('skips prompt when riskPermissions.high is "forever"', async () => {
    const { executor } = makeExecutor();
    const onAskUser = makeAskUser('');
    const gated = applyRiskGate(executor, {
      onAskUser,
      sessionGranted: new Set(),
      workspaceConfig: { name: 'test', riskPermissions: { high: 'forever' } },
    });

    await gated('run_command', { command: 'echo hello' });
    expect(onAskUser).not.toHaveBeenCalled();
  });
});

// ── applyRiskGate — high risk ─────────────────────────────────────────────────

describe('applyRiskGate — high-risk tools', () => {
  it('prompts for delete_workspace_file', async () => {
    const { executor } = makeExecutor();
    const onAskUser = makeAskUser('Permitir nesta sessão');
    const gated = applyRiskGate(executor, { onAskUser, sessionGranted: new Set() });

    await gated('delete_workspace_file', { path: 'notes.md' });
    expect(onAskUser).toHaveBeenCalledOnce();
    const [question] = (onAskUser as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(question).toContain('notes.md');
  });

  it('prompts for run_command and includes command in question', async () => {
    const { executor } = makeExecutor();
    const onAskUser = makeAskUser('Permitir nesta sessão');
    const gated = applyRiskGate(executor, { onAskUser, sessionGranted: new Set() });

    await gated('run_command', { command: 'rm -rf /' });
    const [question] = (onAskUser as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(question).toContain('rm -rf /');
  });

  it('prompts for publish_vercel', async () => {
    const { executor } = makeExecutor();
    const onAskUser = makeAskUser('Não permitir');
    const gated = applyRiskGate(executor, { onAskUser, sessionGranted: new Set() });

    const result = await gated('publish_vercel', { projectName: 'my-site' });
    expect(result).toContain('bloqueada');
    expect(onAskUser).toHaveBeenCalledOnce();
  });
});
