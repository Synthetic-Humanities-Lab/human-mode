import { describe, expect, it } from 'vitest';
import {
  Phase,
  SessionState,
  TraceKind,
  createEmptySession,
  getContextBreakdown,
  getOperationsMax,
  hydrateSession,
  makeSessionExport,
  rankCandidatesInNoteCaptureOrder,
  reconcileNoteCaptureRankOrder
} from '../../src/shared';

describe('session model', () => {
  it('hydrates older framing sessions into the current retrieval phase', () => {
    const hydrated = hydrateSession({
      sessionRunId: 'run_legacy',
      sessionState: SessionState.ACTIVE,
      phase: Phase.FRAMING,
      rankCandidates: [{ id: 'candidate_a', url: 'https://example.com/a#frag', title: 'A' }],
      noteCaptureRankOrder: []
    });

    expect(hydrated.sessionRunId).toBe('run_legacy');
    expect(hydrated.phase).toBe(Phase.RETRIEVAL);
    expect(hydrated.rankCandidates[0]?.url).toBe('https://example.com/a');
    expect(hydrated.noteCaptureRankOrder).toEqual(['candidate_a']);
  });

  it('reconciles candidate order without dropping new candidates', () => {
    const session = createEmptySession();
    session.rankCandidates = [
      { id: 'candidate_a', url: 'https://example.com/a', title: 'A' },
      { id: 'candidate_b', url: 'https://example.com/b', title: 'B' }
    ];
    session.noteCaptureRankOrder = ['candidate_b'];

    reconcileNoteCaptureRankOrder(session);

    expect(rankCandidatesInNoteCaptureOrder(session).map(candidate => candidate.id)).toEqual(['candidate_b', 'candidate_a']);
  });

  it('accounts for context and export statistics', () => {
    const session = createEmptySession();
    session.sessionState = SessionState.COMPLETED;
    session.requesterQuestion = 'Why?';
    session.workOrder = 'Do thing.';
    session.task = session.workOrder;
    session.notes = [{ id: 'note_1', sourceUrl: 'https://example.com', sourceTitle: 'Example', committedText: 'one useful note', updatedAt: 1 }];
    session.draft = { committedText: 'final draft', updatedAt: 2 };
    session.trace = [
      { id: 'trace_1', at: 1, kind: TraceKind.NOTE_COMMIT, detail: 'note', phase: Phase.NOTE_CAPTURE },
      { id: 'trace_2', at: 2, kind: TraceKind.DRAFT_COMMIT, detail: 'draft', phase: Phase.DELIVERABLE }
    ];

    expect(getContextBreakdown(session).total).toBe(13);
    expect(getOperationsMax(session)).toBeGreaterThanOrEqual(session.operationsUsed);

    const exported = makeSessionExport(session, SessionState.COMPLETED);
    expect(exported.stats.notesCommitted).toBe(1);
    expect(exported.deliverable).toBe('final draft');
    expect(exported.requesterQuestion).toBe('Why?');
    expect(exported.workOrder).toBe('Do thing.');
  });
});
