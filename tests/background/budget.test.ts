import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSession, createEmptySession, Phase, SessionState, STORAGE_KEY, TraceKind } from '../../src/shared';
import { createChromeMock, dispatchRuntimeMessage } from '../helpers/chrome';

async function budgetSession(overrides: Partial<AgentSession> = {}) {
  const harness = createChromeMock({ tabs: [{ id: 1, url: 'https://example.com/source', title: 'Source', active: true }] });
  harness.store[STORAGE_KEY] = {
    ...createEmptySession(), sessionState: SessionState.ACTIVE, phase: Phase.NOTE_CAPTURE,
    activeTabId: 1, activeUrl: 'https://example.com/source', ...overrides
  };
  vi.stubGlobal('chrome', harness.chrome);
  await import('../../src/background/service-worker');
  return harness;
}

describe('budget transactions', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('charges the initial search once even when a new run opens the same query already in the tab', async () => {
    const harness = await budgetSession();
    await dispatchRuntimeMessage(harness, { type: 'SAVE_TASK_BANK_SETTINGS', payload: {
      useCustomTasks: true,
      tasks: [{ id: 'audio', requesterQuestion: 'How can we preserve audio?', workOrder: 'Compare preservation methods.', searchQuery: 'preserving audio' }]
    } });
    const url = 'https://www.google.com/search?q=preserving%20audio';
    await harness.chrome.tabs.update(1, { url });
    const started = await dispatchRuntimeMessage(harness, { type: 'START_SESSION' });
    expect(started.session).toMatchObject({ spendCents: 0, operationsUsed: 0 });
    await harness.events.webNavigationOnCommitted.trigger({
      tabId: 1, url, frameId: 0, transitionType: 'generated', transitionQualifiers: []
    } as unknown as chrome.webNavigation.WebNavigationTransitionCallbackDetails);
    for (const status of ['loading', 'complete'] as const) {
      await harness.events.tabsOnUpdated.trigger(1, { status, url }, { id: 1, url, title: 'Results', active: true } as chrome.tabs.Tab);
    }
    const after = (await dispatchRuntimeMessage(harness, { type: 'GET_SESSION' })).session!;
    expect(after).toMatchObject({ spendCents: 10, operationsUsed: 1, textSpendCents: 0, contextExpansionSpendCents: 0 });
    expect(after.trace.filter(entry => entry.kind === TraceKind.SEARCH)).toHaveLength(1);
  });

  it.each(['COMMIT_NOTE_BLOCK', 'COMMIT_DRAFT'] as const)('charges %s for positive text growth and every commit, without refunds', async type => {
    const harness = await budgetSession({ phase: type === 'COMMIT_DRAFT' ? Phase.DELIVERABLE : Phase.NOTE_CAPTURE });
    for (const [committedText, spendCents, textSpendCents] of [
      ['one', 10.1, 0.1], ['one two three', 20.3, 0.3],
      ['new words here', 30.3, 0.3], ['shorter', 40.3, 0.3], ['grow again', 50.4, 0.4]
    ] as const) {
      const saved = await dispatchRuntimeMessage(harness, type === 'COMMIT_NOTE_BLOCK'
        ? { type, payload: { id: 'note', committedText } }
        : { type, payload: { committedText } });
      expect(saved).toMatchObject({ ok: true, session: { spendCents, textSpendCents, contextExpansionSpendCents: 0 } });
    }
    if (type === 'COMMIT_NOTE_BLOCK') {
      const deleted = await dispatchRuntimeMessage(harness, { type: 'DELETE_NOTE_BLOCK', payload: { id: 'note' } });
      expect(deleted.session).toMatchObject({ spendCents: 50.4, textSpendCents: 0.4, operationsUsed: 5, notes: [] });
    }
  });

  it('charges the same text amount when ten words are committed individually or together', async () => {
    const harness = await budgetSession();
    const original = structuredClone(harness.store[STORAGE_KEY]);
    for (let words = 1; words <= 10; words++) {
      expect((await dispatchRuntimeMessage(harness, {
        type: 'COMMIT_NOTE_BLOCK', payload: { id: 'note', committedText: Array(words).fill('word').join(' ') }
      })).ok).toBe(true);
    }
    expect(harness.store[STORAGE_KEY]).toMatchObject({ spendCents: 101, textSpendCents: 1, operationsUsed: 10 });
    harness.store[STORAGE_KEY] = original;
    const together = await dispatchRuntimeMessage(harness, {
      type: 'COMMIT_NOTE_BLOCK', payload: { committedText: Array(10).fill('word').join(' ') }
    });
    expect(together.session).toMatchObject({ spendCents: 11, textSpendCents: 1, operationsUsed: 1 });
  });

  it.each(['COMMIT_NOTE_BLOCK', 'COMMIT_DRAFT'] as const)('enforces the fractional budget boundary atomically for %s', async type => {
    const harness = await budgetSession({ spendCents: 990, phase: type === 'COMMIT_DRAFT' ? Phase.DELIVERABLE : Phase.NOTE_CAPTURE });
    const before = structuredClone(harness.store[STORAGE_KEY]);
    const message = { type, payload: { committedText: 'word' } };
    expect(await dispatchRuntimeMessage(harness, message)).toMatchObject({ ok: false, error: 'OUT_OF_BUDGET' });
    expect(harness.store[STORAGE_KEY]).toEqual(before);
    harness.store[STORAGE_KEY] = { ...(before as AgentSession), spendCents: 989.9 };
    expect(await dispatchRuntimeMessage(harness, message)).toMatchObject({
      ok: true, session: { spendCents: 1000, textSpendCents: 0.1, operationsUsed: 1 }
    });
  });

  it('charges exactly $1 for capacity, independently of text and action charges', async () => {
    const harness = await budgetSession({ spendCents: 900.1, textSpendCents: 0.1 });
    const before = structuredClone(harness.store[STORAGE_KEY]);
    expect(await dispatchRuntimeMessage(harness, { type: 'EXPAND_CONTEXT' })).toMatchObject({ ok: false, error: 'OUT_OF_BUDGET' });
    expect(harness.store[STORAGE_KEY]).toEqual(before);
    harness.store[STORAGE_KEY] = { ...(before as AgentSession), spendCents: 900 };
    expect(await dispatchRuntimeMessage(harness, { type: 'EXPAND_CONTEXT' })).toMatchObject({
      ok: true, session: { spendCents: 1000, textSpendCents: 0.1, contextExpansionSpendCents: 100, contextMax: 600, operationsUsed: 0 }
    });
  });

  it('allows entry to the deliverable at an exhausted budget without charging an action', async () => {
    const harness = await budgetSession({
      spendCents: 1000, operationsUsed: 20, candidateSetFinalized: true,
      rankCandidates: [{ id: 'source', url: 'https://example.com/source', title: 'Source' }],
      notes: [{ id: 'note', sourceUrl: 'https://example.com/source', sourceTitle: 'Source', committedText: 'Evidence' }]
    });
    const response = await dispatchRuntimeMessage(harness, { type: 'ENTER_DELIVERABLE' });
    expect(response).toMatchObject({ ok: true, session: { phase: Phase.DELIVERABLE, spendCents: 1000, operationsUsed: 20 } });
    expect(response.session?.trace.at(-1)?.kind).toBe(TraceKind.DRAFT_PHASE_ENTER);
  });

  it('retains fractional spending across storage, completion and JSON export', async () => {
    const harness = await budgetSession({ phase: Phase.DELIVERABLE });
    await dispatchRuntimeMessage(harness, { type: 'COMMIT_DRAFT', payload: { committedText: 'word' } });
    expect((await dispatchRuntimeMessage(harness, { type: 'GET_SESSION' })).session).toMatchObject({ spendCents: 10.1, textSpendCents: 0.1 });
    const completed = await dispatchRuntimeMessage(harness, { type: 'COMPLETE_SESSION' });
    expect(JSON.parse(JSON.stringify(completed.export))).toMatchObject({
      spendCents: 10.1, stats: { budgetRemainingCents: 989.9, estimatedSpend: 0.101, textSpendCents: 0.1, contextExpansionSpendCents: 0 }
    });
  });

  it('persists the legacy spending split once and uses current prices for the next commit', async () => {
    const harness = await budgetSession();
    const { textSpendCents: _, ...legacy } = harness.store[STORAGE_KEY] as AgentSession;
    harness.store[STORAGE_KEY] = {
      ...legacy, spendCents: 237, contextExpansionSpendCents: 226, contextMax: 600, operationsUsed: 11,
      trace: [{ id: 'expansion', at: 1, kind: TraceKind.CONTEXT_EXPANSION, detail: 'Expanded context', phase: Phase.NOTE_CAPTURE }]
    };
    await dispatchRuntimeMessage(harness, { type: 'GET_SESSION' });
    expect(harness.store[STORAGE_KEY]).toMatchObject({ spendCents: 237, textSpendCents: 126, contextExpansionSpendCents: 100 });
    const committed = await dispatchRuntimeMessage(harness, { type: 'COMMIT_NOTE_BLOCK', payload: { committedText: 'word' } });
    expect(committed).toMatchObject({
      ok: true, session: { spendCents: 247.1, textSpendCents: 126.1, contextExpansionSpendCents: 100, operationsUsed: 12 }
    });
    expect(harness.store[STORAGE_KEY]).toEqual(committed.session);
  });
});
