import taskBankJson from './task-bank.json';
import { TaskBankItem } from './types';

export const TASK_BANK = Object.freeze(taskBankJson) as readonly TaskBankItem[];

export function pickRandomTask(): TaskBankItem | null {
  if (!TASK_BANK.length) return null;
  return TASK_BANK[Math.floor(Math.random() * TASK_BANK.length)] || null;
}

export function buildGoogleSearchUrl(query = ''): string {
  const trimmed = String(query || '').trim();
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}
