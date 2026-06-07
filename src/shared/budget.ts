import {
  AgentSession,
  ContextBreakdown,
  CONTEXT_EXPANSION_TOKENS,
  OPERATION_COST_CENTS,
  TOKEN_COST_CENTS_PER_TOKEN
} from './types';

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
    task: session.task,
    notesText,
    draftText: session.draft?.committedText || ''
  });
}

export function moneyFromCents(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatMoneyPrecise(cents: number): string {
  return formatMoney(cents);
}

export function roundCents(cents: number): number {
  return Math.round(Number(cents || 0));
}

export function getTokenCostCents(tokens = 0): number {
  const safeTokens = Math.max(0, Number(tokens) || 0);
  return roundCents(safeTokens * TOKEN_COST_CENTS_PER_TOKEN);
}

export const CONTEXT_EXPANSION_COST_CENTS = getTokenCostCents(CONTEXT_EXPANSION_TOKENS);

export function getBudgetRemainingCents(session: AgentSession): number {
  return roundCents(Math.max(0, session.budgetCents - session.spendCents));
}

export function getOperationsMax(session: AgentSession): number {
  const remaining = getBudgetRemainingCents(session);
  const estimatedRemaining = OPERATION_COST_CENTS > 0 ? Math.floor(remaining / OPERATION_COST_CENTS) : 0;
  return Math.max(session.operationsUsed, session.operationsUsed + estimatedRemaining);
}
