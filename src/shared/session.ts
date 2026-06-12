import {
  AgentSession,
  DEFAULT_BUDGET_CENTS,
  DEFAULT_CONTEXT_MAX,
  DraftState,
  NoteBlock,
  Phase,
  RankCandidate,
  SessionExport,
  SessionState,
  TraceKind
} from './types';
import { makeId, now } from './ids';
import { getPageLabel, normalizeTrackedUrl } from './urls';
import { getBudgetRemainingCents, getContextBreakdown, getOperationsMax, moneyFromCents } from './budget';

export function createEmptySession(): AgentSession {
  return {
    sessionRunId: makeId('run'),
    sessionState: SessionState.OFF,
    phase: Phase.START,
    task: '',
    requesterQuestion: '',
    workOrder: '',
    taskBankTaskId: '',
    taskSearchQuery: '',
    budgetCents: DEFAULT_BUDGET_CENTS,
    spendCents: 0,
    operationsUsed: 0,
    contextMax: DEFAULT_CONTEXT_MAX,
    contextExpansionSpendCents: 0,
    currentSearchQuery: '',
    activeTabId: null,
    activeUrl: '',
    activeTitle: '',
    noteCaptureLockedTabId: null,
    noteCaptureLockedUrl: '',
    noteCaptureQueueIndex: null,
    candidateSetFinalized: false,
    lastTrackedNavigationUrl: '',
    navigationChain: [],
    rankCandidates: [],
    noteCaptureRankOrder: [],
    notes: [],
    draft: {
      committedText: '',
      updatedAt: 0
    },
    trace: [],
    lastUpdatedAt: now()
  };
}

export function hydrateSession(input: unknown): AgentSession {
  const fallback = createEmptySession();
  const source = isRecord(input) ? input : {};
  const session = { ...fallback, ...source } as AgentSession & Record<string, unknown>;

  session.sessionRunId = stringFrom(source.sessionRunId, fallback.sessionRunId);
  session.sessionState = enumValue(source.sessionState, Object.values(SessionState), fallback.sessionState);
  session.phase = enumValue(source.phase, Object.values(Phase), fallback.phase);
  if (session.phase === Phase.FRAMING) {
    session.phase = (session.sessionState === SessionState.ACTIVE || session.sessionState === SessionState.PAUSED)
      ? Phase.RETRIEVAL
      : Phase.START;
  }

  session.task = stringFrom(source.task);
  session.requesterQuestion = stringFrom(source.requesterQuestion);
  session.workOrder = stringFrom(source.workOrder, session.task);
  session.task = session.workOrder || session.task;
  session.taskBankTaskId = stringFrom(source.taskBankTaskId);
  session.taskSearchQuery = stringFrom(source.taskSearchQuery, stringFrom(source.currentSearchQuery));
  session.budgetCents = positiveNumberFrom(source.budgetCents, DEFAULT_BUDGET_CENTS);
  session.spendCents = nonNegativeNumberFrom(source.spendCents);
  session.operationsUsed = nonNegativeNumberFrom(source.operationsUsed);
  session.contextMax = positiveNumberFrom(source.contextMax, DEFAULT_CONTEXT_MAX);
  session.contextExpansionSpendCents = nonNegativeNumberFrom(source.contextExpansionSpendCents);
  session.currentSearchQuery = stringFrom(source.currentSearchQuery);
  session.activeTabId = nullableIntegerFrom(source.activeTabId);
  session.activeUrl = stringFrom(source.activeUrl);
  session.activeTitle = stringFrom(source.activeTitle);
  session.noteCaptureLockedTabId = nullableIntegerFrom(source.noteCaptureLockedTabId);
  session.noteCaptureLockedUrl = stringFrom(source.noteCaptureLockedUrl);
  session.noteCaptureQueueIndex = nullableIntegerFrom(source.noteCaptureQueueIndex);
  session.candidateSetFinalized = source.candidateSetFinalized === true;
  session.lastTrackedNavigationUrl = stringFrom(source.lastTrackedNavigationUrl);
  session.navigationChain = stringArrayFrom(source.navigationChain).filter(Boolean);
  session.rankCandidates = rankCandidatesFrom(source.rankCandidates);
  session.noteCaptureRankOrder = stringArrayFrom(source.noteCaptureRankOrder);
  session.notes = notesFrom(source.notes);
  session.draft = draftFrom(source.draft);
  session.trace = Array.isArray(source.trace) ? source.trace.filter(isTraceEntryLike) : [];
  session.lastUpdatedAt = nonNegativeNumberFrom(source.lastUpdatedAt, fallback.lastUpdatedAt);
  delete session.sessionPlan;

  reconcileNoteCaptureRankOrder(session);
  if (
    session.noteCaptureQueueIndex !== null
    && (session.noteCaptureQueueIndex < 0 || session.noteCaptureQueueIndex >= session.rankCandidates.length)
  ) {
    session.noteCaptureQueueIndex = null;
  }

  return session;
}

export function reconcileNoteCaptureRankOrder(session: AgentSession): void {
  const candidates = session.rankCandidates || [];
  if (!Array.isArray(session.noteCaptureRankOrder)) session.noteCaptureRankOrder = [];
  const validIds = new Set(candidates.map(candidate => candidate.id));
  session.noteCaptureRankOrder = session.noteCaptureRankOrder.filter(id => validIds.has(id));
  for (const candidate of candidates) {
    if (!session.noteCaptureRankOrder.includes(candidate.id)) session.noteCaptureRankOrder.push(candidate.id);
  }
}

export function rankCandidatesInNoteCaptureOrder(session: AgentSession): RankCandidate[] {
  const candidates = session.rankCandidates || [];
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const order = Array.isArray(session.noteCaptureRankOrder) ? session.noteCaptureRankOrder : [];
  const ordered = order.map(id => byId.get(id)).filter((candidate): candidate is RankCandidate => Boolean(candidate));
  const seen = new Set(ordered.map(candidate => candidate.id));
  for (const candidate of candidates) {
    if (!seen.has(candidate.id)) ordered.push(candidate);
  }
  return ordered;
}

export function makeSessionExport(session: AgentSession, outcome: SessionState): SessionExport {
  const breakdown = getContextBreakdown(session);
  return {
    outcome,
    task: session.task,
    requesterQuestion: session.requesterQuestion,
    workOrder: session.workOrder,
    taskBankTaskId: session.taskBankTaskId,
    taskSearchQuery: session.taskSearchQuery,
    budgetCents: session.budgetCents,
    spendCents: session.spendCents,
    deliverable: session.draft?.committedText || '',
    trace: session.trace,
    stats: {
      finalContextLoad: `${breakdown.total} / ${session.contextMax}`,
      operationsUsed: session.operationsUsed,
      operationsMax: getOperationsMax(session),
      budgetRemainingCents: getBudgetRemainingCents(session),
      estimatedSpend: moneyFromCents(session.spendCents),
      contextExpansionSpendCents: session.contextExpansionSpendCents,
      notesCommitted: session.trace.filter(item => item.kind === TraceKind.NOTE_COMMIT).length,
      pagesOpened: session.trace.filter(item => item.kind === TraceKind.OPEN_PAGE).length,
      searches: session.trace.filter(item => item.kind === TraceKind.SEARCH).length,
      draftCommits: session.trace.filter(item => item.kind === TraceKind.DRAFT_COMMIT).length
    }
  };
}

function rankCandidatesFrom(value: unknown): RankCandidate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(candidate => {
      if (!isRecord(candidate)) return null;
      const url = normalizeTrackedUrl(stringFrom(candidate.url));
      if (!url) return null;
      return {
        id: stringFrom(candidate.id, makeId('candidate')),
        url,
        title: stringFrom(candidate.title, getPageLabel(url))
      };
    })
    .filter((candidate): candidate is RankCandidate => Boolean(candidate));
}

function notesFrom(value: unknown): NoteBlock[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(note => {
      if (!isRecord(note)) return null;
      return {
        id: stringFrom(note.id, makeId('note')),
        sourceUrl: stringFrom(note.sourceUrl),
        sourceTitle: stringFrom(note.sourceTitle),
        committedText: stringFrom(note.committedText),
        updatedAt: nonNegativeNumberFrom(note.updatedAt)
      };
    })
    .filter((note): note is NoteBlock => Boolean(note));
}

function draftFrom(value: unknown): DraftState {
  if (!isRecord(value)) return { committedText: '', updatedAt: 0 };
  return {
    committedText: stringFrom(value.committedText),
    updatedAt: nonNegativeNumberFrom(value.updatedAt)
  };
}

function isTraceEntryLike(value: unknown): value is AgentSession['trace'][number] {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.at === 'number'
    && typeof value.kind === 'string'
    && typeof value.detail === 'string'
    && typeof value.phase === 'string';
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function stringFrom(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function stringArrayFrom(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function positiveNumberFrom(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeNumberFrom(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function nullableIntegerFrom(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
