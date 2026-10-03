import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSession, createEmptySession, Phase, RuntimeMessage, SessionState, STORAGE_KEY, TraceKind } from '../../src/shared';
import { createChromeMock, dispatchRuntimeMessage } from '../helpers/chrome';

async function captureSession(queueIndex = 0) {
  const harness = createChromeMock({ tabs: [
    { id: 1, url: `https://example.com/source-${queueIndex}`, title: 'Source', active: true },
    { id: 2, url: 'https://example.com/other', title: 'Other', active: false }
  ] });
  const session: AgentSession = {
    ...createEmptySession(),
    sessionState: SessionState.ACTIVE,
    phase: Phase.NOTE_CAPTURE,
    activeTabId: 1,
    activeUrl: `https://example.com/source-${queueIndex}`,
    activeTitle: `Source ${queueIndex}`,
    noteCaptureLockedTabId: 1,
    noteCaptureLockedUrl: `https://example.com/source-${queueIndex}`,
    noteCaptureQueueIndex: queueIndex,
    candidateSetFinalized: true,
    rankCandidates: [0, 1].map(index => ({ id: `source-${index}`, url: `https://example.com/source-${index}`, title: `Source ${index}` })),
    notes: [{ id: 'first', sourceUrl: 'https://example.com/source-0', sourceTitle: 'Source 0', committedText: 'First source evidence.' }]
  };
  harness.store[STORAGE_KEY] = session;
  vi.stubGlobal('chrome', harness.chrome);
  await import('../../src/background/service-worker');
  return { ...harness, initialSession: structuredClone(session) };
}

describe('session interruption and concurrent writes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([0, 1])('resumes source %i after browsing elsewhere while paused', async queueIndex => {
    const harness = await captureSession(queueIndex);
    const paused = await dispatchRuntimeMessage(harness, { type: 'PAUSE_SESSION' });
    expect(paused.session).toMatchObject({
      sessionState: SessionState.PAUSED,
      noteCaptureQueueIndex: queueIndex,
      noteCaptureLockedTabId: 1,
      noteCaptureLockedUrl: harness.initialSession.activeUrl
    });

    await harness.chrome.tabs.update(1, { url: 'https://example.com/away' });
    const updateCount = harness.updates.length;
    await harness.events.webNavigationOnCommitted.trigger({
      tabId: 1, url: 'https://example.com/away', frameId: 0, transitionType: 'typed', transitionQualifiers: []
    } as unknown as chrome.webNavigation.WebNavigationTransitionCallbackDetails);
    await harness.events.tabsOnUpdated.trigger(1, { status: 'complete', url: 'https://example.com/away' },
      { id: 1, url: 'https://example.com/away', title: 'Away', active: true } as chrome.tabs.Tab);
    expect(harness.updates).toHaveLength(updateCount);
    await harness.chrome.tabs.update(2, { active: true });

    const resumed = await dispatchRuntimeMessage(harness, { type: 'RESUME_SESSION' });
    expect(resumed).toMatchObject({ ok: true, session: {
      sessionState: SessionState.ACTIVE, noteCaptureQueueIndex: queueIndex,
      noteCaptureLockedUrl: harness.initialSession.activeUrl, activeTabId: 1
    } });
    expect(await harness.chrome.tabs.get(1)).toMatchObject({ url: harness.initialSession.activeUrl, active: true });
    expect(resumed.session?.spendCents).toBe(paused.session!.spendCents + 1);
    expect(resumed.session?.notes).toEqual(harness.initialSession.notes);

    if (queueIndex === 0) {
      const next = await dispatchRuntimeMessage(harness, { type: 'NEXT_NOTE_CAPTURE_SOURCE' });
      expect(next).toMatchObject({ ok: true, session: { noteCaptureQueueIndex: 1, noteCaptureLockedUrl: 'https://example.com/source-1' } });
    } else {
      await dispatchRuntimeMessage(harness, { type: 'COMMIT_NOTE_BLOCK', payload: { id: 'second', committedText: 'Second source evidence.' } });
      expect(await dispatchRuntimeMessage(harness, { type: 'ENTER_DELIVERABLE' })).toMatchObject({ ok: true, session: { phase: Phase.DELIVERABLE } });
    }
  });

  it('recovers a source position from a session paused by the previous build', async () => {
    const harness = await captureSession(1);
    harness.store[STORAGE_KEY] = { ...harness.initialSession, sessionState: SessionState.PAUSED,
      noteCaptureQueueIndex: null, noteCaptureLockedUrl: '', noteCaptureLockedTabId: null };
    expect(await dispatchRuntimeMessage(harness, { type: 'RESUME_SESSION' })).toMatchObject({
      ok: true, session: { noteCaptureQueueIndex: 1, noteCaptureLockedUrl: 'https://example.com/source-1', noteCaptureLockedTabId: 1 }
    });
  });

  it('uses the current tab if the paused source tab was closed', async () => {
    const harness = await captureSession();
    await dispatchRuntimeMessage(harness, { type: 'PAUSE_SESSION' });
    await harness.chrome.tabs.remove(1);
    await harness.chrome.tabs.update(2, { active: true });
    expect(await dispatchRuntimeMessage(harness, { type: 'RESUME_SESSION' })).toMatchObject({
      ok: true, session: { activeTabId: 2, noteCaptureLockedTabId: 2, noteCaptureLockedUrl: 'https://example.com/source-0' }
    });
    expect(await harness.chrome.tabs.get(2)).toMatchObject({ url: 'https://example.com/source-0' });
  });

  it('keeps the session paused without spending when its source cannot be recovered', async () => {
    const harness = await captureSession();
    const paused = { ...harness.initialSession, sessionState: SessionState.PAUSED,
      noteCaptureQueueIndex: null, noteCaptureLockedUrl: '', activeUrl: 'https://example.com/unknown' };
    harness.store[STORAGE_KEY] = paused;
    expect(await dispatchRuntimeMessage(harness, { type: 'RESUME_SESSION' })).toMatchObject({ ok: false, error: 'NOTE_CAPTURE_SOURCE_UNAVAILABLE' });
    expect(harness.store[STORAGE_KEY]).toEqual(paused);
    expect(harness.updates).toEqual([]);
  });

  it('keeps the session paused when the resume charge exceeds its remaining budget', async () => {
    const harness = await captureSession();
    const paused = { ...harness.initialSession, sessionState: SessionState.PAUSED, spendCents: harness.initialSession.budgetCents };
    harness.store[STORAGE_KEY] = paused;
    expect(await dispatchRuntimeMessage(harness, { type: 'RESUME_SESSION' })).toMatchObject({ ok: false, error: 'OUT_OF_BUDGET', session: paused });
    expect(harness.store[STORAGE_KEY]).toEqual(paused);
    expect(harness.updates).toEqual([]);
  });

  it('keeps the session paused without spending when no browser tab is available', async () => {
    const harness = await captureSession();
    const paused = await dispatchRuntimeMessage(harness, { type: 'PAUSE_SESSION' });
    await harness.chrome.tabs.remove(1);
    await harness.chrome.tabs.remove(2);
    expect(await dispatchRuntimeMessage(harness, { type: 'RESUME_SESSION' })).toMatchObject({ ok: false, error: 'NO_ACTIVE_TAB' });
    expect(harness.store[STORAGE_KEY]).toEqual(paused.session);
  });

  it('keeps the session paused without spending if Chrome rejects source restoration', async () => {
    const harness = await captureSession();
    const paused = await dispatchRuntimeMessage(harness, { type: 'PAUSE_SESSION' });
    await harness.chrome.tabs.update(1, { url: 'https://example.com/away' });
    vi.spyOn(harness.chrome.tabs, 'update').mockRejectedValueOnce(new Error('Tab closed'));
    expect(await dispatchRuntimeMessage(harness, { type: 'RESUME_SESSION' })).toMatchObject({
      ok: false, error: 'NOTE_CAPTURE_TAB_UNAVAILABLE', session: paused.session
    });
    expect(harness.store[STORAGE_KEY]).toEqual(paused.session);
    expect((await dispatchRuntimeMessage(harness, { type: 'RESUME_SESSION' })).ok).toBe(true);
  });

  it('rejects duplicate pause and resume requests without extra charges or trace entries', async () => {
    const harness = await captureSession();
    const paused = await dispatchRuntimeMessage(harness, { type: 'PAUSE_SESSION' });
    expect(await dispatchRuntimeMessage(harness, { type: 'PAUSE_SESSION' })).toMatchObject({
      ok: false, error: 'SESSION_NOT_ACTIVE', session: paused.session
    });
    const resumed = await dispatchRuntimeMessage(harness, { type: 'RESUME_SESSION' });
    expect(await dispatchRuntimeMessage(harness, { type: 'RESUME_SESSION' })).toMatchObject({
      ok: false, error: 'SESSION_NOT_PAUSED', session: resumed.session
    });
    expect(harness.store[STORAGE_KEY]).toEqual(resumed.session);
    expect(resumed.session?.operationsUsed).toBe(1);
  });

  it('retains both concurrent note saves and accounts for both charges', async () => {
    const harness = await captureSession();
    const replies = await Promise.all(['one', 'two'].map(id => dispatchRuntimeMessage(harness, {
      type: 'COMMIT_NOTE_BLOCK', payload: { id, committedText: `Evidence ${id}` }
    })));
    expect(replies.map(reply => reply.ok)).toEqual([true, true]);
    const stored = (await dispatchRuntimeMessage(harness, { type: 'GET_SESSION' })).session!;
    expect(stored.notes.map(note => note.id)).toEqual(['first', 'one', 'two']);
    expect(stored.operationsUsed).toBe(2);
    expect(stored.spendCents).toBe(6);
  });

  it('includes a preceding concurrent draft save in the completed export and storage', async () => {
    const harness = await captureSession();
    harness.store[STORAGE_KEY] = { ...harness.initialSession, phase: Phase.DELIVERABLE };
    const [saved, finished] = await Promise.all([
      dispatchRuntimeMessage(harness, { type: 'COMMIT_DRAFT', payload: { committedText: 'The final synthesis.' } }),
      dispatchRuntimeMessage(harness, { type: 'COMPLETE_SESSION' })
    ]);
    expect(saved.ok).toBe(true);
    expect(finished).toMatchObject({ ok: true, export: { deliverable: 'The final synthesis.' } });
    const stored = (await dispatchRuntimeMessage(harness, { type: 'GET_SESSION' })).session!;
    expect(stored).toMatchObject({ sessionState: SessionState.COMPLETED, draft: { committedText: 'The final synthesis.' } });
    expect(stored.trace.map(entry => entry.kind)).toEqual([TraceKind.DRAFT_COMMIT, TraceKind.SESSION_COMPLETE]);
  });

  it.each(['COMPLETE_SESSION', 'ABORT_SESSION'] as const)('rejects late writes after %s without altering the final record', async type => {
    const harness = await captureSession();
    const finished = await dispatchRuntimeMessage(harness, { type });
    const lateMessages: RuntimeMessage[] = [
      { type: 'COMMIT_DRAFT', payload: { committedText: 'Too late' } },
      { type: 'COMMIT_NOTE_BLOCK', payload: { committedText: 'Too late' } },
      { type: 'DELETE_NOTE_BLOCK', payload: { id: 'first' } },
      { type: 'EXPAND_CONTEXT' }, { type: 'RESUME_SESSION' }, { type },
      { type: type === 'COMPLETE_SESSION' ? 'ABORT_SESSION' : 'COMPLETE_SESSION' }
    ];
    for (const message of lateMessages) {
      expect(await dispatchRuntimeMessage(harness, message)).toMatchObject({ ok: false, error: 'SESSION_FINISHED' });
    }
    expect((await dispatchRuntimeMessage(harness, { type: 'GET_SESSION' })).session).toEqual(finished.session);
  });

  it('continues processing queued requests after a storage write rejects', async () => {
    const harness = await captureSession();
    vi.spyOn(harness.chrome.storage.local, 'set').mockRejectedValueOnce(new Error('Storage unavailable'));
    const [failed, saved] = await Promise.all(['failed', 'saved'].map(id => dispatchRuntimeMessage(harness, {
      type: 'COMMIT_NOTE_BLOCK', payload: { id, committedText: id }
    })));
    expect(failed).toMatchObject({ ok: false, error: 'Storage unavailable' });
    expect(saved?.ok).toBe(true);
    expect((await dispatchRuntimeMessage(harness, { type: 'GET_SESSION' })).session?.notes.map(note => note.id)).toEqual(['first', 'saved']);
  });

  it.each(['updated', 'activated', 'highlighted', 'created', 'committed'] as const)('preserves a note saved concurrently with a tab %s event', async event => {
    vi.useFakeTimers();
    const harness = await captureSession();
    const triggers = {
      updated: () => harness.events.tabsOnUpdated.trigger(1, { status: 'complete' },
        { id: 1, url: harness.initialSession.activeUrl, title: 'Updated', active: true } as chrome.tabs.Tab),
      activated: () => harness.events.tabsOnActivated.trigger({ tabId: 1 }),
      highlighted: () => harness.events.tabsOnHighlighted.trigger({ tabIds: [2] }),
      created: () => harness.events.tabsOnCreated.trigger({ id: 2 } as chrome.tabs.Tab),
      committed: () => harness.events.webNavigationOnCommitted.trigger({ tabId: 1, url: 'https://example.com/typed', frameId: 0,
        transitionType: 'typed', transitionQualifiers: [] } as unknown as chrome.webNavigation.WebNavigationTransitionCallbackDetails)
    };
    const navigation = triggers[event]();
    const save = dispatchRuntimeMessage(harness, { type: 'COMMIT_NOTE_BLOCK', payload: { id: 'concurrent', committedText: 'Retain this evidence.' } });
    await vi.runAllTimersAsync();
    await Promise.all([navigation, save]);
    const stored = (await dispatchRuntimeMessage(harness, { type: 'GET_SESSION' })).session!;
    expect(stored.notes.map(note => note.id)).toContain('concurrent');
    expect(stored.trace.filter(entry => entry.kind === TraceKind.NOTE_COMMIT)).toHaveLength(1);
  });
});
