import { describe, expect, it } from 'vitest';
import { shouldBlockPdfNavigation } from '../../src/content/navigation';
import { Phase, SessionState, createEmptySession } from '../../src/shared';

describe('content navigation guard', () => {
  it('blocks direct PDFs only during active candidate collection', () => {
    const session = createEmptySession();
    session.sessionState = SessionState.ACTIVE;
    session.phase = Phase.RETRIEVAL;

    expect(shouldBlockPdfNavigation(session, 'https://example.com/report.PDF?download=1#page=4')).toBe(true);
    expect(shouldBlockPdfNavigation(session, 'https://example.com/article')).toBe(false);

    session.phase = Phase.INSPECTION;
    expect(shouldBlockPdfNavigation(session, 'https://example.com/report%2Epdf')).toBe(true);

    session.phase = Phase.NOTE_CAPTURE;
    expect(shouldBlockPdfNavigation(session, 'https://example.com/report.pdf')).toBe(false);

    session.phase = Phase.RETRIEVAL;
    session.sessionState = SessionState.PAUSED;
    expect(shouldBlockPdfNavigation(session, 'https://example.com/report.pdf')).toBe(false);
  });
});
