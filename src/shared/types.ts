export const STORAGE_KEY = 'humanModeSession';
export const LEGACY_STORAGE_KEY = STORAGE_KEY.replace(/^human/, 'agent');

export const SessionState = {
  OFF: 'off',
  ACTIVE: 'active',
  PAUSED: 'paused',
  ABORTED: 'aborted',
  COMPLETED: 'completed'
} as const;

export type SessionState = (typeof SessionState)[keyof typeof SessionState];

export const Phase = {
  START: 'start',
  FRAMING: 'framing',
  RETRIEVAL: 'retrieval',
  INSPECTION: 'inspection',
  NOTE_CAPTURE: 'note_capture',
  DELIVERABLE: 'deliverable'
} as const;

export type Phase = (typeof Phase)[keyof typeof Phase];

export const TraceKind = {
  SESSION_START: 'session_start',
  SESSION_RESUME: 'session_resume',
  SESSION_PAUSE: 'session_pause',
  SESSION_ABORT: 'session_abort',
  SESSION_COMPLETE: 'session_complete',
  SEARCH: 'search',
  OPEN_PAGE: 'open_page',
  BEGIN_NOTE_CAPTURE: 'begin_note_capture',
  NOTE_COMMIT: 'note_commit',
  NOTE_DELETE: 'note_delete',
  NOTE_REVISE_OPEN: 'note_revise_open',
  DRAFT_PHASE_ENTER: 'draft_phase_enter',
  DRAFT_COMMIT: 'draft_commit',
  CONTEXT_EXPANSION: 'context_expansion',
  BLOCKED_ACTION: 'blocked_action',
  PAGE_EXIT_DURING_CAPTURE: 'page_exit_during_capture',
  BLOCKED_TYPED_NAV: 'blocked_typed_nav',
  TAB_SWITCH_PAUSE: 'tab_switch_pause',
  BLOCKED_BACK_NAV: 'blocked_back_nav',
  RANK_CANDIDATE_ADD: 'rank_candidate_add',
  RANK_CANDIDATE_REMOVE: 'rank_candidate_remove',
  RANK_CANDIDATE_REORDER: 'rank_candidate_reorder',
  RANK_CANDIDATE_FINALIZE: 'rank_candidate_finalize',
  NOTE_CAPTURE_NEXT_SOURCE: 'note_capture_next_source'
} as const;

export type TraceKind = (typeof TraceKind)[keyof typeof TraceKind];

export const DEFAULT_CONTEXT_MAX = 750;
export const DEFAULT_BUDGET_CENTS = 1000;
export const CONTEXT_WARNING_THRESHOLD = 0.85;
export const CONTEXT_EXPANSION_TOKENS = 100;
export const TOKEN_COST_CENTS_PER_TOKEN = 1;
export const OPERATION_COST_CENTS = 1;

export interface TaskBankItem {
  id: string;
  task: string;
  searchQuery: string;
}

export interface ContextBreakdown {
  task: number;
  notes: number;
  draft: number;
  total: number;
}

export interface TraceEntry {
  id: string;
  at: number;
  kind: TraceKind;
  detail: string;
  phase: Phase;
}

export interface RankCandidate {
  id: string;
  url: string;
  title: string;
}

export interface NoteBlock {
  id: string;
  sourceUrl: string;
  sourceTitle: string;
  committedText: string;
  updatedAt: number;
}

export interface DraftState {
  committedText: string;
  updatedAt: number;
}

export interface AgentSession {
  sessionRunId: string;
  sessionState: SessionState;
  phase: Phase;
  task: string;
  taskBankTaskId: string;
  taskSearchQuery: string;
  budgetCents: number;
  spendCents: number;
  operationsUsed: number;
  contextMax: number;
  contextExpansionSpendCents: number;
  currentSearchQuery: string;
  activeTabId: number | null;
  activeUrl: string;
  activeTitle: string;
  noteCaptureLockedTabId: number | null;
  noteCaptureLockedUrl: string;
  noteCaptureQueueIndex: number | null;
  candidateSetFinalized: boolean;
  lastTrackedNavigationUrl: string;
  navigationChain: string[];
  rankCandidates: RankCandidate[];
  noteCaptureRankOrder: string[];
  notes: NoteBlock[];
  draft: DraftState;
  trace: TraceEntry[];
  lastUpdatedAt: number;
  estimatedSpend?: number;
  operationsMax?: number;
}

export interface SessionExport {
  outcome: SessionState;
  task: string;
  taskBankTaskId: string;
  taskSearchQuery: string;
  budgetCents: number;
  spendCents: number;
  deliverable: string;
  trace: TraceEntry[];
  stats: {
    finalContextLoad: string;
    operationsUsed: number;
    operationsMax: number;
    budgetRemainingCents: number;
    estimatedSpend: number;
    contextExpansionSpendCents: number;
    notesCommitted: number;
    pagesOpened: number;
    searches: number;
    draftCommits: number;
  };
}

export type RuntimeError =
  | 'CANDIDATE_SET_NOT_FINALIZED'
  | 'CANDIDATES_LOCKED'
  | 'CONTEXT_FULL'
  | 'DUPLICATE_RANK_CANDIDATE'
  | 'EMPTY_NOTE'
  | 'INVALID_CANDIDATE_PAGE'
  | 'MISSING_NOTE_FOR_RANKED_SOURCE'
  | 'MISSING_NOTES_FOR_ALL_RANKED_SOURCES'
  | 'NO_ACTIVE_TAB'
  | 'NO_NEXT_NOTE_CAPTURE_SOURCE'
  | 'NO_RANK_CANDIDATES'
  | 'NOT_IN_NOTE_CAPTURE'
  | 'OUT_OF_BUDGET'
  | 'TASK_BANK_EMPTY'
  | 'UNKNOWN_MESSAGE';
