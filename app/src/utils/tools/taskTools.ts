/**
 * Task tool definitions and executor.
 *
 * Exposes three tools to the agent:
 *   create_task       — define a new tracked task with ordered steps
 *   update_task_step  — advance or annotate a step after completing it
 *   list_tasks        — inspect active or all tasks
 */

import { createTask, updateTaskStep, listTasks } from '../../services/taskService';
import type { TaskStepStatus } from '../../types';
import type { ToolDefinition, DomainExecutor } from './shared';

// ── Tool definitions ─────────────────────────────────────────────────────────

export const TASK_TOOL_DEFS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'create_task',
      description:
        'Create a tracked multi-step task for the current user request. ' +
        'Use this when the goal requires 3 or more distinct steps that will span multiple tool calls or rounds. ' +
        'Each step should be a granular, independently completable action. ' +
        'The task and its progress survive context summarization — it is read from disk, not from chat history. ' +
        'Do NOT call this more than once for the same user goal; instead update the existing task\'s steps with update_task_step.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Short descriptive title for the task (e.g. "Build Aula 03 slide deck").',
          },
          steps: {
            type: 'array',
            items: { type: 'string' },
            description: 'Ordered list of step titles. Each should be a single, concrete action.',
          },
          description: {
            type: 'string',
            description: 'Optional longer description of the task goal.',
          },
        },
        required: ['title', 'steps'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task_step',
      description:
        'Update the status of one step in an existing task. ' +
        'Call this immediately after completing a step (status: "done") or when starting a long step (status: "in-progress"). ' +
        'When a step is no longer needed, mark it "skipped". ' +
        'The task panel in the UI updates automatically.',
      parameters: {
        type: 'object',
        properties: {
          task_id: {
            type: 'string',
            description: 'The task id returned by create_task (e.g. "task-1710000000").',
          },
          step_index: {
            type: 'string',
            description: 'Zero-based index of the step to update.',
          },
          status: {
            type: 'string',
            enum: ['pending', 'in-progress', 'done', 'skipped'],
            description: 'New status for this step.',
          },
          note: {
            type: 'string',
            description: 'Optional short note about what was done or why a step was skipped.',
          },
        },
        required: ['task_id', 'step_index', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description:
        'Return tasks for this workspace as JSON. ' +
        'Use filter="active" to see only in-progress tasks (default). ' +
        'Use filter="all" to see everything including completed tasks.',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            enum: ['active', 'completed', 'all'],
            description: 'Which tasks to return. Defaults to "active".',
          },
        },
        required: [],
      },
    },
  },
];

// ── Executor ─────────────────────────────────────────────────────────────────

export const executeTaskTools: DomainExecutor = async (name, args, ctx) => {
  const { workspacePath, onTaskChanged, agentId } = ctx;

  if (name === 'create_task') {
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    const steps = Array.isArray(args.steps)
      ? (args.steps as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];
    const description = typeof args.description === 'string' ? args.description.trim() : undefined;

    if (!title) return 'Error: title is required.';
    if (steps.length === 0) return 'Error: at least one step is required.';

    const task = await createTask(workspacePath, title, steps, description, agentId);
    onTaskChanged?.();
    return JSON.stringify({
      ok: true,
      task_id: task.id,
      title: task.title,
      steps: task.steps.map((s, i) => ({ index: i, title: s.title, status: s.status })),
    });
  }

  if (name === 'update_task_step') {
    const taskId = typeof args.task_id === 'string' ? args.task_id : '';
    const stepIndex = parseInt(String(args.step_index), 10);
    const status = typeof args.status === 'string' ? (args.status as TaskStepStatus) : 'done';
    const note = typeof args.note === 'string' ? args.note : undefined;

    if (!taskId) return 'Error: task_id is required.';
    if (isNaN(stepIndex)) return 'Error: step_index must be a number.';

    const updated = await updateTaskStep(workspacePath, taskId, stepIndex, status, note);
    if (!updated) return `Error: task "${taskId}" not found or step index ${stepIndex} is out of range.`;
    onTaskChanged?.();

    const doneCount = updated.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
    return JSON.stringify({
      ok: true,
      task_id: updated.id,
      step_index: stepIndex,
      new_status: status,
      progress: `${doneCount}/${updated.steps.length} steps finished`,
      task_completed: !!updated.completedAt,
    });
  }

  if (name === 'list_tasks') {
    const filter = (args.filter as 'active' | 'completed' | 'all' | undefined) ?? 'active';
    const tasks = await listTasks(workspacePath, filter);
    return JSON.stringify(tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      createdAt: t.createdAt,
      completedAt: t.completedAt,
      steps: t.steps.map((s, i) => ({ index: i, title: s.title, status: s.status, note: s.note })),
    })));
  }

  return null;
};
