import taskBankJson from './task-bank.json';
import { TaskBankItem } from './types';

export const TASK_BANK = Object.freeze(taskBankJson) as readonly TaskBankItem[];

export function buildTaskSummary(task: Pick<TaskBankItem, 'workOrder'>): string {
  return String(task.workOrder || '').trim();
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

export function pickRandomTask(): TaskBankItem | null {
  if (!TASK_BANK.length) return null;
  return TASK_BANK[Math.floor(Math.random() * TASK_BANK.length)] || null;
}

export function buildGoogleSearchUrl(query = ''): string {
  const trimmed = String(query || '').trim();
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}
