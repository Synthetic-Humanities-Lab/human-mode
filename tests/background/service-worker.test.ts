import { CONTEXT_EXPANSION_COST_CENTS, CONTEXT_EXPANSION_TOKENS, DEFAULT_CONTEXT_MAX, getContextBreakdown, Phase, SessionState, STORAGE_KEY, TASK_BANK_SETTINGS_KEY, TraceKind } from '../../src/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChromeMock, dispatchRuntimeMessage } from '../helpers/chrome';

describe('background service worker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('seeds storage on install and enables side panel behavior', async () => {
    const harness = createChromeMock();
    vi.stubGlobal('chrome', harness.chrome);

    await import('../../src/background/service-worker');
    await harness.events.runtimeOnInstalled.trigger();

    expect(harness.store[STORAGE_KEY]).toBeTruthy();
    expect(harness.panelBehaviors).toEqual([{ openPanelOnActionClick: true }]);
  });

  it('supports a full session flow from start through export', async () => {
    const harness = createChromeMock({
      tabs: [
        {
          id: 1,
          url: 'https://example.com',
          title: 'Example landing page',
          active: true
        }
      ]
    });
    vi.stubGlobal('chrome', harness.chrome);
    const randomValues = [0, 0.11111111, 0.22222222, 0.33333333, 0.44444444];
    let randomCounter = 5;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      const next = randomValues.shift();
      if (typeof next === 'number') return next;
      randomCounter += 1;
      return Math.min(0.9, randomCounter / 100);
    });

    await import('../../src/background/service-worker');

    const started = await dispatchRuntimeMessage(harness, { type: 'START_SESSION' }, { tab: { id: 1 } as chrome.tabs.Tab });
    expect(started.ok).toBe(true);
    expect(started.session?.sessionState).toBe(SessionState.ACTIVE);
    expect(started.session?.phase).toBe(Phase.RETRIEVAL);
    expect(harness.updates.at(-1)?.updateProperties.url).toContain('https://www.google.com/search?q=');

    const addFirst = await dispatchRuntimeMessage(harness, {
      type: 'ADD_RANK_CANDIDATE',
      payload: { url: 'https://example.com/source-a', title: 'Source A' }
    });
    expect(addFirst.ok).toBe(true);

    const addSecond = await dispatchRuntimeMessage(harness, {
      type: 'ADD_RANK_CANDIDATE',
      payload: { url: 'https://example.com/source-b', title: 'Source B' }
    });
    expect(addSecond.ok).toBe(true);
    expect(addSecond.session?.rankCandidates).toHaveLength(2);

    const finalized = await dispatchRuntimeMessage(harness, { type: 'FINALIZE_RANK_CANDIDATES' });
    expect(finalized.ok).toBe(true);
    expect(finalized.session?.candidateSetFinalized).toBe(true);

    const noteCapture = await dispatchRuntimeMessage(harness, {
      type: 'BEGIN_NOTE_CAPTURE',
      payload: { tabId: 1, url: 'https://www.google.com/search?q=test', title: 'Search' }
    }, { tab: { id: 1 } as chrome.tabs.Tab });
    expect(noteCapture.ok).toBe(true);
    expect(noteCapture.session?.phase).toBe(Phase.NOTE_CAPTURE);
    const firstSourceUrl = noteCapture.session?.noteCaptureLockedUrl || '';
    const firstSourceTitle = noteCapture.session?.rankCandidates.find(candidate => candidate.url === firstSourceUrl)?.title || 'Source';
    expect(['https://example.com/source-a', 'https://example.com/source-b']).toContain(firstSourceUrl);

    const committedFirstNote = await dispatchRuntimeMessage(harness, {
      type: 'COMMIT_NOTE_BLOCK',
      payload: {
        committedText: 'Useful evidence from source A',
        sourceUrl: firstSourceUrl,
        sourceTitle: firstSourceTitle
      }
    });
    expect(committedFirstNote.ok).toBe(true);
    expect(committedFirstNote.session?.notes).toHaveLength(1);

    const advanced = await dispatchRuntimeMessage(harness, { type: 'NEXT_NOTE_CAPTURE_SOURCE' });
    expect(advanced.ok).toBe(true);
    expect(advanced.session?.noteCaptureQueueIndex).toBe(1);
    const secondSourceUrl = advanced.session?.noteCaptureLockedUrl || '';
    const secondSourceTitle = advanced.session?.rankCandidates.find(candidate => candidate.url === secondSourceUrl)?.title || 'Source';
    expect(['https://example.com/source-a', 'https://example.com/source-b']).toContain(secondSourceUrl);
    expect(secondSourceUrl).not.toBe('');

    const committedSecondNote = await dispatchRuntimeMessage(harness, {
      type: 'COMMIT_NOTE_BLOCK',
      payload: {
        committedText: 'Useful evidence from source B',
        sourceUrl: secondSourceUrl,
        sourceTitle: secondSourceTitle
      }
    });
    expect(committedSecondNote.ok).toBe(true);
    expect(committedSecondNote.session?.notes).toHaveLength(2);

    const enteredDeliverable = await dispatchRuntimeMessage(harness, { type: 'ENTER_DELIVERABLE' });
    expect(enteredDeliverable.ok).toBe(true);
    expect(enteredDeliverable.session?.phase).toBe(Phase.DELIVERABLE);

    const committedDraft = await dispatchRuntimeMessage(harness, {
      type: 'COMMIT_DRAFT',
      payload: { committedText: 'Final synthesized deliverable.' }
    });
    expect(committedDraft.ok).toBe(true);
    expect(committedDraft.session?.draft?.committedText).toBe('Final synthesized deliverable.');

    const completed = await dispatchRuntimeMessage(harness, { type: 'COMPLETE_SESSION' });
    expect(completed.ok).toBe(true);
    expect(completed.session?.sessionState).toBe(SessionState.COMPLETED);
    expect(completed.export?.deliverable).toBe('Final synthesized deliverable.');
    expect(completed.export?.stats.notesCommitted).toBe(2);
  });

  it('blocks PDF candidates without affecting ordinary HTML candidates', async () => {
    const harness = createChromeMock({
      tabs: [
        {
          id: 1,
          url: 'https://example.com',
          title: 'Example landing page',
          active: true
        }
      ]
    });
    vi.stubGlobal('chrome', harness.chrome);

    await import('../../src/background/service-worker');
    const started = await dispatchRuntimeMessage(harness, { type: 'START_SESSION' }, { tab: { id: 1 } as chrome.tabs.Tab });
    expect(started.ok).toBe(true);
    const updatesBeforePdf = harness.updates.length;

    const blockedPdf = await dispatchRuntimeMessage(harness, {
      type: 'ADD_RANK_CANDIDATE',
      payload: { url: 'https://example.com/research/report.PDF?download=1#page=4', title: 'Report' }
    });
    expect(blockedPdf).toMatchObject({ ok: false, error: 'PDF_TOOL_UNAVAILABLE' });
    expect(blockedPdf.session?.rankCandidates).toHaveLength(0);
    expect(harness.updates).toHaveLength(updatesBeforePdf);

    const addedHtml = await dispatchRuntimeMessage(harness, {
      type: 'ADD_RANK_CANDIDATE',
      payload: { url: 'https://example.com/research/article', title: 'Article' }
    });
    expect(addedHtml.ok).toBe(true);
    expect(addedHtml.session?.rankCandidates).toEqual([
      expect.objectContaining({ url: 'https://example.com/research/article', title: 'Article' })
    ]);
  });

  it('blocks PDF navigation before inspection without changing candidate or operation state', async () => {
    const harness = createChromeMock({
      tabs: [
        {
          id: 1,
          url: 'https://example.com',
          title: 'Example landing page',
          active: true
        }
      ]
    });
    vi.stubGlobal('chrome', harness.chrome);

    await import('../../src/background/service-worker');
    const started = await dispatchRuntimeMessage(harness, { type: 'START_SESSION' }, { tab: { id: 1 } as chrome.tabs.Tab });
    expect(started.ok).toBe(true);
    await harness.events.webNavigationOnCommitted.trigger({
      tabId: 1,
      url: started.session?.activeUrl || '',
      transitionType: 'generated',
      transitionQualifiers: [],
      frameId: 0
    } as unknown as chrome.webNavigation.WebNavigationTransitionCallbackDetails);

    const beforePdf = started.session;
    const pdfUrl = 'https://example.com/research/report.pdf';
    const blockedPdf = await dispatchRuntimeMessage(harness, {
      type: 'BLOCK_PDF_NAVIGATION',
      payload: { url: pdfUrl, title: 'Report' }
    });

    expect(blockedPdf).toMatchObject({ ok: false, error: 'PDF_TOOL_UNAVAILABLE' });
    expect(blockedPdf.session?.phase).toBe(beforePdf?.phase);
    expect(blockedPdf.session?.activeUrl).toBe(beforePdf?.activeUrl);
    expect(blockedPdf.session?.navigationChain).toEqual(beforePdf?.navigationChain);
    expect(blockedPdf.session?.operationsUsed).toBe(beforePdf?.operationsUsed);
    expect(blockedPdf.session?.rankCandidates).toHaveLength(0);

    await harness.events.tabsOnUpdated.trigger(
      1,
      { url: pdfUrl, status: 'loading' },
      { id: 1, url: pdfUrl, title: 'Report', active: true } as chrome.tabs.Tab
    );
    expect(harness.updates.at(-1)?.updateProperties.url).toBe(beforePdf?.activeUrl);

    const afterFallback = await dispatchRuntimeMessage(harness, { type: 'GET_SESSION' });
    expect(afterFallback.session?.phase).toBe(beforePdf?.phase);
    expect(afterFallback.session?.activeUrl).toBe(beforePdf?.activeUrl);
    expect(afterFallback.session?.operationsUsed).toBe(beforePdf?.operationsUsed);
    expect(afterFallback.session?.rankCandidates).toHaveLength(0);
  });

  it('serializes page updates with content status so inspection state is not overwritten', async () => {
    const harness = createChromeMock({
      tabs: [
        {
          id: 1,
          url: 'https://example.com',
          title: 'Example landing page',
          active: true
        }
      ]
    });
    vi.stubGlobal('chrome', harness.chrome);

    await import('../../src/background/service-worker');
    const started = await dispatchRuntimeMessage(harness, { type: 'START_SESSION' }, { tab: { id: 1 } as chrome.tabs.Tab });
    expect(started.ok).toBe(true);
    await harness.events.webNavigationOnCommitted.trigger({
      tabId: 1,
      url: started.session?.activeUrl || '',
      transitionType: 'generated',
      transitionQualifiers: [],
      frameId: 0
    } as unknown as chrome.webNavigation.WebNavigationTransitionCallbackDetails);

    const sourceUrl = 'https://example.com/incident-postmortem';
    const sourceTitle = 'Incident Postmortem Guide';
    const sourceTab = { id: 1, url: sourceUrl, title: sourceTitle, active: true } as chrome.tabs.Tab;
    await Promise.all([
      harness.events.tabsOnUpdated.trigger(1, { url: sourceUrl, status: 'loading' }, sourceTab),
      dispatchRuntimeMessage(
        harness,
        { type: 'CONTENT_STATUS', payload: { url: sourceUrl, title: sourceTitle } },
        { tab: sourceTab }
      )
    ]);

    const afterNavigation = await dispatchRuntimeMessage(harness, { type: 'GET_SESSION' });
    expect(afterNavigation.session?.phase).toBe(Phase.RETRIEVAL);
    expect(afterNavigation.session?.activeUrl).toBe(sourceUrl);
    expect(afterNavigation.session?.activeTitle).toBe(sourceTitle);
    expect(afterNavigation.session?.operationsUsed).toBe((started.session?.operationsUsed || 0) + 1);
  });

  it('preserves both navigations when tab updates arrive together', async () => {
    const harness = createChromeMock({ tabs: [{ id: 1, url: 'https://example.com', title: 'Landing', active: true }] });
    vi.stubGlobal('chrome', harness.chrome);
    await import('../../src/background/service-worker');
    const started = await dispatchRuntimeMessage(harness, { type: 'START_SESSION' }, { tab: { id: 1 } as chrome.tabs.Tab });
    await harness.events.webNavigationOnCommitted.trigger({
      tabId: 1, url: started.session!.activeUrl, frameId: 0, transitionType: 'generated', transitionQualifiers: []
    } as unknown as chrome.webNavigation.WebNavigationTransitionCallbackDetails);
    await Promise.all(['a', 'b'].map(source => harness.events.tabsOnUpdated.trigger(
      1, { status: 'complete', url: `https://example.com/${source}` },
      { id: 1, url: `https://example.com/${source}`, title: source, active: true } as chrome.tabs.Tab
    )));
    const after = await dispatchRuntimeMessage(harness, { type: 'GET_SESSION' });
    expect(after.session?.operationsUsed).toBe(started.session!.operationsUsed + 2);
    expect(after.session?.navigationChain).toContain('https://example.com/a');
    expect(after.session?.navigationChain).toContain('https://example.com/b');
    expect(after.session?.activeUrl).toBe('https://example.com/b');
  });

  it('uses saved custom tasks on the next run and preserves the bank when an invalid save is rejected', async () => {
    const harness = createChromeMock({ tabs: [{ id: 1, url: 'https://example.com', title: 'Landing', active: true }] });
    vi.stubGlobal('chrome', harness.chrome);
    await import('../../src/background/service-worker');
    const task = { id: 'my-task', requesterQuestion: 'How should we preserve audio?', workOrder: 'Compare practical preservation steps', searchQuery: 'How should we preserve audio?' };
    const saved = await dispatchRuntimeMessage(harness, { type: 'SAVE_TASK_BANK_SETTINGS', payload: { useCustomTasks: true, tasks: [task] } });
    expect(saved.ok).toBe(true);
    const started = await dispatchRuntimeMessage(harness, { type: 'START_SESSION' }, { tab: { id: 1 } as chrome.tabs.Tab });
    expect(started.session?.requesterQuestion).toBe(task.requesterQuestion);
    expect(started.session?.taskSearchQuery).toBe(task.searchQuery);
    expect(harness.updates.at(-1)?.updateProperties.url).toBe(`https://www.google.com/search?q=${encodeURIComponent(task.requesterQuestion)}`);
    const invalid = await dispatchRuntimeMessage(harness, { type: 'SAVE_TASK_BANK_SETTINGS', payload: { useCustomTasks: true, tasks: [{ ...task, workOrder: '' }] } });
    expect(invalid.ok).toBe(false);
    expect(harness.store[TASK_BANK_SETTINGS_KEY]).toEqual(saved.settings);
    await dispatchRuntimeMessage(harness, { type: 'SAVE_TASK_BANK_SETTINGS', payload: { useCustomTasks: false, tasks: [task] } });
    expect((await dispatchRuntimeMessage(harness, { type: 'GET_SESSION' })).session?.taskBankTaskId).toBe('my-task');
    await dispatchRuntimeMessage(harness, { type: 'ABORT_SESSION' });
    const restarted = await dispatchRuntimeMessage(harness, { type: 'START_SESSION' }, { tab: { id: 1 } as chrome.tabs.Tab });
    expect(restarted.session?.taskBankTaskId).not.toBe('my-task');
    expect((await dispatchRuntimeMessage(harness, { type: 'GET_TASK_BANK_SETTINGS' })).settings?.tasks).toEqual([task]);
  });

  it('rejects context expansion without changing resources when the budget is too low', async () => {
    const harness = createChromeMock({ tabs: [{ id: 1, url: 'https://example.com', title: 'Landing', active: true }] });
    vi.stubGlobal('chrome', harness.chrome);
    await import('../../src/background/service-worker');
    const started = await dispatchRuntimeMessage(harness, { type: 'START_SESSION' }, { tab: { id: 1 } as chrome.tabs.Tab });
    const before = { ...started.session!, spendCents: started.session!.budgetCents - CONTEXT_EXPANSION_COST_CENTS + 1 };
    harness.store[STORAGE_KEY] = before;
    const expanded = await dispatchRuntimeMessage(harness, { type: 'EXPAND_CONTEXT' });
    expect(expanded).toMatchObject({ ok: false, error: 'OUT_OF_BUDGET', session: before });
    expect(harness.store[STORAGE_KEY]).toEqual(before);
  });

  it('stays in Collect while visiting sources and advances to Rank only after finalizing', async () => {
    const harness = createChromeMock({
      tabs: [{ id: 1, url: 'https://example.com', title: 'Landing', active: true }]
    });
    vi.stubGlobal('chrome', harness.chrome);
    await import('../../src/background/service-worker');

    const started = await dispatchRuntimeMessage(harness, { type: 'START_SESSION' }, { tab: { id: 1 } as chrome.tabs.Tab });
    const searchUrl = started.session?.activeUrl || '';
    await harness.events.webNavigationOnCommitted.trigger({
      tabId: 1, url: searchUrl, transitionType: 'generated', transitionQualifiers: [], frameId: 0
    } as unknown as chrome.webNavigation.WebNavigationTransitionCallbackDetails);

    const sourceUrl = 'https://example.com/source-a';
    await harness.events.tabsOnUpdated.trigger(1, { status: 'complete', url: sourceUrl },
      { id: 1, url: sourceUrl, title: 'Source A', active: true } as chrome.tabs.Tab);
    expect((await dispatchRuntimeMessage(harness, { type: 'GET_SESSION' })).session?.phase).toBe(Phase.RETRIEVAL);

    const added = await dispatchRuntimeMessage(harness, {
      type: 'ADD_RANK_CANDIDATE', payload: { url: sourceUrl, title: 'Source A' }
    });
    expect(added.session?.phase).toBe(Phase.RETRIEVAL);
    await harness.events.webNavigationOnCommitted.trigger({
      tabId: 1, url: searchUrl, transitionType: 'generated', transitionQualifiers: [], frameId: 0
    } as unknown as chrome.webNavigation.WebNavigationTransitionCallbackDetails);
    await harness.events.tabsOnUpdated.trigger(1, { status: 'complete', url: searchUrl },
      { id: 1, url: searchUrl, title: 'Search results', active: true } as chrome.tabs.Tab);
    expect((await dispatchRuntimeMessage(harness, { type: 'GET_SESSION' })).session?.phase).toBe(Phase.RETRIEVAL);

    const finalized = await dispatchRuntimeMessage(harness, { type: 'FINALIZE_RANK_CANDIDATES' });
    expect(finalized.session?.phase).toBe(Phase.INSPECTION);
    await harness.events.tabsOnUpdated.trigger(1, { status: 'complete', url: sourceUrl },
      { id: 1, url: sourceUrl, title: 'Source A', active: true } as chrome.tabs.Tab);
    expect((await dispatchRuntimeMessage(harness, { type: 'GET_SESSION' })).session?.phase).toBe(Phase.INSPECTION);
    await harness.events.tabsOnUpdated.trigger(1, { status: 'complete', url: searchUrl },
      { id: 1, url: searchUrl, title: 'Search results', active: true } as chrome.tabs.Tab);
    expect((await dispatchRuntimeMessage(harness, { type: 'GET_SESSION' })).session?.phase).toBe(Phase.INSPECTION);
  });

});
