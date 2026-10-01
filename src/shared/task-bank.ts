import taskBankJson from './task-bank.json';
import { TaskBankItem, DEFAULT_CONTEXT_MAX } from './types';

export const TASK_BANK = Object.freeze(parseCustomTaskBank(taskBankJson));
export const TASK_BANK_SETTINGS_KEY = 'humanModeTaskBankSettings';

export interface TaskBankSettings {
  useCustomTasks: boolean;
  tasks: TaskBankItem[];
}

export function parseCustomTaskBank(input: unknown): TaskBankItem[] {
  if (!Array.isArray(input) || input.length > 100) {
    throw new Error('Use a JSON array with up to 100 tasks');
  }
  const ids = new Set<string>();
  return input.map((entry: unknown, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Task ${index + 1}: provide a question and work order`);
    }
    const source = entry as Record<string, unknown>;
    const readField = (key: string, label: string, max: number): string => {
      const value = typeof source[key] === 'string' ? source[key].trim() : '';
      if (!value || value.length > max) throw new Error(`Task ${index + 1}: ${label} must contain 1–${max} characters`);
      return value;
    };
    const requesterQuestion = readField('requesterQuestion', 'requester question', 2000);
    const task = {
      id: typeof source.id === 'string' && source.id.trim() ? source.id.trim() : `custom_${index + 1}`,
      requesterQuestion,
      workOrder: readField('workOrder', 'operator work order', 4000),
      searchQuery: source.searchQuery === undefined || source.searchQuery === source.requesterQuestion || (typeof source.searchQuery === 'string' && !source.searchQuery.trim())
        ? requesterQuestion
        : readField('searchQuery', 'search query', 500)
    };
    if (task.id.length > 100 || ids.has(task.id)) throw new Error(`Task ${index + 1}: task IDs must be unique and at most 100 characters`);
    ids.add(task.id);
    if (getTaskContextText(task).split(/\s+/).length >= DEFAULT_CONTEXT_MAX) {
      throw new Error(`Task ${index + 1}: shorten the question and work order to leave room in the ${DEFAULT_CONTEXT_MAX}-unit context window`);
    }
    return task;
  });
}

export function parseTaskBankSettings(input: unknown): TaskBankSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid task bank settings');
  const source = input as Record<string, unknown>;
  if (typeof source.useCustomTasks !== 'boolean') throw new Error('Choose a task source');
  const tasks = parseCustomTaskBank(source.tasks);
  if (source.useCustomTasks && !tasks.length) throw new Error('Add at least one task before using your task bank');
  return { useCustomTasks: source.useCustomTasks, tasks };
}

export function getTaskContextText(taskLike: {
  requesterQuestion?: string;
  workOrder?: string;
  task?: string;
}): string {
  const requesterQuestion = String(taskLike.requesterQuestion || '').trim();
  const workOrder = String(taskLike.workOrder || '').trim();
  if (requesterQuestion || workOrder) {
    return [
      'REQUESTER QUESTION',
      requesterQuestion,
      'OPERATOR WORK ORDER',
      workOrder
    ].filter(Boolean).join('\n');
  }
  return String(taskLike.task || '').trim();
}

export function pickRandomTask(tasks: readonly TaskBankItem[] = TASK_BANK): TaskBankItem | null {
  if (!tasks.length) return null;
  return tasks[Math.floor(Math.random() * tasks.length)] || null;
}

export function buildGoogleSearchUrl(query = ''): string {
  const trimmed = String(query || '').trim();
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}
