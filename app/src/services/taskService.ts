/**
 * Task service — read/write the per-workspace task list.
 *
 * Tasks are stored in `.cafezin/tasks.json` inside the workspace folder and
 * survive context compression (the agent reads them from disk, not from chat).
 */

import { readTextFile, writeTextFile, mkdir, exists } from './fs';
import type { Task, TaskStep, TaskStepStatus } from '../types';

const TASKS_FILENAME = '.cafezin/tasks.json';

// ── Helpers ───────────────────────────────────────────────────────────────────

function tasksPath(workspacePath: string): string {
  return `${workspacePath}/${TASKS_FILENAME}`;
}

export async function loadTasks(workspacePath: string): Promise<Task[]> {
  const p = tasksPath(workspacePath);
  const found = await exists(p).catch(() => false);
  if (!found) return [];
  try {
    const raw = await readTextFile(p);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Task[]) : [];
  } catch {
    return [];
  }
}

async function saveTasks(workspacePath: string, tasks: Task[]): Promise<void> {
  const dir = `${workspacePath}/.cafezin`;
  const dirExists = await exists(dir).catch(() => false);
  if (!dirExists) await mkdir(dir, { recursive: true });
  await writeTextFile(tasksPath(workspacePath), JSON.stringify(tasks, null, 2));
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Create a new task with the given step titles (all initially pending). */
export async function createTask(
  workspacePath: string,
  title: string,
  stepTitles: string[],
  description?: string,
  agentId?: string,
): Promise<Task> {
  const tasks = await loadTasks(workspacePath);
  const steps: TaskStep[] = stepTitles.map((t) => ({ title: t, status: 'pending' as TaskStepStatus }));
  const task: Task = {
    id: `task-${Date.now()}`,
    title,
    description,
    agentId,
    steps,
    createdAt: new Date().toISOString(),
  };
  tasks.unshift(task); // newest first
  await saveTasks(workspacePath, tasks);
  return task;
}

/**
 * Update a single step's status and optional note.
 * Returns the updated task if found, null otherwise.
 */
export async function updateTaskStep(
  workspacePath: string,
  taskId: string,
  stepIndex: number,
  status: TaskStepStatus,
  note?: string,
): Promise<Task | null> {
  const tasks = await loadTasks(workspacePath);
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return null;
  const task = tasks[idx];
  if (stepIndex < 0 || stepIndex >= task.steps.length) return null;

  task.steps[stepIndex] = { ...task.steps[stepIndex], status, ...(note ? { note } : {}) };

  // Mark task completed when all steps are done or skipped
  const allFinished = task.steps.every((s) => s.status === 'done' || s.status === 'skipped');
  if (allFinished && !task.completedAt) {
    task.completedAt = new Date().toISOString();
  }

  tasks[idx] = task;
  await saveTasks(workspacePath, tasks);
  return task;
}

/**
 * Return tasks filtered by state.
 * - 'active'    → not yet completedAt
 * - 'completed' → has completedAt
 * - 'all'       → everything (default)
 */
export async function listTasks(
  workspacePath: string,
  filter: 'active' | 'completed' | 'all' = 'all',
): Promise<Task[]> {
  const tasks = await loadTasks(workspacePath);
  if (filter === 'active') return tasks.filter((t) => !t.completedAt);
  if (filter === 'completed') return tasks.filter((t) => !!t.completedAt);
  return tasks;
}

/** Returns the most recent active task (first non-completed task). */
export async function getActiveTask(workspacePath: string): Promise<Task | null> {
  const tasks = await loadTasks(workspacePath);
  return tasks.find((t) => !t.completedAt) ?? null;
}
