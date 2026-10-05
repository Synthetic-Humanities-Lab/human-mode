import {
  AgentSession,
  ContextBreakdown,
  OPERATION_COST_CENTS,
  TOKEN_COST_CENTS_PER_TOKEN
} from './types';
import { getTaskContextText } from './task-bank';

export function roughTokenCount(text: string | null | undefined): number {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export function getContextBreakdownFromParts(parts: {
  task?: string;
  notesText?: string;
  draftText?: string;
}): ContextBreakdown {
  const task = roughTokenCount(parts.task);
  const notes = roughTokenCount(parts.notesText);
  const draft = roughTokenCount(parts.draftText);
  return { task, notes, draft, total: task + notes + draft };
}

export function getContextBreakdown(session: AgentSession): ContextBreakdown {
  const notesText = (session.notes || []).map(note => note.committedText || '').join('\n');
  return getContextBreakdownFromParts({
    task: getTaskContextText(session),
    notesText,
    draftText: session.draft?.committedText || ''
  });
}

export function moneyFromCents(cents: number): number {
  return Number((normalizeCents(cents) / 100).toFixed(3));
}

export function formatMoney(cents: number): string {
  const normalized = normalizeCents(cents);
  return `$${(normalized / 100).toFixed(Number.isInteger(normalized) ? 2 : 3)}`;
}

// Stored amounts remain in cents, with one decimal place for $0.001 charges.
export function normalizeCents(cents: number): number {
  return Math.round(cents * 10) / 10;
}

export function getTokenCostCents(tokens = 0): number {
  const safeTokens = Math.max(0, Number(tokens) || 0);
  return normalizeCents(safeTokens * TOKEN_COST_CENTS_PER_TOKEN);
}

export function getBudgetRemainingCents(session: AgentSession): number {
  return normalizeCents(Math.max(0, session.budgetCents - session.spendCents));
}

export function getOperationsMax(session: AgentSession): number {
  const remaining = getBudgetRemainingCents(session);
  const estimatedRemaining = OPERATION_COST_CENTS > 0 ? Math.floor(remaining / OPERATION_COST_CENTS) : 0;
  return Math.max(session.operationsUsed, session.operationsUsed + estimatedRemaining);
}
