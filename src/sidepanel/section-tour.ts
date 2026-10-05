import { DEFAULT_BUDGET_CENTS, escapeHtml, formatMoney, OPERATION_COST_CENTS } from '../shared';
import { tutorialSources, tutorialTask } from './copy';

const steps = [
  { section: 'assignedTaskSection', title: 'Start with the request', body: 'The question defines what to answer. The work order sets the scope of your research.' },
  { section: 'resourcesPanel', title: 'Watch your resources', body: 'Actions and committed text use the simulated budget. Shorten notes or expand context to make room for your answer.' },
  { section: 'candidateSection', title: 'Collect relevant sources', body: 'Add webpages with useful evidence. Done Adding Sources opens ranking.' },
  { section: 'rankedPagesSection', title: 'Choose the reading route', body: 'Rank sources by relevance and useful evidence. Begin Note Taking locks the reading order.' },
  { section: 'notesSection', title: 'Keep the evidence you need', body: 'Commit evidence from each source. These notes are all you can use when writing the deliverable.' },
  { section: 'deliverableSection', title: 'Turn evidence into an answer', body: 'Write your answer from retained notes. End Session delivers your last committed draft.' },
  { section: 'exportSection', title: 'Save the answer and the process', body: 'Download your answer or the session record.' }
] as const;

export function initSectionTour(beforeOpen: () => void, afterClose: () => void): void {
  const dialog = document.getElementById('tutorialDialog') as HTMLDialogElement;
  const app = document.getElementById('appRoot')!;
  const title = document.getElementById('tutorialTitle')!;
  const back = document.getElementById('tutorialBackBtn') as HTMLButtonElement;
  const next = document.getElementById('tutorialNextBtn') as HTMLButtonElement;
  let index = 0;
  let scrollPosition = 0;
  let returnFocus: HTMLElement | null = null;
  let highlighted: HTMLElement | null = null;
  const restore: (() => void)[] = [];
  for (const id of ['openTutorialBtn', 'onboardingTutorialBtn']) document.getElementById(id)!.addEventListener('click', () => {
    beforeOpen();
    returnFocus = document.activeElement as HTMLElement;
    scrollPosition = window.scrollY;
    index = 0;
    document.body.dataset.sectionTour = 'true';
    app.inert = true;
    for (const step of steps) {
      const panel = document.getElementById(step.section)!;
      const hidden = panel.classList.contains('hidden');
      panel.classList.remove('hidden');
      restore.push(() => panel.classList.toggle('hidden', hidden));
    }
    showExamples();
    dialog.show();
    render();
  });
  document.getElementById('exitTutorialBtn')!.addEventListener('click', () => dialog.close());
  back.addEventListener('click', () => { index--; render(); });
  next.addEventListener('click', () => {
    if (index === steps.length - 1) dialog.close();
    else { index++; render(); }
  });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); dialog.close(); }
    if (event.key === 'Tab') {
      const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const first = buttons[0]!;
      const last = buttons[buttons.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === title)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  dialog.addEventListener('close', () => {
    highlighted?.classList.remove('tour-highlight');
    while (restore.length) restore.pop()!();
    app.inert = false;
    delete document.body.dataset.sectionTour;
    document.body.style.removeProperty('--tour-guide-height');
    afterClose();
    returnFocus?.focus({ preventScroll: true });
    window.scrollTo({ top: scrollPosition, behavior: 'instant' });
  });
  const resize = new ResizeObserver(() => {
    if (dialog.open) document.body.style.setProperty('--tour-guide-height', `${dialog.offsetHeight + 32}px`);
  });
  resize.observe(dialog);

  function showExamples(): void {
    const content = (id: string, value: string, html = false) => {
      const node = document.getElementById(id)!;
      const children = [...node.childNodes];
      const muted = node.classList.contains('muted');
      restore.push(() => { node.replaceChildren(...children); node.classList.toggle('muted', muted); });
      if (html) node.innerHTML = value;
      else node.textContent = value;
      node.classList.remove('muted');
    };
    const text = (id: string, value: string) => content(id, value);
    text('requesterQuestionDisplay', tutorialTask.requesterQuestion);
    text('workOrderDisplay', tutorialTask.workOrder);
    text('stateValue', 'Active');
    text('phaseValue', 'Collect');
    const exampleSpendCents = OPERATION_COST_CENTS; // The initial search; starting is free.
    text('budgetRemaining', formatMoney(Math.round(DEFAULT_BUDGET_CENTS - exampleSpendCents)));
    text('budgetMeta', `Spent · Actions ${formatMoney(exampleSpendCents)} · Text ${formatMoney(0)} · Capacity ${formatMoney(0)}`);
    text('contextUsed', '27');
    text('contextMeta', 'Assigned task 27 | Notes 0 | Draft 0');
    text('contextMax', '500');
    for (const [id, width] of [['contextFill', '5.4%'], ['budgetFill', `${exampleSpendCents / DEFAULT_BUDGET_CENTS * 100}%`]]) {
      const fill = document.getElementById(id!)!;
      const oldWidth = fill.style.width;
      restore.push(() => { fill.style.width = oldWidth; });
      fill.style.width = width!;
    }
    for (const id of ['rankCandidatesList', 'rankedPagesList']) content(id, tutorialSources.map((source, position) => `<div class="tour-source"><span class="practice-number">${position + 1}</span><div><strong>${escapeHtml(source.title)}</strong><p class="hint">${escapeHtml(source.host)}</p></div></div>`).join(''), true);
    content('notesList', `<article class="note-card"><div class="note-title">${escapeHtml(tutorialSources[0]!.title)}</div><p>${escapeHtml(tutorialSources[0]!.evidence)}</p></article>`, true);
    text('notesProgress', '1 of 2 ranked sources has a committed note');
    text('exportSummary', 'Session complete · Deliverable available');
    const draft = document.getElementById('draftInput') as HTMLTextAreaElement;
    const value = draft.value;
    const rows = draft.rows;
    restore.push(() => { draft.value = value; draft.rows = rows; });
    draft.value = 'Preserve an uncompressed master, keep copies in separate locations, and document each recording’s history.';
    draft.rows = 5;
  }

  function render(): void {
    const step = steps[index]!;
    highlighted?.classList.remove('tour-highlight');
    highlighted = document.getElementById(step.section)!;
    highlighted.classList.add('tour-highlight');
    title.textContent = step.title;
    document.getElementById('tutorialBody')!.textContent = step.body;
    document.getElementById('tutorialStepMeta')!.textContent = `${index + 1} of ${steps.length}`;
    back.disabled = index === 0;
    next.textContent = index === steps.length - 1 ? 'Done' : 'Next';
    document.body.style.setProperty('--tour-guide-height', `${dialog.offsetHeight + 32}px`);
    highlighted.scrollIntoView({ behavior: 'instant', block: 'start' });
    title.focus({ preventScroll: true });
  }
}
