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
import { makeId } from './ids';
import { getPageLabel, normalizeTrackedUrl } from './urls';
import { getBudgetRemainingCents, getContextBreakdown, getOperationsMax, moneyFromCents, normalizeCents } from './budget';

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
    textSpendCents: 0,
    contextExpansionSpendCents: 0,
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
    notes: [],
    draft: {
      committedText: ''
    },
    trace: []
  };
}

export function hydrateSession(input: unknown): AgentSession {
  const fallback = createEmptySession();
  const source = isRecord(input) ? input : {};
  const session = fallback;

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
  session.textSpendCents = nonNegativeNumberFrom(source.textSpendCents);
  session.contextExpansionSpendCents = nonNegativeNumberFrom(source.contextExpansionSpendCents);
  session.activeTabId = nullableIntegerFrom(source.activeTabId);
  session.activeUrl = stringFrom(source.activeUrl);
  session.activeTitle = stringFrom(source.activeTitle);
  session.noteCaptureLockedTabId = nullableIntegerFrom(source.noteCaptureLockedTabId);
  session.noteCaptureLockedUrl = stringFrom(source.noteCaptureLockedUrl);
  session.noteCaptureQueueIndex = nullableIntegerFrom(source.noteCaptureQueueIndex);
  session.candidateSetFinalized = source.candidateSetFinalized === true;
  if (session.phase === Phase.RETRIEVAL || session.phase === Phase.INSPECTION) {
    session.phase = session.candidateSetFinalized ? Phase.INSPECTION : Phase.RETRIEVAL;
  }
  session.lastTrackedNavigationUrl = stringFrom(source.lastTrackedNavigationUrl);
  session.navigationChain = stringArrayFrom(source.navigationChain).filter(Boolean);
  session.rankCandidates = rankCandidatesFrom(source.rankCandidates);
  session.notes = notesFrom(source.notes);
  session.draft = draftFrom(source.draft);
  session.trace = Array.isArray(source.trace) ? source.trace.filter(isTraceEntryLike) : [];

  if (source.textSpendCents === undefined) {
    // Legacy records combined text and capacity. Recover the split at the historical
    // $1 expansion price, preserving actual spending rather than repricing the run.
    const combinedSpend = session.contextExpansionSpendCents;
    const expansionCount = session.trace.filter(entry => entry.kind === TraceKind.CONTEXT_EXPANSION).length;
    session.contextExpansionSpendCents = Math.min(combinedSpend, expansionCount * 100);
    session.textSpendCents = normalizeCents(combinedSpend - session.contextExpansionSpendCents);
  }

  if (
    session.noteCaptureQueueIndex !== null
    && (session.noteCaptureQueueIndex < 0 || session.noteCaptureQueueIndex >= session.rankCandidates.length)
  ) {
    session.noteCaptureQueueIndex = null;
  }

  return session;
}

export function hasCommittedNoteForSource(session: AgentSession | null, url = ''): boolean {
  const target = normalizeTrackedUrl(url);
  return !!target && !!session?.notes.some(note => normalizeTrackedUrl(note.sourceUrl) === target);
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
      textSpendCents: session.textSpendCents,
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
        committedText: stringFrom(note.committedText)
      };
    })
    .filter((note): note is NoteBlock => Boolean(note));
}

function draftFrom(value: unknown): DraftState {
  if (!isRecord(value)) return { committedText: '' };
  return {
    committedText: stringFrom(value.committedText)
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
