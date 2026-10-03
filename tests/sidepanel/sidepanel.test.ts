// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSession, createEmptySession, makeSessionExport, Phase, RuntimeMessage, RuntimeResponse, SessionState } from '../../src/shared';
import { ONBOARDING_STORAGE_KEY } from '../../src/sidepanel/copy';
import { createChromeMock } from '../helpers/chrome';

vi.mock('../../src/sidepanel/guidance', () => ({ initGuidance: vi.fn() }));
vi.mock('../../src/sidepanel/export', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/sidepanel/export')>(),
  downloadDeliverableFile: vi.fn(),
  downloadSessionExportFile: vi.fn()
}));

const markup = readFileSync('src/sidepanel/sidepanel.html', 'utf8');
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
const input = (id: string) => document.getElementById(id) as HTMLTextAreaElement;

function savedSession(state: AgentSession['sessionState']): AgentSession {
  return {
    ...createEmptySession(), sessionState: state, phase: Phase.DELIVERABLE,
    task: 'Write a brief.', workOrder: 'Write a brief.', requesterQuestion: 'What changed?',
    candidateSetFinalized: true,
    rankCandidates: [{ id: 'source', url: 'https://example.com/source', title: 'Source' }],
    notes: [{ id: 'note', sourceUrl: 'https://example.com/source', sourceTitle: 'Source', committedText: 'Saved evidence.' }],
    draft: { committedText: 'Saved final answer.' }
  };
}

async function openPanel(session: AgentSession) {
  document.body.innerHTML = new DOMParser().parseFromString(markup, 'text/html').body.innerHTML;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => key === ONBOARDING_STORAGE_KEY ? 'true' : null,
    setItem: vi.fn(),
    removeItem: vi.fn()
  });
  const harness = createChromeMock();
  const send = vi.fn<(message: RuntimeMessage) => Promise<RuntimeResponse>>(async () => ({ ok: true, session: structuredClone(session) }));
  vi.stubGlobal('chrome', {
    ...harness.chrome,
    runtime: { ...harness.chrome.runtime, sendMessage: send }
  });
  await import('../../src/sidepanel/sidepanel');
  await vi.waitFor(() => expect(document.getElementById('stateValue')?.textContent?.toLowerCase()).toBe(session.sessionState));
  return { harness, send };
}

describe('side-panel session persistence and save controls', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it.each([SessionState.COMPLETED, SessionState.ABORTED])('restores downloads when reopening a %s session', async state => {
    const session = savedSession(state);
    const { send } = await openPanel(session);
    expect(send).toHaveBeenCalledWith({ type: 'GET_SESSION' });
    expect(document.getElementById('exportSection')?.classList.contains('hidden')).toBe(false);
    expect(button('downloadDeliverableBtn').disabled).toBe(false);
    expect(button('downloadJsonBtn').disabled).toBe(false);
    expect(document.querySelectorAll('.readonly-actions:not(.hidden)')).toHaveLength(0);
    button('downloadDeliverableBtn').click();
    button('downloadJsonBtn').click();
    const exports = await import('../../src/sidepanel/export');
    expect(exports.downloadDeliverableFile).toHaveBeenCalledWith(session.task, makeSessionExport(session, state));
    expect(exports.downloadSessionExportFile).toHaveBeenCalledWith(makeSessionExport(session, state));
  });

  it('offers the runtime record for an aborted session without a deliverable', async () => {
    const session = savedSession(SessionState.ABORTED);
    session.draft.committedText = '';
    await openPanel(session);
    expect(document.getElementById('exportSection')?.classList.contains('hidden')).toBe(false);
    expect(button('downloadDeliverableBtn').disabled).toBe(true);
    expect(button('downloadJsonBtn').disabled).toBe(false);
  });

  it('removes the previous export when a new session is adopted', async () => {
    const { harness } = await openPanel(savedSession(SessionState.COMPLETED));
    const next = { ...createEmptySession(), sessionState: SessionState.ACTIVE, phase: Phase.RETRIEVAL };
    await harness.events.runtimeOnMessage.trigger({ type: 'SESSION_UPDATED', session: next }, {}, () => {});
    expect(document.getElementById('exportSection')?.classList.contains('hidden')).toBe(true);
    expect(button('downloadDeliverableBtn').disabled).toBe(true);
    expect(button('downloadJsonBtn').disabled).toBe(true);
    expect(input('draftInput').value).toBe('');
  });

  it('blocks completion until a pending draft save succeeds and prevents duplicate completion', async () => {
    const session = savedSession(SessionState.ACTIVE);
    const { send } = await openPanel(session);
    let resolveSave!: (response: RuntimeResponse) => void;
    let resolveFinish!: (response: RuntimeResponse) => void;
    send.mockImplementation((message: RuntimeMessage) => message.type === 'COMMIT_DRAFT'
      ? new Promise<RuntimeResponse>(resolve => { resolveSave = resolve; })
      : new Promise<RuntimeResponse>(resolve => { resolveFinish = resolve; }));
    input('draftInput').value = 'New final answer.';
    button('commitDraftBtn').click();
    expect(button('endSessionBtn').disabled).toBe(true);
    expect(button('commitDraftBtn').disabled).toBe(true);
    expect(input('draftInput').disabled).toBe(true);
    expect(button('abortSessionBtn').disabled).toBe(true);
    button('endSessionBtn').dispatchEvent(new MouseEvent('click'));
    expect(send.mock.calls.filter(([message]) => message.type === 'COMPLETE_SESSION')).toHaveLength(0);
    const saved = { ...session, draft: { committedText: 'New final answer.' } };
    resolveSave({ ok: true, session: saved });
    await vi.waitFor(() => expect(button('endSessionBtn').disabled).toBe(false));
    button('endSessionBtn').click();
    button('endSessionBtn').dispatchEvent(new MouseEvent('click'));
    expect(send.mock.calls.filter(([message]) => message.type === 'COMPLETE_SESSION')).toHaveLength(1);
    resolveFinish({ ok: true, session: { ...saved, sessionState: SessionState.COMPLETED } });
    await vi.waitFor(() => expect(document.getElementById('exportSection')?.classList.contains('hidden')).toBe(false));
  });

  it('re-enables saving after a rejected commit without completing the session', async () => {
    const { send } = await openPanel(savedSession(SessionState.ACTIVE));
    send.mockResolvedValue({ ok: false, error: 'CONTEXT_FULL' });
    button('commitDraftBtn').click();
    await vi.waitFor(() => expect(document.getElementById('sideToast')?.textContent).toContain('Context window full'));
    expect(button('commitDraftBtn').disabled).toBe(false);
    expect(send.mock.calls.some(([message]) => message.type === 'COMPLETE_SESSION')).toBe(false);
  });

  it('blocks completion while a revised note is being committed', async () => {
    const session = savedSession(SessionState.ACTIVE);
    const { send } = await openPanel(session);
    (document.querySelector('.revise-note-btn') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('.note-card.editing')).not.toBeNull());
    let resolveSave!: (response: RuntimeResponse) => void;
    send.mockImplementation(() => new Promise<RuntimeResponse>(resolve => { resolveSave = resolve; }));
    (document.querySelector('.note-card.editing .commit-note-btn') as HTMLButtonElement).click();
    expect(button('endSessionBtn').disabled).toBe(true);
    expect((document.querySelector('.note-card.editing .note-text') as HTMLTextAreaElement).disabled).toBe(true);
    resolveSave({ ok: true, session });
    await vi.waitFor(() => expect(button('endSessionBtn').disabled).toBe(false));
  });
});
