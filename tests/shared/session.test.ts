import { describe, expect, it } from 'vitest';
import { Phase, SessionState, hydrateSession } from '../../src/shared';

describe('session model', () => {
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
