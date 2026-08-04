import {
  AgentSession,
  BroadcastMessage,
  countWords,
  CONTEXT_EXPANSION_TOKENS,
  CONTEXT_WARNING_THRESHOLD,
  DEFAULT_BUDGET_CENTS,
  escapeHtml,
  OPERATION_COST_CENTS,
  PDF_TOOL_UNAVAILABLE_MESSAGE,
  Phase,
  pretty,
  RuntimeMessage,
  RuntimeResponse,
  SessionExport,
  SessionState,
  TOKEN_COST_CENTS_PER_TOKEN,
  TraceKind,
  formatMoney,
  formatMoneyPrecise,
  getBudgetRemainingCents,
  getContextBreakdownFromParts,
  getTaskContextText,
  getOperationsMax,
  isCandidatePage,
  makeId,
  normalizeTrackedUrl,
  rankCandidatesInNoteCaptureOrder,
  roughTokenCount
} from '../shared';
import { LEGACY_ONBOARDING_STORAGE_KEY, ONBOARDING_STORAGE_KEY, OnboardingStep, onboardingSteps, responseMessages } from './copy';
import { downloadDeliverableFile, downloadSessionExportFile, renderExportSummary } from './export';

interface NoteUiState {
  id: string;
  editing: boolean;
  draftText: string;
  sourceUrl: string;
  sourceTitle: string;
  committedText?: string;
}

let session: AgentSession | null = null;
let noteUiState = new Map<string, NoteUiState>();
let exportPayload: SessionExport | null = null;
let contextExceeded = false;
let lastSessionRunId = '';
let sideToastTimer = 0;
let onboardingStepIndex = 0;
let onboardingVisible = false;
const INTERNAL_NOTES_PASTE_DISABLED_MESSAGE = 'Paste is disabled during note-taking.';

const els = {
  appRoot: byId<HTMLElement>('appRoot'),
  modeBadge: byId<HTMLElement>('modeBadge'),
  openOnboardingBtn: byId<HTMLButtonElement>('openOnboardingBtn'),
  onboardingSection: byId<HTMLElement>('onboardingSection'),
  onboardingEyebrow: byId<HTMLElement>('onboardingEyebrow'),
  onboardingTitle: byId<HTMLElement>('onboardingTitle'),
  onboardingStepMeta: byId<HTMLElement>('onboardingStepMeta'),
  onboardingInduction: byId<HTMLElement>('onboardingInduction'),
  onboardingBody: byId<HTMLElement>('onboardingBody'),
  onboardingSupport: byId<HTMLElement>('onboardingSupport'),
  onboardingDossier: byId<HTMLElement>('onboardingDossier'),
  onboardingPrevBtn: byId<HTMLButtonElement>('onboardingPrevBtn'),
  onboardingFaqBtn: byId<HTMLButtonElement>('onboardingFaqBtn'),
  onboardingNextBtn: byId<HTMLButtonElement>('onboardingNextBtn'),
  dismissOnboardingBtn: byId<HTMLButtonElement>('dismissOnboardingBtn'),
  stateValue: byId<HTMLElement>('stateValue'),
  phaseValue: byId<HTMLElement>('phaseValue'),
  contextUsed: byId<HTMLElement>('contextUsed'),
  contextMax: byId<HTMLElement>('contextMax'),
  contextFill: byId<HTMLElement>('contextFill'),
  contextMeta: byId<HTMLElement>('contextMeta'),
  operationsUsed: byId<HTMLElement>('operationsUsed'),
  operationsMax: byId<HTMLElement>('operationsMax'),
  operationsFill: byId<HTMLElement>('operationsFill'),
  operationsMeta: byId<HTMLElement>('operationsMeta'),
  budgetSpent: byId<HTMLElement>('budgetSpent'),
  budgetTotal: byId<HTMLElement>('budgetTotal'),
  budgetFill: byId<HTMLElement>('budgetFill'),
  budgetMeta: byId<HTMLElement>('budgetMeta'),
  requesterQuestionDisplay: byId<HTMLElement>('requesterQuestionDisplay'),
  workOrderDisplay: byId<HTMLElement>('workOrderDisplay'),
  budgetDisplay: byId<HTMLElement>('budgetDisplay'),
  rankCandidatesList: byId<HTMLElement>('rankCandidatesList'),
  addRankCandidateBtn: byId<HTMLButtonElement>('addRankCandidateBtn'),
  finalizeRankCandidatesBtn: byId<HTMLButtonElement>('finalizeRankCandidatesBtn'),
  rankedPagesSection: byId<HTMLElement>('rankedPagesSection'),
  rankedPagesList: byId<HTMLElement>('rankedPagesList'),
  noteCaptureQueueMeta: byId<HTMLElement>('noteCaptureQueueMeta'),
  notesList: byId<HTMLElement>('notesList'),
  noteTemplate: byId<HTMLTemplateElement>('noteTemplate'),
  draftInput: byId<HTMLTextAreaElement>('draftInput'),
  traceList: byId<HTMLElement>('traceList'),
  exportSection: byId<HTMLElement>('exportSection'),
  exportSummary: byId<HTMLElement>('exportSummary'),
  startSessionBtn: byId<HTMLButtonElement>('startSessionBtn'),
  pauseResumeSessionBtn: byId<HTMLButtonElement>('pauseResumeSessionBtn'),
  abortSessionBtn: byId<HTMLButtonElement>('abortSessionBtn'),
  expandContextBtn: byId<HTMLButtonElement>('expandContextBtn'),
  endSessionBtn: byId<HTMLButtonElement>('endSessionBtn'),
  beginNoteCaptureBtn: byId<HTMLButtonElement>('beginNoteCaptureBtn'),
  newNoteBtn: byId<HTMLButtonElement>('newNoteBtn'),
  nextRankedPageBtn: byId<HTMLButtonElement>('nextRankedPageBtn'),
  enterDeliverableBtn: byId<HTMLButtonElement>('enterDeliverableBtn'),
  commitDraftBtn: byId<HTMLButtonElement>('commitDraftBtn'),
  downloadDeliverableBtn: byId<HTMLButtonElement>('downloadDeliverableBtn'),
  downloadJsonBtn: byId<HTMLButtonElement>('downloadJsonBtn'),
  deliverableSection: byId<HTMLElement>('deliverableSection'),
  sideToast: byId<HTMLElement>('sideToast')
};

void init();

async function init(): Promise<void> {
  bindEvents();
  initOnboarding();
  chrome.runtime.onMessage.addListener((message: BroadcastMessage) => {
    if (message?.type === 'SESSION_UPDATED') {
      session = message.session;
      syncUiState();
      render();
      return;
    }
    if (message?.type === 'SHOW_SIDE_TOAST' && message.message) {
      showSideToast(message.message, message.variant || 'default');
    }
  });

  const response = await sendMessage({ type: 'GET_SESSION' });
  session = response?.session || null;
  syncUiState();
  render();
}

function renderPdfCapabilityNotice(candidateSession: AgentSession): void {
  const latestTrace = candidateSession.trace[candidateSession.trace.length - 1];
  const blockedPdf = latestTrace?.kind === TraceKind.BLOCKED_ACTION
    && latestTrace.detail.startsWith('Blocked PDF navigation:');

  if (!blockedPdf) {
    if (els.sideToast.dataset.notice === 'pdf') {
      delete els.sideToast.dataset.notice;
      els.sideToast.textContent = '';
      els.sideToast.classList.remove('visible', 'success', 'error');
    }
    return;
  }

  clearTimeout(sideToastTimer);
  els.sideToast.dataset.notice = 'pdf';
  els.sideToast.textContent = PDF_TOOL_UNAVAILABLE_MESSAGE;
  els.sideToast.classList.remove('success');
  els.sideToast.classList.add('visible', 'error');
}

function bindEvents(): void {
  els.openOnboardingBtn.addEventListener('click', () => openOnboarding(0));
  els.onboardingPrevBtn.addEventListener('click', () => {
    onboardingStepIndex = Math.max(0, onboardingStepIndex - 1);
    renderOnboarding();
  });
  els.onboardingFaqBtn.addEventListener('click', () => {
    onboardingStepIndex = getFirstFaqStepIndex();
    renderOnboarding();
  });
  els.onboardingNextBtn.addEventListener('click', () => {
    if (onboardingStepIndex >= onboardingSteps.length - 1) {
      dismissOnboarding();
      return;
    }
    onboardingStepIndex += 1;
    renderOnboarding();
  });
  els.dismissOnboardingBtn.addEventListener('click', dismissOnboarding);
  els.startSessionBtn.addEventListener('click', async () => {
    const response = await sendMessage({ type: 'START_SESSION' });
    handleResponse(response);
    if (response?.ok) showSideToast('Assigned a requester question and opened source intake.', 'success');
  });
  els.pauseResumeSessionBtn.addEventListener('click', async () => {
    const paused = session?.sessionState === SessionState.PAUSED;
    handleResponse(await sendMessage({ type: paused ? 'RESUME_SESSION' : 'PAUSE_SESSION' }));
  });
  els.abortSessionBtn.addEventListener('click', async () => {
    const response = await sendMessage({ type: 'ABORT_SESSION' });
    handleResponse(response);
    if (response?.export) showExport(response.export);
  });
  els.expandContextBtn.addEventListener('click', async () => {
    const response = await sendMessage({ type: 'EXPAND_CONTEXT' });
    handleResponse(response);
    if (response?.ok) showSideToast(`Context expanded by ${CONTEXT_EXPANSION_TOKENS} tokens.`, 'success');
  });
  els.endSessionBtn.addEventListener('click', async () => {
    const response = await sendMessage({ type: 'COMPLETE_SESSION' });
    handleResponse(response);
    if (response?.export) showExport(response.export);
  });
  els.beginNoteCaptureBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab?.url) return;
    handleResponse(await sendMessage({
      type: 'BEGIN_NOTE_CAPTURE',
      payload: { tabId: tab.id, url: tab.url, title: tab.title || '' }
    }));
  });
  els.addRankCandidateBtn.addEventListener('click', addCurrentPageCandidate);
  els.finalizeRankCandidatesBtn.addEventListener('click', async () => handleResponse(await sendMessage({ type: 'FINALIZE_RANK_CANDIDATES' })));
  els.newNoteBtn.addEventListener('click', () => {
    const id = makeId('note');
    noteUiState.set(id, {
      id,
      editing: true,
      draftText: '',
      sourceUrl: session?.noteCaptureLockedUrl || session?.activeUrl || '',
      sourceTitle: session?.activeTitle || ''
    });
    renderNotes();
  });
  els.nextRankedPageBtn.addEventListener('click', async () => handleResponse(await sendMessage({ type: 'NEXT_NOTE_CAPTURE_SOURCE' })));
  els.enterDeliverableBtn.addEventListener('click', async () => handleResponse(await sendMessage({ type: 'ENTER_DELIVERABLE' })));
  els.commitDraftBtn.addEventListener('click', async () => {
    const response = await sendMessage({ type: 'COMMIT_DRAFT', payload: { committedText: els.draftInput.value } });
    if (response?.ok && response?.session) showSideToast('Draft saved. End the session to export your deliverable.', 'success');
    handleResponse(response);
  });
  els.draftInput.addEventListener('input', updateLimitWarning);
  els.downloadDeliverableBtn.addEventListener('click', () => {
    if (!exportPayload?.deliverable) return;
    downloadDeliverableFile(session?.task || 'Deliverable', exportPayload);
  });
  els.downloadJsonBtn.addEventListener('click', () => {
    if (!exportPayload) return;
    downloadSessionExportFile(exportPayload);
  });
}

function handleResponse(response: RuntimeResponse | null): void {
  if (!response) return;
  if (response.error) {
    showSideToast(responseMessages[response.error] || 'Something went wrong. Try again.', 'error');
    return;
  }
  if (response.session) {
    session = response.session;
    syncUiState();
    render();
  }
}

function resetLocalSessionUi(): void {
  noteUiState = new Map();
  contextExceeded = false;
  exportPayload = null;
  els.exportSection.classList.add('hidden');
  els.draftInput.value = '';
  clearTimeout(sideToastTimer);
  els.sideToast.classList.remove('visible', 'success', 'error');
}

function syncUiState(): void {
  if (!session) return;
  const runId = session.sessionRunId || '';
  if (runId !== lastSessionRunId) {
    lastSessionRunId = runId;
    resetLocalSessionUi();
  }
  const committedIds = new Set((session.notes || []).map(note => note.id));
  for (const note of session.notes || []) {
    const existing = noteUiState.get(note.id);
    noteUiState.set(note.id, {
      id: note.id,
      editing: existing?.editing || false,
      draftText: existing?.editing ? existing.draftText : note.committedText,
      sourceUrl: note.sourceUrl,
      sourceTitle: note.sourceTitle,
      committedText: note.committedText
    });
  }
  for (const id of [...noteUiState.keys()]) {
    if (!committedIds.has(id)) {
      const ui = noteUiState.get(id);
      if (!ui?.editing) noteUiState.delete(id);
    }
  }
  els.draftInput.value = session.draft?.committedText || '';
}

function render(): void {
  if (!session) return;
  document.body.dataset.sessionState = session.sessionState || '';
  document.body.dataset.phase = session.phase || '';
  els.appRoot.dataset.sessionState = session.sessionState || '';
  els.appRoot.dataset.phase = session.phase || '';

  const operationsMax = getOperationsMax(session);
  const spendOpsCents = Math.max(0, session.spendCents - session.contextExpansionSpendCents);
  const spendContextCents = session.contextExpansionSpendCents;
  const budgetRatio = session.budgetCents ? session.spendCents / session.budgetCents : 0;
  const opsRatio = operationsMax ? session.operationsUsed / operationsMax : 0;

  els.modeBadge.textContent = session.sessionState === SessionState.ACTIVE ? 'HUMAN MODE ON' : session.sessionState.toUpperCase();
  els.stateValue.textContent = pretty(session.sessionState);
  els.phaseValue.textContent = pretty(session.phase);
  els.contextMax.textContent = String(session.contextMax);
  applyProjectedContextUi();
  els.operationsUsed.textContent = String(session.operationsUsed);
  els.operationsMax.textContent = String(operationsMax);
  els.operationsMeta.textContent = `Estimated horizon at ${formatMoneyPrecise(OPERATION_COST_CENTS)} / operation.`;
  els.budgetSpent.textContent = formatMoneyPrecise(session.spendCents);
  els.budgetTotal.textContent = formatMoney(session.budgetCents);
  els.budgetMeta.textContent = `Ops ${formatMoneyPrecise(spendOpsCents)} | Context ${formatMoneyPrecise(spendContextCents)} | Remaining ${formatMoneyPrecise(getBudgetRemainingCents(session))} | Context rate ${formatMoney(TOKEN_COST_CENTS_PER_TOKEN)} / token`;
  els.requesterQuestionDisplay.textContent = session.requesterQuestion || 'No requester question assigned yet.';
  els.requesterQuestionDisplay.classList.toggle('muted', !session.requesterQuestion);
  els.workOrderDisplay.textContent = session.workOrder || 'No work order assigned yet.';
  els.workOrderDisplay.classList.toggle('muted', !session.workOrder);
  els.budgetDisplay.textContent = `Maximum completion budget: ${formatMoney(session.budgetCents || DEFAULT_BUDGET_CENTS)}.`;
  els.budgetDisplay.classList.remove('muted');

  setBar(els.operationsFill, opsRatio, 0.85);
  setBar(els.budgetFill, budgetRatio, 0.85);
  renderButtons();
  renderRankCandidates();
  renderRankedPages();
  renderNoteCaptureQueueMeta();
  renderNotes();
  renderDeliverableNotes();
  renderTrace();
  renderOnboarding();
  renderPdfCapabilityNotice(session);
}

function setBar(el: HTMLElement, ratio: number, warnThreshold: number): void {
  const pct = Math.min(100, Math.max(0, Math.round(ratio * 100)));
  el.style.width = `${pct}%`;
  el.className = 'fill';
  if (ratio >= 1) el.classList.add('danger');
  else if (ratio >= warnThreshold) el.classList.add('warn');
}

function renderButtons(): void {
  if (!session) return;
  const active = session.sessionState === SessionState.ACTIVE;
  const paused = session.sessionState === SessionState.PAUSED;
  const inRetrieval = session.phase === Phase.RETRIEVAL;
  const inInspection = session.phase === Phase.INSPECTION;
  const inCapture = session.phase === Phase.NOTE_CAPTURE;
  const inDeliverable = session.phase === Phase.DELIVERABLE;
  const canManageCandidates = active && (inRetrieval || inInspection);
  const hasCandidates = (session.rankCandidates || []).length > 0;
  const currentPageCandidate = isCandidatePage(session.activeUrl);
  const currentPageAdded = hasRankCandidate(session.activeUrl);

  els.startSessionBtn.disabled = !(session.sessionState === SessionState.OFF || session.sessionState === SessionState.COMPLETED || session.sessionState === SessionState.ABORTED);
  els.pauseResumeSessionBtn.disabled = !(active || paused);
  els.pauseResumeSessionBtn.textContent = paused ? 'Resume' : 'Pause';
  els.abortSessionBtn.disabled = !(active || paused);
  els.expandContextBtn.disabled = !active;
  els.endSessionBtn.disabled = !(active && inDeliverable);
  els.addRankCandidateBtn.disabled = !(canManageCandidates && !session.candidateSetFinalized && currentPageCandidate && !currentPageAdded);
  els.finalizeRankCandidatesBtn.disabled = !(canManageCandidates && !session.candidateSetFinalized && hasCandidates);
  els.beginNoteCaptureBtn.disabled = !(canManageCandidates && hasCandidates && session.candidateSetFinalized);
  els.newNoteBtn.disabled = !(active && inCapture);
  els.nextRankedPageBtn.disabled = !canAdvanceNoteCapture();
  els.enterDeliverableBtn.disabled = !(active && inCapture);
  els.commitDraftBtn.disabled = !(active && inDeliverable);
  els.draftInput.disabled = !(active && inDeliverable);
  els.downloadDeliverableBtn.disabled = !exportPayload?.deliverable;
  els.downloadJsonBtn.disabled = !exportPayload;
  els.addRankCandidateBtn.textContent = currentPageAdded ? 'Added Candidate' : 'Add Candidate';
}

function initOnboarding(): void {
  try {
    const dismissed = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (dismissed === 'true') {
      onboardingVisible = false;
    } else {
      const legacyDismissed = localStorage.getItem(LEGACY_ONBOARDING_STORAGE_KEY);
      onboardingVisible = legacyDismissed !== 'true';
      if (legacyDismissed === 'true') {
        localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
        localStorage.removeItem(LEGACY_ONBOARDING_STORAGE_KEY);
      }
    }
  } catch {
    onboardingVisible = true;
  }
  renderOnboarding();
}

function openOnboarding(stepIndex = 0): void {
  onboardingStepIndex = Math.min(Math.max(stepIndex, 0), onboardingSteps.length - 1);
  onboardingVisible = true;
  renderOnboarding();
}

function dismissOnboarding(): void {
  onboardingVisible = false;
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
    localStorage.removeItem(LEGACY_ONBOARDING_STORAGE_KEY);
  } catch {
    // Local storage can be unavailable in hardened contexts.
  }
  renderOnboarding();
}

function getFirstFaqStepIndex(): number {
  const index = onboardingSteps.findIndex(step => step.type === 'faq');
  return index === -1 ? 0 : index;
}

function getFaqPageMeta(currentIndex: number): string {
  const faqSteps = onboardingSteps.filter(step => step.type === 'faq');
  const faqIndex = onboardingSteps.slice(0, currentIndex + 1).filter(step => step.type === 'faq').length;
  return `Page ${faqIndex} of ${faqSteps.length}`;
}

function getIntroPageMeta(currentIndex: number): string {
  const introSteps = onboardingSteps.filter(step => step.type !== 'faq');
  const introIndex = onboardingSteps.slice(0, currentIndex + 1).filter(step => step.type !== 'faq').length;
  return `Page ${introIndex} of ${introSteps.length}`;
}

function renderOnboarding(): void {
  const step = onboardingSteps[onboardingStepIndex] || onboardingSteps[0];
  if (!step) return;
  const isLastStep = onboardingStepIndex === onboardingSteps.length - 1;
  const isFaq = step.type === 'faq';
  els.onboardingSection.classList.toggle('hidden', !onboardingVisible);
  document.body.classList.toggle('onboarding-open', onboardingVisible);
  els.onboardingSection.dataset.onboardingType = step.type || 'induction';
  els.onboardingEyebrow.textContent = step.eyebrow || 'First-time guide';
  els.onboardingTitle.textContent = step.title;
  els.onboardingStepMeta.textContent = isFaq ? getFaqPageMeta(onboardingStepIndex) : getIntroPageMeta(onboardingStepIndex);
  renderOnboardingStep(step);
  els.onboardingPrevBtn.disabled = onboardingStepIndex === 0;
  els.onboardingFaqBtn.classList.toggle('hidden', isFaq);
  els.onboardingFaqBtn.disabled = isFaq;
  els.onboardingNextBtn.disabled = isLastStep;
  els.onboardingNextBtn.textContent = 'Next';
  els.dismissOnboardingBtn.textContent = 'Close';
}

function renderOnboardingStep(step: OnboardingStep): void {
  const isDossier = step.type === 'dossier';
  const isFaq = step.type === 'faq';
  els.onboardingInduction.classList.toggle('hidden', isDossier || isFaq);
  els.onboardingDossier.classList.toggle('hidden', !isDossier && !isFaq);
  if (isDossier) {
    els.onboardingBody.textContent = '';
    els.onboardingSupport.textContent = '';
    els.onboardingDossier.innerHTML = renderOnboardingDossier(step.flow || []);
    return;
  }
  if (isFaq) {
    els.onboardingBody.textContent = '';
    els.onboardingSupport.textContent = '';
    els.onboardingDossier.innerHTML = renderOnboardingFaq(step);
    return;
  }
  els.onboardingBody.innerHTML = step.bodyHtml || escapeHtml(step.body || '');
  els.onboardingSupport.textContent = step.support || '';
  els.onboardingBody.classList.toggle('hidden', !((step.bodyHtml || step.body || '').trim()));
  els.onboardingSupport.classList.toggle('hidden', !(step.support || '').trim());
  els.onboardingDossier.innerHTML = '';
}

function renderOnboardingDossier(flow: NonNullable<OnboardingStep['flow']>): string {
  const slips = flow.map((item, index) => `
    <article class="onboarding-dossier-slip">
      <div class="onboarding-slip-number">${String(index + 1).padStart(2, '0')}</div>
      <div class="onboarding-slip-copy">
        <div class="onboarding-slip-title">${escapeHtml(item.label)}</div>
        <div class="onboarding-slip-text">${escapeHtml(item.copy)}</div>
      </div>
    </article>
  `).join('');
  return `<div class="onboarding-dossier-route">${slips}</div>`;
}

function renderOnboardingFaq(step: OnboardingStep): string {
  return `
    <article class="onboarding-faq-card">
      <div class="onboarding-faq-meta">Common questions from humans entering agent-compatible work.</div>
      <div class="onboarding-faq-question">${escapeHtml(step.faqQuestion || '')}</div>
      <div class="onboarding-faq-answer">${escapeHtml(step.faqAnswer || '')}</div>
    </article>
  `;
}

async function addCurrentPageCandidate(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;
  handleResponse(await sendMessage({
    type: 'ADD_RANK_CANDIDATE',
    payload: { url: tab.url, title: tab.title || '' }
  }));
}

function renderRankCandidates(): void {
  if (!session) return;
  const container = els.rankCandidatesList;
  const candidates = session.rankCandidates || [];
  container.innerHTML = '';
  if (!candidates.length) {
    container.innerHTML = '<div class="trace-item">No candidate sources yet.</div>';
    return;
  }
  const inCapture = session.phase === Phase.NOTE_CAPTURE;
  const queueIndex = Number.isInteger(session.noteCaptureQueueIndex) ? session.noteCaptureQueueIndex : null;
  for (const [index, candidate] of candidates.entries()) {
    const node = document.createElement('article');
    const isCurrent = inCapture && queueIndex === index;
    const isVisited = inCapture && queueIndex !== null && index < queueIndex;
    node.className = 'rank-candidate';
    if (isCurrent) node.classList.add('current');
    if (isVisited) node.classList.add('visited');
    node.innerHTML = `
      <div class="rank-candidate-head">
        <div class="rank-candidate-copy">
          <div class="rank-candidate-title">${escapeHtml(candidate.title || 'Untitled page')}</div>
          <div class="rank-candidate-url">${escapeHtml(candidate.url)}</div>
        </div>
        <button class="secondary rank-candidate-remove-btn" type="button">Remove</button>
      </div>
    `;
    const removeBtn = node.querySelector<HTMLButtonElement>('.rank-candidate-remove-btn');
    if (removeBtn) {
      removeBtn.disabled = inCapture;
      removeBtn.addEventListener('click', async () => {
        handleResponse(await sendMessage({ type: 'REMOVE_RANK_CANDIDATE', payload: { id: candidate.id } }));
      });
    }
    container.appendChild(node);
  }
}

function renderRankedPages(): void {
  if (!session) return;
  const finalized = !!session.candidateSetFinalized;
  els.rankedPagesSection.classList.toggle('hidden', !finalized);
  if (!finalized) return;
  const container = els.rankedPagesList;
  const candidates = rankCandidatesInNoteCaptureOrder(session);
  const queueIndex = Number.isInteger(session.noteCaptureQueueIndex) ? session.noteCaptureQueueIndex : null;
  container.innerHTML = '';
  for (const [index, candidate] of candidates.entries()) {
    const node = document.createElement('article');
    const isCurrent = session.phase === Phase.NOTE_CAPTURE && queueIndex === index;
    const isVisited = session.phase === Phase.NOTE_CAPTURE && queueIndex !== null && index < queueIndex;
    const badge = isCurrent ? 'Current' : isVisited ? 'Visited' : '';
    node.className = 'rank-candidate ranked-page-card';
    if (isCurrent) node.classList.add('current');
    if (isVisited) node.classList.add('visited');
    node.innerHTML = `
      <div class="rank-candidate-head">
        <div class="ranked-page-order">${index + 1}</div>
        <div class="ranked-page-copy">
          <div class="rank-candidate-title">${escapeHtml(candidate.title || 'Untitled page')}</div>
          <div class="rank-candidate-url">${escapeHtml(candidate.url)}</div>
        </div>
        ${badge ? `<div class="rank-candidate-badge">${escapeHtml(badge)}</div>` : ''}
      </div>
    `;
    container.appendChild(node);
  }
}

function renderNoteCaptureQueueMeta(): void {
  if (!session) return;
  const total = (session.rankCandidates || []).length;
  if (!total) {
    els.noteCaptureQueueMeta.textContent = 'Add pages to the candidate set, then rank them before note capture.';
    return;
  }
  const queueIndex = Number.isInteger(session.noteCaptureQueueIndex) ? session.noteCaptureQueueIndex : null;
  if (session.phase === Phase.NOTE_CAPTURE && queueIndex !== null) {
    els.noteCaptureQueueMeta.textContent = `Locked to ranked source ${Math.min(queueIndex + 1, total)} of ${total}. Use Next Ranked Page when you are done with this source.`;
    return;
  }
  if (!session.candidateSetFinalized) {
    els.noteCaptureQueueMeta.textContent = `${total} candidate source${total === 1 ? '' : 's'} collected. Finish the set in the sidebar, then rank them on the page.`;
    return;
  }
  const label = total === 1 ? '1 candidate source is ready.' : `${total} candidate sources are ready.`;
  els.noteCaptureQueueMeta.textContent = `${label} Rank them on the page overlay, then begin note taking there.`;
}

function hasRankCandidate(url = ''): boolean {
  if (!session) return false;
  const normalized = normalizeTrackedUrl(url);
  if (!normalized) return false;
  return (session.rankCandidates || []).some(candidate => normalizeTrackedUrl(candidate.url) === normalized);
}

function canAdvanceNoteCapture(): boolean {
  if (!session) return false;
  const queueIndex = session.noteCaptureQueueIndex;
  return session.sessionState === SessionState.ACTIVE
    && session.phase === Phase.NOTE_CAPTURE
    && typeof queueIndex === 'number'
    && Number.isInteger(queueIndex)
    && queueIndex < (session.rankCandidates || []).length - 1;
}

function renderNotes(): void {
  if (!session) return;
  const container = els.notesList;
  const scrollEl = document.scrollingElement || document.documentElement;
  const preserveScroll = container.contains(document.activeElement);
  const prevScrollTop = scrollEl.scrollTop;
  container.innerHTML = '';
  const uiItems = [...noteUiState.values()];
  if (!uiItems.length) {
    container.innerHTML = '<div class="trace-item">No note blocks yet.</div>';
    if (preserveScroll) requestAnimationFrame(() => { scrollEl.scrollTop = prevScrollTop; });
    return;
  }
  for (const item of uiItems) {
    const note = session.notes.find(candidate => candidate.id === item.id);
    const node = els.noteTemplate.content.firstElementChild?.cloneNode(true) as HTMLElement | null;
    if (!node) continue;
    const title = node.querySelector<HTMLElement>('.note-title');
    const meta = node.querySelector<HTMLElement>('.note-meta');
    const readonly = node.querySelector<HTMLElement>('.note-readonly');
    const textarea = node.querySelector<HTMLTextAreaElement>('.note-text');
    const readonlyActions = node.querySelector<HTMLElement>('.readonly-actions');
    const editingActions = node.querySelector<HTMLElement>('.editing-actions');
    const commitBtn = node.querySelector<HTMLButtonElement>('.commit-note-btn');
    const reviseBtn = node.querySelector<HTMLButtonElement>('.revise-note-btn');
    const cancelBtn = node.querySelector<HTMLButtonElement>('.cancel-note-btn');
    const deleteBtn = node.querySelector<HTMLButtonElement>('.readonly-actions .delete-note-btn');
    if (!title || !meta || !readonly || !textarea || !readonlyActions || !editingActions || !commitBtn || !reviseBtn || !cancelBtn) continue;

    title.textContent = note ? 'Committed Note' : 'Note';
    const noteTextForMeta = note?.committedText || item.draftText || '';
    meta.textContent = `${item.sourceTitle || 'Current page'} | ${countWords(noteTextForMeta)} words | ${roughTokenCount(noteTextForMeta)} tokens`;
    readonly.textContent = note?.committedText || '';
    textarea.value = item.editing ? (item.draftText || note?.committedText || '') : '';
    bindInternalNotesPasteGuard(textarea);
    const editing = !!item.editing;
    node.classList.toggle('editing', editing);
    readonly.classList.toggle('hidden', editing);
    const allowPruneActions = !!note && (contextExceeded || session.phase === Phase.DELIVERABLE);
    readonlyActions.classList.toggle('hidden', editing || !allowPruneActions);
    textarea.classList.toggle('hidden', !editing);
    editingActions.classList.toggle('hidden', !editing);
    if (deleteBtn) deleteBtn.classList.toggle('hidden', !note);

    commitBtn.addEventListener('click', async () => {
      const response = await sendMessage({
        type: 'COMMIT_NOTE_BLOCK',
        payload: {
          id: item.id,
          committedText: textarea.value,
          sourceUrl: item.sourceUrl || session?.noteCaptureLockedUrl || session?.activeUrl || '',
          sourceTitle: item.sourceTitle || session?.activeTitle || ''
        }
      });
      if (response?.ok) {
        noteUiState.set(item.id, { ...item, editing: false, draftText: textarea.value, committedText: textarea.value });
      }
      handleResponse(response);
    });
    reviseBtn.addEventListener('click', async () => {
      noteUiState.set(item.id, {
        ...item,
        editing: true,
        draftText: note?.committedText || item.draftText || '',
        committedText: note?.committedText || ''
      });
      await sendMessage({ type: 'OPEN_NOTE_REVISION', payload: { id: item.id } });
      renderNotes();
    });
    cancelBtn.addEventListener('click', () => {
      if (note) noteUiState.set(item.id, { ...item, editing: false, draftText: note.committedText, committedText: note.committedText });
      else noteUiState.delete(item.id);
      renderNotes();
    });
    if (deleteBtn && note) {
      deleteBtn.addEventListener('click', async () => {
        noteUiState.delete(item.id);
        handleResponse(await sendMessage({ type: 'DELETE_NOTE_BLOCK', payload: { id: item.id } }));
      });
    }
    textarea.addEventListener('input', () => {
      noteUiState.set(item.id, { ...item, editing: true, draftText: textarea.value });
      updateLimitWarning();
    });
    container.appendChild(node);
  }

  if (preserveScroll) {
    requestAnimationFrame(() => {
      scrollEl.scrollTop = prevScrollTop;
      container.querySelector<HTMLTextAreaElement>('.note-card.editing .note-text')?.focus({ preventScroll: true });
    });
  }
}

function bindInternalNotesPasteGuard(textarea: HTMLTextAreaElement): void {
  textarea.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    const isPasteShortcut = (event.ctrlKey || event.metaKey) && key === 'v';
    const isShiftInsert = event.shiftKey && key === 'insert';
    if (!isPasteShortcut && !isShiftInsert) return;
    event.preventDefault();
    showSideToast(INTERNAL_NOTES_PASTE_DISABLED_MESSAGE, 'error');
  });
  textarea.addEventListener('paste', event => {
    event.preventDefault();
    showSideToast(INTERNAL_NOTES_PASTE_DISABLED_MESSAGE, 'error');
  });
}

function renderDeliverableNotes(): void {
  if (!session) return;
  els.deliverableSection.classList.toggle('deliverable-active', session.phase === Phase.DELIVERABLE);
  updateLimitWarning();
}

function getLiveNotesText(): string {
  const committedById = new Map((session?.notes || []).map(note => [note.id, note.committedText || '']));
  for (const [id, item] of noteUiState.entries()) {
    if (item?.editing) committedById.set(id, item.draftText || '');
    else if (!committedById.has(id) && item?.draftText) committedById.set(id, item.draftText);
  }
  return [...committedById.values()].join('\n');
}

function getProjectedContextBreakdown() {
  return getContextBreakdownFromParts({
    task: getTaskContextText(session || {}),
    notesText: getLiveNotesText(),
    draftText: els.draftInput.value || ''
  });
}

function applyProjectedContextUi(): void {
  if (!session) return;
  const breakdown = getProjectedContextBreakdown();
  els.contextUsed.textContent = String(breakdown.total);
  els.contextMeta.textContent = `Task ${breakdown.task} | Notes ${breakdown.notes} | Draft ${breakdown.draft}`;
  const contextRatio = session.contextMax ? breakdown.total / session.contextMax : 0;
  setBar(els.contextFill, contextRatio, CONTEXT_WARNING_THRESHOLD);
}

function getProjectedContextUsage(): { tokens: number; maxTokens: number } {
  return {
    tokens: getProjectedContextBreakdown().total,
    maxTokens: Number(session?.contextMax) || 0
  };
}

function updateLimitWarning(): void {
  if (!session) return;
  applyProjectedContextUi();
  const usage = getProjectedContextUsage();
  const overBy = usage.tokens - usage.maxTokens;
  const nextExceeded = overBy > 0;
  if (nextExceeded !== contextExceeded) {
    contextExceeded = nextExceeded;
    renderNotes();
  }
}

function renderTrace(): void {
  if (!session?.trace?.length) {
    els.traceList.innerHTML = '<div class="trace-item">No measured actions yet.</div>';
    return;
  }
  els.traceList.innerHTML = session.trace.slice().reverse().map(item => `
    <div class="trace-item">
      <strong>${pretty(item.kind)}</strong><br>
      ${escapeHtml(item.detail)}<br>
      <span class="muted">${pretty(item.phase)}</span>
    </div>
  `).join('');
}

function showExport(exportData: SessionExport): void {
  exportPayload = exportData;
  els.exportSection.classList.remove('hidden');
  els.exportSummary.innerHTML = renderExportSummary(exportData);
  renderButtons();
}

async function sendMessage(message: RuntimeMessage): Promise<RuntimeResponse | null> {
  return chrome.runtime.sendMessage(message).catch(() => null);
}

let lastSideToastKey = '';
let lastSideToastAt = 0;
const SIDE_TOAST_DEBOUNCE_MS = 4000;

function showSideToast(message: string, variant: 'default' | 'success' | 'error' = 'default'): void {
  const key = `${variant}|${message}`;
  const timestamp = Date.now();
  if (key === lastSideToastKey && timestamp - lastSideToastAt < SIDE_TOAST_DEBOUNCE_MS) return;
  lastSideToastKey = key;
  lastSideToastAt = timestamp;
  els.sideToast.textContent = message;
  els.sideToast.classList.remove('success', 'error');
  if (variant === 'success') els.sideToast.classList.add('success');
  else if (variant === 'error') els.sideToast.classList.add('error');
  clearTimeout(sideToastTimer);
  els.sideToast.classList.add('visible');
  sideToastTimer = window.setTimeout(() => {
    els.sideToast.classList.remove('visible', 'success', 'error');
  }, 4000);
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}
