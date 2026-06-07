import {
  AgentSession,
  CONTEXT_EXPANSION_COST_CENTS,
  CONTEXT_EXPANSION_TOKENS,
  OPERATION_COST_CENTS,
  Phase,
  RuntimeMessage,
  RuntimeResponse,
  LEGACY_STORAGE_KEY,
  STORAGE_KEY,
  SessionState,
  TraceKind,
  buildGoogleSearchUrl,
  createEmptySession,
  getContextBreakdown,
  getOperationsMax,
  getPageLabel,
  getSearchQueryFromUrl,
  getTokenCostCents,
  hydrateSession,
  isCandidatePage,
  isPublicWebUrl,
  isRestrictedUrl,
  isSearchEngineUrl,
  isSearchResultsUrl,
  makeId,
  makeSessionExport,
  moneyFromCents,
  normalizeTrackedUrl,
  now,
  pickRandomTask,
  rankCandidatesInNoteCaptureOrder,
  reconcileNoteCaptureRankOrder,
  roughTokenCount,
  roundCents
} from '../shared';

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await readStoredSessionRecord();
  if (stored === undefined) {
    await chrome.storage.local.set({ [STORAGE_KEY]: createEmptySession() });
  }
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message as RuntimeMessage, sender).then(sendResponse);
  return true;
});

const pendingRedirects = new Map<number, string>();
const pendingTabBounceTokens = new Map<number, string>();

function isNewTabPage(url = ''): boolean {
  return url === 'chrome://newtab/' || url === 'edge://newtab/' || url === 'about:blank';
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getCandidateIndex(session: AgentSession, url = ''): number {
  const normalized = normalizeTrackedUrl(url);
  if (!normalized) return -1;
  return (session.rankCandidates || []).findIndex(candidate => normalizeTrackedUrl(candidate.url) === normalized);
}

async function queueTabNavigation(tabId: number | null | undefined, url: string): Promise<void> {
  if (!tabId || !url) return;
  pendingRedirects.set(tabId, url);
  await chrome.tabs.update(tabId, { url }).catch(() => undefined);
}

async function focusTrackedTab(tabId: number, windowId: number, tabIndex: number | null = null): Promise<void> {
  if (windowId !== chrome.windows.WINDOW_ID_NONE && Number.isInteger(tabIndex)) {
    await chrome.tabs.highlight({ windowId, tabs: Number(tabIndex) }).catch(() => undefined);
  }
  await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    await chrome.windows.update(windowId, { focused: true }).catch(() => undefined);
  }
}

const TOAST_TAB_LOCK_MSG = "You can't switch tabs, open a new tab, or use the address bar during an active session.";
let lastTabLockToastAt = 0;
const TAB_LOCK_TOAST_DEBOUNCE_MS = 2000;

async function broadcastTabLockToast(message = TOAST_TAB_LOCK_MSG): Promise<void> {
  const timestamp = Date.now();
  if (timestamp - lastTabLockToastAt < TAB_LOCK_TOAST_DEBOUNCE_MS) return;
  lastTabLockToastAt = timestamp;
  await chrome.runtime.sendMessage({ type: 'SHOW_SIDE_TOAST', message, variant: 'error' }).catch(() => undefined);
}

async function bounceToTrackedTab(
  session: AgentSession,
  detail: string,
  blockedTabId: number | null = null,
  closeBlockedTab = false
): Promise<void> {
  if (!session.activeTabId) return;
  if (blockedTabId && closeBlockedTab) {
    await chrome.tabs.remove(blockedTabId).catch(() => undefined);
  }
  const trackedTab = await chrome.tabs.get(session.activeTabId).catch(() => null);
  if (!trackedTab?.id) return;
  const bounceToken = makeId('bounce');
  pendingTabBounceTokens.set(trackedTab.id, bounceToken);
  for (const delayMs of [0, 60, 180, 360, 720]) {
    if (delayMs) await wait(delayMs);
    if (pendingTabBounceTokens.get(trackedTab.id) !== bounceToken) return;
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    if (activeTab?.id === trackedTab.id) continue;
    await focusTrackedTab(trackedTab.id, trackedTab.windowId, trackedTab.index);
  }
  pendingTabBounceTokens.delete(trackedTab.id);
  logTrace(session, TraceKind.BLOCKED_ACTION, detail);
  await persistAndBroadcastSession(session);
  await broadcastTabLockToast();
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const session = await getSession();
  if (session.sessionState !== SessionState.ACTIVE) return;

  if (session.activeTabId && session.activeTabId !== tabId) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const closeBlockedTab = !!tab && isNewTabPage(tab.pendingUrl || tab.url || '');
    await bounceToTrackedTab(
      session,
      closeBlockedTab ? 'Blocked new tab and returned to tracked tab' : 'Blocked tab switch and returned to tracked tab',
      tabId,
      closeBlockedTab
    );
    return;
  }

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url) return;
  await syncActivePageFromTab(session, tabId, tab.url, tab.title || '');
});

chrome.tabs.onHighlighted.addListener(async ({ tabIds }) => {
  const session = await getSession();
  if (session.sessionState !== SessionState.ACTIVE) return;
  if (!session.activeTabId || tabIds.includes(session.activeTabId)) return;
  await bounceToTrackedTab(session, 'Blocked tab switch and returned to tracked tab', tabIds[0] ?? null, false);
});

chrome.tabs.onCreated.addListener(async (tab) => {
  const session = await getSession();
  if (session.sessionState !== SessionState.ACTIVE) return;
  if (!tab.id || tab.id === session.activeTabId) return;
  await bounceToTrackedTab(session, 'Blocked new tab and returned to tracked tab', tab.id, true);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.status && !changeInfo.url && !changeInfo.title) return;
  if (pendingRedirects.has(tabId)) return;
  const session = await getSession();
  if (session.sessionState !== SessionState.ACTIVE) return;

  const nextUrl = changeInfo.url || tab.url || '';
  const nextTitle = tab.title || changeInfo.title || '';

  if (session.phase === Phase.NOTE_CAPTURE && session.noteCaptureLockedTabId === tabId) {
    if (
      nextUrl
      && session.noteCaptureLockedUrl
      && normalizeTrackedUrl(nextUrl) !== normalizeTrackedUrl(session.noteCaptureLockedUrl)
    ) {
      logTrace(
        session,
        TraceKind.PAGE_EXIT_DURING_CAPTURE,
        `Attempted navigation during note capture; returned to ${getPageLabel(session.noteCaptureLockedUrl)}`
      );
      await chrome.tabs.update(tabId, { url: session.noteCaptureLockedUrl }).catch(() => undefined);
      await persistAndBroadcastSession(session);
      await broadcastTabLockToast();
      return;
    }
  }

  if (changeInfo.status === 'complete' || changeInfo.url) {
    if (
      tab.active
      && nextUrl
      && session.taskSearchQuery
      && !session.trace.some(item => item.kind === TraceKind.SEARCH)
      && isSearchResultsUrl(nextUrl)
    ) {
      session.navigationChain = [nextUrl];
    }
    if (tab.active) {
      await syncActivePageFromTab(session, tabId, nextUrl, nextTitle);
    }
  }
});

chrome.webNavigation.onCommitted.addListener(async ({ tabId, url, transitionType, transitionQualifiers, frameId }) => {
  if (frameId !== 0) return;
  const session = await getSession();
  if (session.sessionState !== SessionState.ACTIVE) return;
  if (session.activeTabId !== tabId) return;

  if (pendingRedirects.get(tabId) === url) {
    pendingRedirects.delete(tabId);
    return;
  }

  const isForwardBack = (transitionQualifiers || []).includes('forward_back');

  if (transitionType === 'typed' || transitionType === 'auto_bookmark') {
    const lastUrl = session.navigationChain.length
      ? session.navigationChain[session.navigationChain.length - 1]
      : session.activeUrl;
    if (lastUrl && lastUrl !== url) {
      pendingRedirects.set(tabId, lastUrl);
      await chrome.tabs.update(tabId, { url: lastUrl }).catch(() => undefined);
      logTrace(session, TraceKind.BLOCKED_TYPED_NAV, `Blocked address-bar navigation to ${getPageLabel(url)}`);
      session.lastTrackedNavigationUrl = lastUrl;
      await persistAndBroadcastSession(session);
      await broadcastTabLockToast();
    }
    return;
  }

  if (isForwardBack && session.navigationChain.length > 0) {
    const chainIndex = session.navigationChain.lastIndexOf(url);
    if (chainIndex === -1) {
      const firstUrl = session.navigationChain[0] || '';
      pendingRedirects.set(tabId, firstUrl);
      await chrome.tabs.update(tabId, { url: firstUrl }).catch(() => undefined);
      logTrace(session, TraceKind.BLOCKED_BACK_NAV, 'Blocked navigation beyond search engine boundary');
      session.navigationChain = [firstUrl];
      session.lastTrackedNavigationUrl = firstUrl;
      await persistAndBroadcastSession(session);
      await broadcastTabLockToast();
    } else {
      session.navigationChain = session.navigationChain.slice(0, chainIndex + 1);
      session.lastTrackedNavigationUrl = url;
      await persistAndBroadcastSession(session);
    }
  }
});

async function handleMessage(message: RuntimeMessage, sender: chrome.runtime.MessageSender): Promise<RuntimeResponse> {
  switch (message?.type) {
    case 'GET_SESSION':
      return { ok: true, session: await getSession() };
    case 'START_SESSION':
      return startSession(sender);
    case 'BEGIN_NOTE_CAPTURE':
      return beginNoteCapture(message.payload, sender);
    case 'NEXT_NOTE_CAPTURE_SOURCE':
      return nextNoteCaptureSource();
    case 'COMMIT_NOTE_BLOCK':
      return commitNoteBlock(message.payload);
    case 'OPEN_NOTE_REVISION':
      return openNoteRevision(message.payload);
    case 'DELETE_NOTE_BLOCK':
      return deleteNoteBlock(message.payload);
    case 'ADD_RANK_CANDIDATE':
      return addRankCandidate(message.payload);
    case 'REMOVE_RANK_CANDIDATE':
      return removeRankCandidate(message.payload);
    case 'REORDER_RANK_CANDIDATES':
      return reorderRankCandidates(message.payload);
    case 'FINALIZE_RANK_CANDIDATES':
      return finalizeRankCandidates();
    case 'ENTER_DELIVERABLE':
      return enterDeliverable();
    case 'COMMIT_DRAFT':
      return commitDraft(message.payload);
    case 'PAUSE_SESSION':
      return pauseSession();
    case 'RESUME_SESSION':
      return resumeSession();
    case 'ABORT_SESSION':
      return abortSession();
    case 'COMPLETE_SESSION':
      return completeSession();
    case 'EXPAND_CONTEXT':
      return expandContext();
    case 'CONTENT_STATUS':
      return updateContentStatus(message.payload, sender);
    default:
      return { ok: false, error: 'UNKNOWN_MESSAGE' };
  }
}

async function readStoredSessionRecord(): Promise<unknown> {
  const stored = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]) as Record<string, unknown>;
  if (stored[STORAGE_KEY] !== undefined) {
    if (stored[LEGACY_STORAGE_KEY] !== undefined) {
      await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
    }
    return stored[STORAGE_KEY];
  }
  if (stored[LEGACY_STORAGE_KEY] === undefined) return undefined;
  const hydratedLegacy = hydrateSession(stored[LEGACY_STORAGE_KEY]);
  await chrome.storage.local.set({ [STORAGE_KEY]: hydratedLegacy });
  await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
  return hydratedLegacy;
}

async function getSession(): Promise<AgentSession> {
  const raw = await readStoredSessionRecord();
  const session = hydrateSession(raw);
  if (!raw || !isHydratedStorage(raw)) {
    await chrome.storage.local.set({ [STORAGE_KEY]: session });
  }
  return session;
}

async function persistSession(session: AgentSession): Promise<void> {
  const hydrated = hydrateSession(session);
  hydrated.estimatedSpend = moneyFromCents(hydrated.spendCents);
  hydrated.operationsMax = getOperationsMax(hydrated);
  hydrated.lastUpdatedAt = now();
  await chrome.storage.local.set({ [STORAGE_KEY]: hydrated });
}

function logTrace(session: AgentSession, kind: TraceKind, detail: string): void {
  session.trace.push({ id: makeId('trace'), at: now(), kind, detail, phase: session.phase });
}

function canSpend(session: AgentSession, cents: number): boolean {
  return roundCents(session.spendCents + cents) <= session.budgetCents;
}

function getTokenOperationCostCents(..._texts: string[]): number {
  return OPERATION_COST_CENTS;
}

function getContextTokenCostCents(nextTokens: number, originalTokens = 0): number {
  return getTokenCostCents(Math.max(0, nextTokens - originalTokens));
}

function applyContextSpend(session: AgentSession, cents = 0): void {
  const safeCents = roundCents(Math.max(0, Number(cents) || 0));
  if (!safeCents) return;
  session.spendCents = roundCents(session.spendCents + safeCents);
  session.contextExpansionSpendCents = roundCents(session.contextExpansionSpendCents + safeCents);
}

function spendOperation(
  session: AgentSession,
  kind: TraceKind,
  detail: string,
  cents = OPERATION_COST_CENTS
): RuntimeResponse {
  if (!canSpend(session, cents)) return { ok: false, error: 'OUT_OF_BUDGET', session };
  session.operationsUsed += 1;
  session.spendCents = roundCents(session.spendCents + cents);
  logTrace(session, kind, detail);
  return { ok: true, session };
}

function spendContext(
  session: AgentSession,
  kind: TraceKind,
  detail: string,
  cents = CONTEXT_EXPANSION_COST_CENTS
): RuntimeResponse {
  if (!canSpend(session, cents)) return { ok: false, error: 'OUT_OF_BUDGET', session };
  session.spendCents = roundCents(session.spendCents + cents);
  session.contextExpansionSpendCents = roundCents(session.contextExpansionSpendCents + cents);
  logTrace(session, kind, detail);
  return { ok: true, session };
}

async function broadcastSession(): Promise<void> {
  const session = await getSession();
  await chrome.runtime.sendMessage({ type: 'SESSION_UPDATED', session }).catch(() => undefined);
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    await chrome.tabs.sendMessage(tab.id, { type: 'SESSION_UPDATED', session }).catch(() => undefined);
  }
}

async function persistAndBroadcastSession(session: AgentSession): Promise<void> {
  await persistSession(session);
  await broadcastSession();
}

function clearNoteCaptureState(session: AgentSession): void {
  session.noteCaptureLockedTabId = null;
  session.noteCaptureLockedUrl = '';
  session.noteCaptureQueueIndex = null;
}

function pushNavigation(session: AgentSession, url: string): void {
  if (!url) return;
  if (!session.navigationChain.length || session.navigationChain[session.navigationChain.length - 1] !== url) {
    session.navigationChain.push(url);
  }
}

async function startSession(sender: chrome.runtime.MessageSender): Promise<RuntimeResponse> {
  let activeTab = sender.tab?.id ? await chrome.tabs.get(sender.tab.id).catch(() => null) : null;
  if (!activeTab?.id) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab || null;
  }
  if (!activeTab?.id) return { ok: false, error: 'NO_ACTIVE_TAB', session: await getSession() };

  const assignedTask = pickRandomTask();
  if (!assignedTask) return { ok: false, error: 'TASK_BANK_EMPTY', session: await getSession() };
  const searchUrl = buildGoogleSearchUrl(assignedTask.searchQuery);

  const session = createEmptySession();
  session.sessionState = SessionState.ACTIVE;
  session.phase = Phase.RETRIEVAL;
  session.task = assignedTask.task;
  session.taskBankTaskId = assignedTask.id;
  session.taskSearchQuery = assignedTask.searchQuery;
  session.currentSearchQuery = assignedTask.searchQuery;
  session.activeTabId = activeTab.id;
  session.activeUrl = searchUrl;
  session.activeTitle = `Google results for ${assignedTask.task}`;
  session.navigationChain = [searchUrl];
  session.lastTrackedNavigationUrl = activeTab.url || '';
  const spent = spendOperation(session, TraceKind.SESSION_START, `Session started with assigned task: ${assignedTask.task}`);
  if (!spent.ok) return spent;
  await persistSession(session);
  await queueTabNavigation(activeTab.id, searchUrl);
  return { ok: true, session };
}

async function syncActivePageFromTab(session: AgentSession, tabId: number, url: string, title: string): Promise<void> {
  if (session.sessionState === SessionState.ACTIVE && session.activeTabId && tabId !== session.activeTabId) return;
  session.activeTabId = tabId;
  session.activeUrl = url;
  session.activeTitle = title || session.activeTitle;

  if (session.phase === Phase.DELIVERABLE || !url || !isPublicWebUrl(url) || url === session.lastTrackedNavigationUrl) {
    await persistAndBroadcastSession(session);
    return;
  }

  session.lastTrackedNavigationUrl = url;

  if (isRestrictedUrl(url)) {
    logTrace(session, TraceKind.BLOCKED_ACTION, `Opened restricted page: ${getPageLabel(url)}`);
    await persistAndBroadcastSession(session);
    return;
  }

  if (session.phase === Phase.NOTE_CAPTURE) {
    pushNavigation(session, url);
    await persistAndBroadcastSession(session);
    return;
  }

  if (isSearchResultsUrl(url)) {
    const query = getSearchQueryFromUrl(url);
    const spent = spendOperation(session, TraceKind.SEARCH, `Search detected: ${query || 'untitled query'}`);
    if (!spent.ok) {
      await persistAndBroadcastSession(session);
      return;
    }
    session.currentSearchQuery = query;
    session.phase = Phase.RETRIEVAL;
  } else {
    const spent = spendOperation(session, TraceKind.OPEN_PAGE, `Opened page: ${title || getPageLabel(url)}`);
    if (!spent.ok) {
      await persistAndBroadcastSession(session);
      return;
    }
    session.phase = Phase.INSPECTION;
  }

  pushNavigation(session, url);
  await persistAndBroadcastSession(session);
}

async function beginNoteCapture(
  payload: { tabId?: number; url?: string; title?: string } = {},
  sender: chrome.runtime.MessageSender
): Promise<RuntimeResponse> {
  const session = await getSession();
  if (!session.rankCandidates.length) return { ok: false, error: 'NO_RANK_CANDIDATES', session };
  if (!session.candidateSetFinalized) return { ok: false, error: 'CANDIDATE_SET_NOT_FINALIZED', session };
  const activeTabs = payload.tabId
    ? [await chrome.tabs.get(payload.tabId).catch(() => null)]
    : await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const activeTab = activeTabs[0] || null;
  const ordered = rankCandidatesInNoteCaptureOrder(session);
  const target = ordered[0];
  if (!target) return { ok: false, error: 'NO_RANK_CANDIDATES', session };
  const tabId = activeTab?.id ?? sender.tab?.id ?? session.activeTabId ?? null;
  const currentUrl = String(payload.url || activeTab?.url || session.activeUrl || '');
  session.phase = Phase.NOTE_CAPTURE;
  session.noteCaptureQueueIndex = 0;
  session.noteCaptureLockedTabId = tabId;
  session.noteCaptureLockedUrl = target.url;
  session.activeUrl = target.url;
  session.activeTitle = target.title || String(payload.title || activeTab?.title || session.activeTitle || '');
  session.lastTrackedNavigationUrl = target.url;
  logTrace(session, TraceKind.BEGIN_NOTE_CAPTURE, `Begin note capture: ${session.activeTitle || getPageLabel(session.noteCaptureLockedUrl)}`);
  pushNavigation(session, target.url);
  if (tabId && normalizeTrackedUrl(currentUrl) !== normalizeTrackedUrl(target.url)) {
    await queueTabNavigation(tabId, target.url);
  }
  await persistAndBroadcastSession(session);
  return { ok: true, session };
}

async function commitNoteBlock(payload: { id?: string; committedText?: string; sourceUrl?: string; sourceTitle?: string } = {}): Promise<RuntimeResponse> {
  const session = await getSession();
  const noteId = payload.id || makeId('note');
  const committedText = String(payload.committedText || '').trim();
  const sourceUrl = String(payload.sourceUrl || session.noteCaptureLockedUrl || session.activeUrl || '');
  const sourceTitle = String(payload.sourceTitle || session.activeTitle || '');
  if (!committedText) return { ok: false, error: 'EMPTY_NOTE', session };

  const existing = session.notes.find(note => note.id === noteId);
  const originalText = existing?.committedText || '';
  const currentBreakdown = getContextBreakdown(session);
  const originalTokens = roughTokenCount(originalText);
  const nextTokens = roughTokenCount(committedText);
  const projected = currentBreakdown.total - originalTokens + nextTokens;
  if (projected > session.contextMax) return { ok: false, error: 'CONTEXT_FULL', session };

  const noteCommitCostCents = getTokenOperationCostCents(committedText);
  const noteContextCostCents = getContextTokenCostCents(nextTokens, originalTokens);
  if (!canSpend(session, roundCents(noteCommitCostCents + noteContextCostCents))) {
    return { ok: false, error: 'OUT_OF_BUDGET', session };
  }
  applyContextSpend(session, noteContextCostCents);
  const spent = spendOperation(
    session,
    TraceKind.NOTE_COMMIT,
    `Committed note block: ${sourceTitle || getPageLabel(sourceUrl)} (${nextTokens} tokens)`,
    noteCommitCostCents
  );
  if (!spent.ok) return spent;

  if (existing) {
    existing.committedText = committedText;
    existing.sourceUrl = sourceUrl;
    existing.sourceTitle = sourceTitle;
    existing.updatedAt = now();
  } else {
    session.notes.push({ id: noteId, sourceUrl, sourceTitle, committedText, updatedAt: now() });
  }

  await persistAndBroadcastSession(session);
  return { ok: true, session, noteId };
}

function hasCommittedNoteForCandidate(session: AgentSession, candidate: { url?: string } | undefined): boolean {
  if (!candidate?.url) return false;
  const targetUrl = normalizeTrackedUrl(candidate.url);
  if (!targetUrl) return false;
  return (session.notes || []).some(note => normalizeTrackedUrl(note.sourceUrl || '') === targetUrl);
}

async function nextNoteCaptureSource(): Promise<RuntimeResponse> {
  const session = await getSession();
  if (session.phase !== Phase.NOTE_CAPTURE) return { ok: false, error: 'NOT_IN_NOTE_CAPTURE', session };
  const queueIndex = session.noteCaptureQueueIndex;
  if (typeof queueIndex !== 'number' || !Number.isInteger(queueIndex)) {
    return { ok: false, error: 'NO_NEXT_NOTE_CAPTURE_SOURCE', session };
  }
  const ordered = rankCandidatesInNoteCaptureOrder(session);
  const currentCandidate = ordered[queueIndex];
  if (!hasCommittedNoteForCandidate(session, currentCandidate)) {
    return { ok: false, error: 'MISSING_NOTE_FOR_RANKED_SOURCE', session };
  }
  if (queueIndex >= ordered.length - 1) {
    return { ok: false, error: 'NO_NEXT_NOTE_CAPTURE_SOURCE', session };
  }

  const nextCandidate = ordered[queueIndex + 1];
  if (!nextCandidate) return { ok: false, error: 'NO_NEXT_NOTE_CAPTURE_SOURCE', session };
  session.noteCaptureQueueIndex = queueIndex + 1;
  session.noteCaptureLockedUrl = nextCandidate.url;
  session.activeUrl = nextCandidate.url;
  session.activeTitle = nextCandidate.title || session.activeTitle;
  session.lastTrackedNavigationUrl = nextCandidate.url;
  pushNavigation(session, nextCandidate.url);
  logTrace(session, TraceKind.NOTE_CAPTURE_NEXT_SOURCE, `Moved to next ranked page: ${nextCandidate.title || getPageLabel(nextCandidate.url)}`);
  await queueTabNavigation(session.noteCaptureLockedTabId, nextCandidate.url);
  await persistAndBroadcastSession(session);
  return { ok: true, session };
}

async function openNoteRevision(payload: { id?: string } = {}): Promise<RuntimeResponse> {
  const session = await getSession();
  logTrace(session, TraceKind.NOTE_REVISE_OPEN, `Opened note for revision: ${payload.id || 'unknown note'}`);
  await persistAndBroadcastSession(session);
  return { ok: true, session };
}

async function deleteNoteBlock(payload: { id?: string } = {}): Promise<RuntimeResponse> {
  const session = await getSession();
  const noteId = payload.id;
  session.notes = session.notes.filter(note => note.id !== noteId);
  logTrace(session, TraceKind.NOTE_DELETE, `Deleted note block ${noteId || 'unknown note'}`);
  await persistAndBroadcastSession(session);
  return { ok: true, session };
}

async function enterDeliverable(): Promise<RuntimeResponse> {
  const session = await getSession();
  if (!session.rankCandidates.length) return { ok: false, error: 'NO_RANK_CANDIDATES', session };
  if (!session.candidateSetFinalized) return { ok: false, error: 'CANDIDATE_SET_NOT_FINALIZED', session };
  const ordered = rankCandidatesInNoteCaptureOrder(session);
  const missingCoverage = ordered.some(candidate => !hasCommittedNoteForCandidate(session, candidate));
  if (missingCoverage) return { ok: false, error: 'MISSING_NOTES_FOR_ALL_RANKED_SOURCES', session };
  const spent = spendOperation(session, TraceKind.DRAFT_PHASE_ENTER, 'Entered deliverable phase');
  if (!spent.ok) return spent;
  session.phase = Phase.DELIVERABLE;
  clearNoteCaptureState(session);
  await persistAndBroadcastSession(session);
  return { ok: true, session };
}

async function commitDraft(payload: { committedText?: string } = {}): Promise<RuntimeResponse> {
  const session = await getSession();
  const committedText = String(payload.committedText || '').trim();
  const currentBreakdown = getContextBreakdown(session);
  const originalTokens = roughTokenCount(session.draft?.committedText || '');
  const nextTokens = roughTokenCount(committedText);
  const projected = currentBreakdown.total - originalTokens + nextTokens;
  if (projected > session.contextMax) return { ok: false, error: 'CONTEXT_FULL', session };
  const draftCommitCostCents = getTokenOperationCostCents(committedText);
  const draftContextCostCents = getContextTokenCostCents(nextTokens, originalTokens);
  if (!canSpend(session, roundCents(draftCommitCostCents + draftContextCostCents))) {
    return { ok: false, error: 'OUT_OF_BUDGET', session };
  }
  applyContextSpend(session, draftContextCostCents);
  const wordCount = committedText.split(/\s+/).filter(Boolean).length;
  const spent = spendOperation(session, TraceKind.DRAFT_COMMIT, `Committed draft update (${wordCount} words, ${nextTokens} tokens)`, draftCommitCostCents);
  if (!spent.ok) return spent;
  session.draft = { committedText, updatedAt: now() };
  await persistAndBroadcastSession(session);
  return { ok: true, session };
}

async function pauseSession(): Promise<RuntimeResponse> {
  const session = await getSession();
  session.sessionState = SessionState.PAUSED;
  clearNoteCaptureState(session);
  logTrace(session, TraceKind.SESSION_PAUSE, 'Session paused');
  await persistAndBroadcastSession(session);
  return { ok: true, session };
}

async function resumeSession(): Promise<RuntimeResponse> {
  const session = await getSession();
  session.sessionState = SessionState.ACTIVE;
  const spent = spendOperation(session, TraceKind.SESSION_RESUME, 'Session resumed');
  if (!spent.ok) return spent;
  await persistAndBroadcastSession(session);
  return { ok: true, session };
}

async function expandContext(): Promise<RuntimeResponse> {
  const session = await getSession();
  const spent = spendContext(session, TraceKind.CONTEXT_EXPANSION, `Expanded context window by ${CONTEXT_EXPANSION_TOKENS} tokens`);
  if (!spent.ok) return spent;
  session.contextMax += CONTEXT_EXPANSION_TOKENS;
  await persistAndBroadcastSession(session);
  return { ok: true, session };
}

async function abortSession(): Promise<RuntimeResponse> {
  const session = await getSession();
  session.sessionState = SessionState.ABORTED;
  clearNoteCaptureState(session);
  logTrace(session, TraceKind.SESSION_ABORT, 'Session aborted');
  const exported = makeSessionExport(session, SessionState.ABORTED);
  await persistAndBroadcastSession(session);
  return { ok: true, session, export: exported };
}

async function completeSession(): Promise<RuntimeResponse> {
  const session = await getSession();
  session.sessionState = SessionState.COMPLETED;
  clearNoteCaptureState(session);
  logTrace(session, TraceKind.SESSION_COMPLETE, 'Session completed');
  const exported = makeSessionExport(session, SessionState.COMPLETED);
  await persistAndBroadcastSession(session);
  return { ok: true, session, export: exported };
}

async function addRankCandidate(payload: { url?: string; title?: string } = {}): Promise<RuntimeResponse> {
  const session = await getSession();
  if (session.phase === Phase.NOTE_CAPTURE || session.candidateSetFinalized) return { ok: false, error: 'CANDIDATES_LOCKED', session };
  const url = normalizeTrackedUrl(String(payload.url || '').trim());
  if (!isCandidatePage(url)) return { ok: false, error: 'INVALID_CANDIDATE_PAGE', session };
  if (getCandidateIndex(session, url) !== -1) return { ok: false, error: 'DUPLICATE_RANK_CANDIDATE', session };
  const title = String(payload.title || '').trim() || getPageLabel(url);
  const candidate = { id: makeId('candidate'), url, title };
  session.rankCandidates.push(candidate);
  if (!Array.isArray(session.noteCaptureRankOrder)) session.noteCaptureRankOrder = [];
  session.noteCaptureRankOrder.push(candidate.id);
  const searchEngineUrl = (session.navigationChain || []).find(item => isSearchEngineUrl(item) || isSearchResultsUrl(item))
    || session.navigationChain?.[0]
    || '';
  if (session.activeTabId && searchEngineUrl && normalizeTrackedUrl(url) !== normalizeTrackedUrl(searchEngineUrl)) {
    await queueTabNavigation(session.activeTabId, searchEngineUrl);
  }
  logTrace(session, TraceKind.RANK_CANDIDATE_ADD, `Added ranked candidate: ${title}`);
  await persistAndBroadcastSession(session);
  return { ok: true, session };
}

async function removeRankCandidate(payload: { id?: string } = {}): Promise<RuntimeResponse> {
  const session = await getSession();
  if (session.phase === Phase.NOTE_CAPTURE) return { ok: false, error: 'CANDIDATES_LOCKED', session };
  const candidate = session.rankCandidates.find(item => item.id === payload.id);
  session.rankCandidates = session.rankCandidates.filter(item => item.id !== payload.id);
  session.noteCaptureRankOrder = (session.noteCaptureRankOrder || []).filter(id => id !== payload.id);
  if (!session.rankCandidates.length) session.candidateSetFinalized = false;
  logTrace(session, TraceKind.RANK_CANDIDATE_REMOVE, `Removed ranked candidate: ${candidate?.title || payload.id || 'unknown page'}`);
  await persistAndBroadcastSession(session);
  return { ok: true, session };
}

async function reorderRankCandidates(payload: { orderedIds?: string[] } = {}): Promise<RuntimeResponse> {
  const session = await getSession();
  if (session.phase === Phase.NOTE_CAPTURE || !session.candidateSetFinalized) return { ok: false, error: 'CANDIDATES_LOCKED', session };
  const orderedIds = Array.isArray(payload.orderedIds) ? payload.orderedIds : [];
  const byId = new Map(session.rankCandidates.map(candidate => [candidate.id, candidate]));
  const reordered = orderedIds.map(id => byId.get(id)).filter(Boolean);
  if (reordered.length !== session.rankCandidates.length) {
    for (const candidate of session.rankCandidates) {
      if (!reordered.find(item => item?.id === candidate.id)) reordered.push(candidate);
    }
  }
  session.noteCaptureRankOrder = reordered.map(candidate => candidate?.id || '').filter(Boolean);
  logTrace(session, TraceKind.RANK_CANDIDATE_REORDER, `Reordered note capture order (${session.noteCaptureRankOrder.length} total)`);
  await persistAndBroadcastSession(session);
  return { ok: true, session };
}

async function finalizeRankCandidates(): Promise<RuntimeResponse> {
  const session = await getSession();
  if (session.phase === Phase.NOTE_CAPTURE) return { ok: false, error: 'CANDIDATES_LOCKED', session };
  if (!session.rankCandidates.length) return { ok: false, error: 'NO_RANK_CANDIDATES', session };
  reconcileNoteCaptureRankOrder(session);
  session.candidateSetFinalized = true;
  logTrace(session, TraceKind.RANK_CANDIDATE_FINALIZE, `Finalized candidate set (${session.rankCandidates.length} total)`);
  await persistAndBroadcastSession(session);
  return { ok: true, session };
}

async function updateContentStatus(
  payload: { tabId?: number; url?: string; title?: string } = {},
  sender: chrome.runtime.MessageSender
): Promise<RuntimeResponse> {
  const session = await getSession();
  const tabId = sender.tab?.id ?? payload.tabId ?? null;
  if (!tabId) return { ok: true, session };
  if (session.sessionState === SessionState.ACTIVE && session.activeTabId && tabId !== session.activeTabId) {
    await bounceToTrackedTab(session, 'Blocked tab switch and returned to tracked tab', tabId, false);
    return { ok: true, session };
  }
  session.activeTabId = tabId;
  if (payload.url) session.activeUrl = payload.url;
  if (payload.title) session.activeTitle = payload.title;
  await persistSession(session);
  return { ok: true, session };
}

function isHydratedStorage(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'sessionRunId' in value && 'draft' in value;
}
