import { describe, expect, it } from 'vitest';
import { createEmptySession, makeSessionExport, Phase, SessionState, TraceKind, hydrateSession } from '../../src/shared';

describe('session model', () => {
  it.each([SessionState.ACTIVE, SessionState.COMPLETED])('splits legacy %s spending once without repricing previous work', state => {
    const { textSpendCents: _, ...legacy } = createEmptySession();
    const input = {
      ...legacy, sessionState: state, spendCents: 237, contextExpansionSpendCents: 226,
      operationsUsed: 11, contextMax: 600,
      trace: [{ id: 'expansion', at: 1, kind: TraceKind.CONTEXT_EXPANSION, detail: 'Expanded context', phase: Phase.DELIVERABLE }]
    };
    const migrated = hydrateSession(input);
    expect(migrated).toMatchObject({ spendCents: 237, textSpendCents: 126, contextExpansionSpendCents: 100, operationsUsed: 11 });
    expect(hydrateSession(migrated)).toEqual(migrated);
    expect(makeSessionExport(migrated, state)).toMatchObject({ spendCents: 237, stats: { estimatedSpend: 2.37, textSpendCents: 126, contextExpansionSpendCents: 100 } });
  });

  it('retains text spending from a legacy session without expansions', () => {
    expect(hydrateSession({ spendCents: 17, contextExpansionSpendCents: 12 })).toMatchObject({
      spendCents: 17, textSpendCents: 12, contextExpansionSpendCents: 0
    });
  });

  it('bounds the recovered capacity charge by the recorded combined amount', () => {
    expect(hydrateSession({ spendCents: 20, contextExpansionSpendCents: 10,
      trace: [{ id: 'expansion', at: 1, kind: TraceKind.CONTEXT_EXPANSION, detail: 'Expanded context', phase: Phase.DELIVERABLE }]
    })).toMatchObject({ spendCents: 20, textSpendCents: 0, contextExpansionSpendCents: 10 });
  });

  it('restores stored sessions while migrating legacy values and discarding invalid fields', () => {
    const hydrated = hydrateSession({
      sessionRunId: 'run_legacy',
      sessionState: SessionState.ACTIVE,
      phase: Phase.FRAMING,
      task: 'Legacy work order', currentSearchQuery: 'legacy query',
      sessionPlan: {}, unknownField: true, spendCents: -1,
      rankCandidates: [{ id: 'candidate_a', url: 'https://example.com/a#frag', title: 'A' }]
    });

    expect(hydrated.sessionRunId).toBe('run_legacy');
    expect(hydrated.phase).toBe(Phase.RETRIEVAL);
    expect(hydrated.rankCandidates[0]?.url).toBe('https://example.com/a');
    expect(hydrated.workOrder).toBe('Legacy work order');
    expect(hydrated.taskSearchQuery).toBe('legacy query');
    expect(hydrated.spendCents).toBe(0);
    for (const key of ['currentSearchQuery', 'sessionPlan', 'unknownField']) expect(hydrated).not.toHaveProperty(key);

    expect(hydrateSession({ ...hydrated, phase: Phase.INSPECTION }).phase).toBe(Phase.RETRIEVAL);
    expect(hydrateSession({ ...hydrated, candidateSetFinalized: true }).phase).toBe(Phase.INSPECTION);
  });
});
