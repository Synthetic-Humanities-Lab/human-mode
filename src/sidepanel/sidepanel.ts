import { DEFAULT_BUDGET_CENTS, OPERATION_COST_CENTS, TOKEN_COST_CENTS_PER_TOKEN, getOperationsMax } from '../shared';
import {
  AgentSession,
  BroadcastMessage,
  CONTEXT_EXPANSION_TOKENS,
  CONTEXT_WARNING_THRESHOLD,
  escapeHtml,
  PDF_TOOL_UNAVAILABLE_MESSAGE,
  Phase,
  pretty,
  RuntimeMessage,
  RuntimeResponse,
  SessionExport,
  SessionState,
  TraceKind,
  formatMoney,
  getBudgetRemainingCents,
  getContextBreakdownFromParts,
  getTaskContextText,
  hasCommittedNoteForSource,
  isCandidatePage,
  makeId,
  NoteBlock,
  normalizeTrackedUrl,
  roughTokenCount
} from '../shared';
import { LEGACY_ONBOARDING_STORAGE_KEY, ONBOARDING_STORAGE_KEY, OnboardingStep, onboardingSteps, responseMessages } from './copy';
import { downloadDeliverableFile, downloadSessionExportFile, renderExportSummary } from './export';
import { initGuidance } from './guidance';

interface NoteUiState {
  id: string;
  draftText: string;
  sourceUrl: string;
  sourceTitle: string;
}

let session: AgentSession | null = null;
let deferredSession: AgentSession | null = null;
let noteUiState = new Map<string, NoteUiState>();
let exportPayload: SessionExport | null = null;
let contextExceeded = false;
let lastSessionRunId = '';
const retiredSessionRunIds = new Set<string>();
let sideToastTimer = 0;
let onboardingStepIndex = 0;

const els = {
  appRoot: byId<HTMLElement>('appRoot'),
  modeBadge: byId<HTMLElement>('modeBadge'),
  openOnboardingBtn: byId<HTMLButtonElement>('openOnboardingBtn'),
  openFaqBtn: byId<HTMLButtonElement>('openFaqBtn'),
  onboardingSection: byId<HTMLDialogElement>('onboardingSection'),
  onboardingEyebrow: byId<HTMLElement>('onboardingEyebrow'),
  onboardingTitle: byId<HTMLElement>('onboardingTitle'),
  onboardingStepMeta: byId<HTMLElement>('onboardingStepMeta'),
  onboardingInduction: byId<HTMLElement>('onboardingInduction'),
  onboardingBody: byId<HTMLElement>('onboardingBody'),
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
  budgetDisplay: byId<HTMLElement>('budgetDisplay'),
  budgetFill: byId<HTMLElement>('budgetFill'),
  budgetMeta: byId<HTMLElement>('budgetMeta'),
  assignedTaskSection: byId<HTMLElement>('assignedTaskSection'),
  candidateSection: byId<HTMLElement>('candidateSection'),
  notesSection: byId<HTMLElement>('notesSection'),
  traceSection: byId<HTMLElement>('traceSection'),
  requesterQuestionDisplay: byId<HTMLElement>('requesterQuestionDisplay'),
  workOrderDisplay: byId<HTMLElement>('workOrderDisplay'),
  rankCandidatesList: byId<HTMLElement>('rankCandidatesList'),
  addRankCandidateBtn: byId<HTMLButtonElement>('addRankCandidateBtn'),
  finalizeRankCandidatesBtn: byId<HTMLButtonElement>('finalizeRankCandidatesBtn'),
  rankedPagesSection: byId<HTMLElement>('rankedPagesSection'),
  rankedPagesList: byId<HTMLElement>('rankedPagesList'),
  notesList: byId<HTMLElement>('notesList'),
  notesProgress: byId<HTMLElement>('notesProgress'),
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
  initGuidance(() => { if (els.onboardingSection.open) dismissOnboarding(); }, showSideToast, () => {
    if (deferredSession) { const next = deferredSession; deferredSession = null; adoptSession(next); }
  });
  chrome.runtime.onMessage.addListener((message: BroadcastMessage) => {
    if (message?.type === 'SESSION_UPDATED') {
      adoptSession(message.session);
      return;
    }
    if (message?.type === 'SHOW_SIDE_TOAST' && message.message) {
      showSideToast(message.message, message.variant || 'default');
    }
  });

  const response = await sendMessage({ type: 'GET_SESSION' });
  adoptSession(response?.session || null);
}

function adoptSession(next: AgentSession | null): void {
  if (!next || retiredSessionRunIds.has(next.sessionRunId)) return;
  if (document.body.dataset.sectionTour) { deferredSession = next; return; }
  session = next;
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
  els.openFaqBtn.addEventListener('click', () => openOnboarding(getFirstFaqStepIndex()));
  els.onboardingPrevBtn.addEventListener('click', () => {
    onboardingStepIndex = Math.max(0, onboardingStepIndex - 1);
    renderOnboarding();
  });
  els.onboardingFaqBtn.addEventListener('click', () => {
    onboardingStepIndex = getFirstFaqStepIndex();
    renderOnboarding();
  });
  els.onboardingNextBtn.addEventListener('click', () => {
    const nextStep = onboardingSteps[onboardingStepIndex + 1];
    if (!nextStep || (onboardingSteps[onboardingStepIndex]?.type !== 'faq' && nextStep.type === 'faq')) {
      dismissOnboarding();
      return;
    }
    onboardingStepIndex += 1;
    renderOnboarding();
  });
  els.dismissOnboardingBtn.addEventListener('click', dismissOnboarding);
  els.onboardingSection.addEventListener('cancel', event => {
    event.preventDefault();
    dismissOnboarding();
  });
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
  els.addRankCandidateBtn.addEventListener('click', addCurrentPageCandidate);
  els.finalizeRankCandidatesBtn.addEventListener('click', async () => handleResponse(await sendMessage({ type: 'FINALIZE_RANK_CANDIDATES' })));
  els.newNoteBtn.addEventListener('click', () => {
    const id = makeId('note');
    noteUiState.set(id, {
      id,
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
    adoptSession(response.session);
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
    if (lastSessionRunId) retiredSessionRunIds.add(lastSessionRunId);
    lastSessionRunId = runId;
    resetLocalSessionUi();
  }
  els.draftInput.value = session.draft?.committedText || '';
}

function render(): void {
  if (!session) return;
  els.appRoot.dataset.sessionState = session.sessionState || '';

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
  els.operationsMeta.textContent = `Estimated horizon at ${formatMoney(OPERATION_COST_CENTS)} / operation.`;
  els.budgetSpent.textContent = formatMoney(session.spendCents);
  els.budgetTotal.textContent = formatMoney(session.budgetCents);
  els.budgetMeta.textContent = `Ops ${formatMoney(spendOpsCents)} | Context ${formatMoney(spendContextCents)} | Remaining ${formatMoney(getBudgetRemainingCents(session))} | Context rate ${formatMoney(TOKEN_COST_CENTS_PER_TOKEN)} / token`;
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
  renderNotes();
  updateLimitWarning();
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
    if (localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'true' || localStorage.getItem(LEGACY_ONBOARDING_STORAGE_KEY) === 'true') {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
      localStorage.removeItem(LEGACY_ONBOARDING_STORAGE_KEY);
      return;
    }
  } catch {
    // Show the guide when local storage is unavailable.
  }
  openOnboarding();
}

function openOnboarding(stepIndex = 0): void {
  onboardingStepIndex = Math.min(Math.max(stepIndex, 0), onboardingSteps.length - 1);
  renderOnboarding();
  if (!els.onboardingSection.open) els.onboardingSection.showModal();
}

function dismissOnboarding(): void {
  els.onboardingSection.close();
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
    localStorage.removeItem(LEGACY_ONBOARDING_STORAGE_KEY);
  } catch {
    // Local storage can be unavailable in hardened contexts.
  }
}

function getFirstFaqStepIndex(): number {
  const index = onboardingSteps.findIndex(step => step.type === 'faq');
  return index === -1 ? 0 : index;
}

function getOnboardingPageMeta(currentIndex: number): string {
  const step = onboardingSteps[currentIndex]!;
  const group = onboardingSteps.filter(candidate => (candidate.type === 'faq') === (step.type === 'faq'));
  return `Page ${group.indexOf(step) + 1} of ${group.length}`;
}

function renderOnboarding(): void {
  const step = onboardingSteps[onboardingStepIndex] || onboardingSteps[0];
  if (!step) return;
  const isLastStep = onboardingStepIndex === onboardingSteps.length - 1;
  const isFaq = step.type === 'faq';
  const isLastIntro = !isFaq && onboardingSteps[onboardingStepIndex + 1]?.type === 'faq';
  els.onboardingSection.dataset.onboardingType = step.type || 'induction';
  els.onboardingEyebrow.textContent = step.eyebrow || 'First-time guide';
  els.onboardingTitle.textContent = step.title;
  els.onboardingStepMeta.textContent = getOnboardingPageMeta(onboardingStepIndex);
  renderOnboardingStep(step);
  els.onboardingPrevBtn.disabled = onboardingStepIndex === 0;
  els.onboardingFaqBtn.classList.toggle('hidden', isFaq);
  els.onboardingFaqBtn.disabled = isFaq;
  els.onboardingNextBtn.disabled = false;
  els.onboardingNextBtn.textContent = isLastIntro ? 'Go to session' : isLastStep ? 'Done' : 'Next';
  els.dismissOnboardingBtn.textContent = 'Close';
}

function renderOnboardingStep(step: OnboardingStep): void {
  const isDossier = step.type === 'dossier';
  const isFaq = step.type === 'faq';
  els.onboardingInduction.classList.toggle('hidden', isDossier || isFaq);
  els.onboardingDossier.classList.toggle('hidden', !isDossier && !isFaq);
  if (isDossier) {
    els.onboardingBody.textContent = '';
    els.onboardingDossier.innerHTML = renderOnboardingDossier(step.flow || []);
    return;
  }
  if (isFaq) {
    els.onboardingBody.textContent = '';
    els.onboardingDossier.innerHTML = renderOnboardingFaq(step);
    return;
  }
  els.onboardingBody.innerHTML = step.bodyHtml || '';
  els.onboardingBody.classList.toggle('hidden', !(step.bodyHtml || '').trim());
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
  for (const candidate of candidates) {
    const node = document.createElement('article');
    node.className = 'rank-candidate';
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
      removeBtn.disabled = session.sessionState !== SessionState.ACTIVE
        || (session.phase !== Phase.RETRIEVAL && session.phase !== Phase.INSPECTION)
        || !!session.candidateSetFinalized;
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
  const candidates = session.rankCandidates;
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
    && hasCommittedNoteForSource(session, session.rankCandidates[queueIndex]?.url)
    && queueIndex < (session.rankCandidates || []).length - 1;
}

function renderNotes(): void {
  if (!session) return;
  const covered = session.rankCandidates.filter(candidate => hasCommittedNoteForSource(session, candidate.url)).length;
  els.notesProgress.textContent = `${covered} of ${session.rankCandidates.length} ranked sources have a committed note.`;
  const container = els.notesList;
  const scrollEl = document.scrollingElement || document.documentElement;
  const preserveScroll = container.contains(document.activeElement);
  const prevScrollTop = scrollEl.scrollTop;
  container.innerHTML = '';
  const committedById = new Map(session.notes.map(note => [note.id, note]));
  const uiItems = new Map<string, NoteBlock | NoteUiState>(committedById);
  for (const [id, draft] of noteUiState) uiItems.set(id, draft);
  if (!uiItems.size) {
    container.innerHTML = '<div class="trace-item">No note blocks yet.</div>';
    if (preserveScroll) requestAnimationFrame(() => { scrollEl.scrollTop = prevScrollTop; });
    return;
  }
  for (const item of uiItems.values()) {
    const note = committedById.get(item.id);
    const draft = noteUiState.get(item.id);
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
    const noteTextForMeta = note?.committedText || draft?.draftText || '';
    const noteWords = roughTokenCount(noteTextForMeta);
    meta.textContent = `${item.sourceTitle || 'Current page'} | ${noteWords} words | ${noteWords} tokens`;
    readonly.textContent = note?.committedText || '';
    textarea.value = draft?.draftText ?? '';
    const editing = !!draft;
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
        noteUiState.delete(item.id);
      }
      handleResponse(response);
    });
    reviseBtn.addEventListener('click', async () => {
      noteUiState.set(item.id, {
        id: item.id,
        sourceUrl: item.sourceUrl,
        sourceTitle: item.sourceTitle,
        draftText: note?.committedText || ''
      });
      await sendMessage({ type: 'OPEN_NOTE_REVISION', payload: { id: item.id } });
      renderNotes();
    });
    cancelBtn.addEventListener('click', () => {
      noteUiState.delete(item.id);
      updateLimitWarning();
      renderNotes();
    });
    if (deleteBtn && note) {
      deleteBtn.addEventListener('click', async () => {
        noteUiState.delete(item.id);
        handleResponse(await sendMessage({ type: 'DELETE_NOTE_BLOCK', payload: { id: item.id } }));
      });
    }
    textarea.addEventListener('input', () => {
      noteUiState.set(item.id, { ...draft!, draftText: textarea.value });
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

function getLiveNotesText(): string {
  const committedById = new Map((session?.notes || []).map(note => [note.id, note.committedText || '']));
  for (const [id, item] of noteUiState.entries()) {
    committedById.set(id, item.draftText);
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

function applyProjectedContextUi(): number {
  if (!session) return 0;
  const breakdown = getProjectedContextBreakdown();
  els.contextUsed.textContent = String(breakdown.total);
  els.contextMeta.textContent = `Assigned task ${breakdown.task} | Notes ${breakdown.notes} | Draft ${breakdown.draft}`;
  const contextRatio = session.contextMax ? breakdown.total / session.contextMax : 0;
  setBar(els.contextFill, contextRatio, CONTEXT_WARNING_THRESHOLD);
  return breakdown.total;
}

function updateLimitWarning(): void {
  if (!session) return;
  const nextExceeded = applyProjectedContextUi() > session.contextMax;
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
