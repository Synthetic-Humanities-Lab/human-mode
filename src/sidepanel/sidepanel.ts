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
  makeSessionExport,
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
let saving = false;
let endingSession = false;
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
  budgetRemaining: byId<HTMLElement>('budgetRemaining'),
  budgetFill: byId<HTMLElement>('budgetFill'),
  budgetMeta: byId<HTMLElement>('budgetMeta'),
  sessionActions: byId<HTMLElement>('sessionActions'),
  sessionFinishedMessage: byId<HTMLElement>('sessionFinishedMessage'),
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
  els.abortSessionBtn.addEventListener('click', () => finishSession('ABORT_SESSION'));
  els.expandContextBtn.addEventListener('click', async () => {
    const response = await sendMessage({ type: 'EXPAND_CONTEXT' });
    handleResponse(response);
    if (response?.ok) showSideToast(`Context expanded by ${CONTEXT_EXPANSION_TOKENS} tokens.`, 'success');
  });
  els.endSessionBtn.addEventListener('click', () => finishSession('COMPLETE_SESSION'));
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
  els.commitDraftBtn.addEventListener('click', () => saveMessage(
    { type: 'COMMIT_DRAFT', payload: { committedText: els.draftInput.value } },
    () => showSideToast('Draft saved. End the session to export your deliverable.', 'success')
  ));
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

async function saveMessage(message: RuntimeMessage, onSaved: () => void): Promise<void> {
  if (saving || endingSession) return;
  saving = true;
  renderButtons();
  try {
    const response = await sendMessage(message);
    if (response?.ok) onSaved();
    handleResponse(response);
  } finally {
    saving = false;
    renderButtons();
  }
}

async function finishSession(type: 'ABORT_SESSION' | 'COMPLETE_SESSION'): Promise<void> {
  if (saving || endingSession) return;
  endingSession = true;
  renderButtons();
  try {
    handleResponse(await sendMessage({ type }));
  } finally {
    endingSession = false;
    renderButtons();
  }
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

  const spendOpsCents = Math.max(0, session.spendCents - session.textSpendCents - session.contextExpansionSpendCents);
  const budgetRatio = session.budgetCents ? session.spendCents / session.budgetCents : 0;

  els.modeBadge.textContent = session.sessionState === SessionState.ACTIVE ? 'ON' : session.sessionState.toUpperCase();
  els.stateValue.textContent = pretty(session.sessionState);
  els.phaseValue.textContent = ({ start: 'Request', framing: 'Request', retrieval: 'Collect', inspection: 'Rank', note_capture: 'Notes', deliverable: 'Deliver' })[session.phase];
  els.contextMax.textContent = String(session.contextMax);
  applyProjectedContextUi();
  els.budgetRemaining.textContent = formatMoney(getBudgetRemainingCents(session));
  els.budgetMeta.textContent = [
    'Spent',
    `Actions ${formatMoney(spendOpsCents)}`,
    `Text ${formatMoney(session.textSpendCents)}`,
    `Capacity ${formatMoney(session.contextExpansionSpendCents)}`
  ].join(' · ');
  els.requesterQuestionDisplay.textContent = session.requesterQuestion || 'No requester question assigned yet.';
  els.requesterQuestionDisplay.classList.toggle('muted', !session.requesterQuestion);
  els.workOrderDisplay.textContent = session.workOrder || 'No work order assigned yet.';
  els.workOrderDisplay.classList.toggle('muted', !session.workOrder);

  setBar(els.budgetFill, budgetRatio, 0.85);
  renderExport();
  renderButtons();
  renderRankCandidates();
  renderRankedPages();
  renderLayout();
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
  const allSourcesCovered = hasCandidates && session.rankCandidates.every(candidate => hasCommittedNoteForSource(session, candidate.url));
  const currentPageCandidate = isCandidatePage(session.activeUrl);
  const currentPageAdded = hasRankCandidate(session.activeUrl);
  const finished = session.sessionState === SessionState.COMPLETED || session.sessionState === SessionState.ABORTED;
  const busy = saving || endingSession;

  els.startSessionBtn.disabled = busy || !(session.sessionState === SessionState.OFF || finished);
  els.startSessionBtn.innerHTML = finished ? 'New Session' : 'Start Session <span aria-hidden="true">↗</span>';
  els.pauseResumeSessionBtn.disabled = busy || !(active || paused);
  els.pauseResumeSessionBtn.textContent = paused ? 'Resume' : 'Pause';
  els.abortSessionBtn.disabled = busy || !(active || paused);
  els.expandContextBtn.disabled = !active;
  els.endSessionBtn.disabled = busy || !(active && inDeliverable);
  els.addRankCandidateBtn.disabled = !(canManageCandidates && !session.candidateSetFinalized && currentPageCandidate && !currentPageAdded);
  els.finalizeRankCandidatesBtn.disabled = !(canManageCandidates && !session.candidateSetFinalized && hasCandidates);
  els.newNoteBtn.disabled = !(active && inCapture);
  els.nextRankedPageBtn.disabled = !canAdvanceNoteCapture();
  els.enterDeliverableBtn.disabled = !(active && inCapture && allSourcesCovered);
  els.commitDraftBtn.disabled = busy || !(active && inDeliverable);
  els.draftInput.disabled = busy || !(active && inDeliverable);
  els.notesList.querySelectorAll<HTMLButtonElement>('.commit-note-btn').forEach(button => {
    button.disabled = busy || !active;
  });
  els.notesList.querySelectorAll<HTMLTextAreaElement>('.note-text').forEach(textarea => {
    textarea.disabled = busy || !active;
  });
  els.downloadDeliverableBtn.disabled = !exportPayload?.deliverable;
  els.downloadJsonBtn.disabled = !exportPayload;
  els.addRankCandidateBtn.textContent = currentPageAdded ? 'Added Candidate' : 'Add Candidate';
}

function renderLayout(): void {
  if (!session) return;
  const state = session.sessionState;
  const live = state === SessionState.ACTIVE || state === SessionState.PAUSED;
  const collecting = session.phase === Phase.RETRIEVAL || session.phase === Phase.INSPECTION;
  const capturing = session.phase === Phase.NOTE_CAPTURE;
  const drafting = session.phase === Phase.DELIVERABLE;
  const finished = state === SessionState.COMPLETED;
  const ended = finished || state === SessionState.ABORTED;

  els.startSessionBtn.classList.toggle('hidden', live);
  els.sessionFinishedMessage.classList.toggle('hidden', !ended);
  els.sessionFinishedMessage.querySelector('strong')!.textContent = finished ? 'Session complete' : 'Session ended';
  els.sessionFinishedMessage.querySelector('span')!.textContent = finished ? 'Download your deliverable below.' : 'Download the session record below.';
  els.pauseResumeSessionBtn.classList.toggle('hidden', !live);
  els.endSessionBtn.classList.toggle('hidden', !(state === SessionState.ACTIVE && drafting));
  els.sessionActions.classList.toggle('hidden', !live);
  els.assignedTaskSection.classList.toggle('hidden', state === SessionState.OFF);
  els.candidateSection.classList.toggle('hidden', !(live && collecting));
  els.rankedPagesSection.classList.toggle('hidden', !(session.candidateSetFinalized && (capturing || drafting || finished)));
  els.notesSection.classList.toggle('hidden', !((live && (capturing || drafting)) || finished));
  els.deliverableSection.classList.toggle('hidden', !((live && drafting) || finished));
  els.traceSection.classList.toggle('hidden', state === SessionState.OFF);

  const stages = ['start', 'retrieval', 'inspection', 'note_capture', 'deliverable'];
  const current = Math.max(0, stages.indexOf(session.phase === Phase.FRAMING ? 'start' : session.phase));
  document.querySelectorAll<HTMLElement>('.workflow li').forEach((step, index) => {
    step.classList.toggle('current', !finished && index === current);
    step.classList.toggle('complete', finished || index < current);
    if (!finished && index === current) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  });
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
  if (!finalized) return;
  const container = els.rankedPagesList;
  const candidates = session.rankCandidates;
  const queueIndex = Number.isInteger(session.noteCaptureQueueIndex) ? session.noteCaptureQueueIndex : null;
  container.innerHTML = '';
  for (const [index, candidate] of candidates.entries()) {
    const node = document.createElement('article');
    const sourceHost = new URL(candidate.url).hostname.replace(/^www\./, '');
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
          <div class="ranked-page-meta">
            <div class="rank-candidate-url" title="${escapeHtml(candidate.url)}">${escapeHtml(sourceHost)}</div>
            ${badge ? `<div class="rank-candidate-badge">${escapeHtml(badge)}</div>` : ''}
          </div>
        </div>
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
    const active = session.sessionState === SessionState.ACTIVE;
    const editing = !!draft && active;
    node.classList.toggle('editing', editing);
    readonly.classList.toggle('hidden', editing);
    const allowPruneActions = active && !!note && (contextExceeded || session.phase === Phase.DELIVERABLE);
    readonlyActions.classList.toggle('hidden', editing || !allowPruneActions);
    textarea.classList.toggle('hidden', !editing);
    editingActions.classList.toggle('hidden', !editing);
    if (deleteBtn) deleteBtn.classList.toggle('hidden', !note);
    commitBtn.disabled = saving || endingSession || !active;
    textarea.disabled = saving || endingSession || !active;

    commitBtn.addEventListener('click', () => saveMessage({
      type: 'COMMIT_NOTE_BLOCK',
      payload: {
        id: item.id,
        committedText: textarea.value,
        sourceUrl: item.sourceUrl || session?.noteCaptureLockedUrl || session?.activeUrl || '',
        sourceTitle: item.sourceTitle || session?.activeTitle || ''
      }
    }, () => { noteUiState.delete(item.id); }));
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

function renderExport(): void {
  const state = session?.sessionState;
  exportPayload = session && (state === SessionState.COMPLETED || state === SessionState.ABORTED)
    ? makeSessionExport(session, state)
    : null;
  els.exportSection.classList.toggle('hidden', !exportPayload);
  els.exportSummary.innerHTML = exportPayload ? renderExportSummary(exportPayload) : '';
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
