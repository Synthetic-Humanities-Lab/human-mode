import { PDF_TOOL_UNAVAILABLE_MESSAGE } from '../shared';

export interface OnboardingStep {
  type: 'induction' | 'dossier' | 'faq';
  eyebrow: string;
  title: string;
  body?: string;
  bodyHtml?: string;
  support?: string;
  flow?: Array<{ label: string; copy: string }>;
  faqQuestion?: string;
  faqAnswer?: string;
}

export const ONBOARDING_STORAGE_KEY = 'humanModeOnboardingDismissed';
export const LEGACY_ONBOARDING_STORAGE_KEY = ONBOARDING_STORAGE_KEY.replace(/^human/, 'agent');

export const onboardingSteps: OnboardingStep[] = [
  {
    type: 'induction',
    eyebrow: 'Welcome',
    title: 'WELCOME TO HUMAN MODE',
    bodyHtml: 'As rising prices make other AI providers prohibitively expensive, Human Mode promises to keep costs down by leveraging an abundant, historically underused compute resource: <span class="onboarding-body-emphasis">people</span>.'
  },
  {
    type: 'induction',
    eyebrow: 'Your Role',
    title: 'OPERATOR CLASS: HUMAN',
    bodyHtml: 'Agent workflows succeed by converting open-ended requests into defined operations. Each operation limits what can happen next, which makes the work executable, measurable, and reviewable.<br><br>Your job is to make the appropriate moves within this clearly defined rule-space. Just like a video game! Please remain compatible.'
  },
  {
    type: 'dossier',
    eyebrow: 'Operational Flow',
    title: 'Operational Flow',
    flow: [
      { label: 'RECEIVE REQUEST', copy: 'Accept the assigned requester question and operator work order.' },
      { label: 'COLLECT SOURCES', copy: 'Add candidate pages likely to contain usable context.' },
      { label: 'RANK SOURCES', copy: 'Order candidates by usefulness. Ranking sets the note-capture route.' },
      { label: 'CAPTURE NOTES', copy: 'Commit usable evidence from each ranked source.' },
      { label: 'DRAFT DELIVERABLE', copy: 'Use retained notes to produce the final output.' }
    ]
  },
  {
    type: 'faq',
    eyebrow: 'OPERATOR FAQ',
    title: 'FAQ 01: Receive Request',
    faqQuestion: 'WHY ARE THERE TWO VERSIONS OF THE TASK?',
    faqAnswer: 'When an agent receives a human request, it does not search the raw wording directly. A planning step converts the request into a narrower objective, search seed, or work order. The requester question tells you what the human wants. The operator work order tells you what the system needs you to do. Intent becomes operation via formatting.'
  },
  {
    type: 'faq',
    eyebrow: 'OPERATOR FAQ',
    title: 'FAQ 02: Collect Sources',
    faqQuestion: 'WHY COLLECT SOURCES BEFORE TAKING NOTES?',
    faqAnswer: 'Retrieval and reading are separate operations. An agent first calls search or browser tools to produce candidate pages. Only after that does it spend context on opening, extracting, or reading them. Collect Sources is the candidate-building phase. At this stage, you are not preserving evidence yet. You are deciding what may become evidence later.'
  },
  {
    type: 'faq',
    eyebrow: 'OPERATOR FAQ',
    title: 'FAQ 03: Rank Sources',
    faqQuestion: 'WHY RANK SOURCES?',
    faqAnswer: 'Agents estimate which sources are worth reading before spending context on them. A source is ranked by relevance, specificity, credibility, freshness, and whether it adds coverage not already present in the candidate set. In higher-capacity workflows, this scoring is computed. In Human Mode, it has been delegated to you. Automated ranking is expensive. Your judgment is cheap.'
  },
  {
    type: 'faq',
    eyebrow: 'OPERATOR FAQ',
    title: 'FAQ 04: Capture Notes',
    faqQuestion: 'WHY DOES NOTE CAPTURE CHANGE THE PAGE?',
    faqAnswer: 'When an agent accesses a webpage, a retrieval tool converts the page into text the system can use. Titles, headings, body text, links, and other extractable signals become the working surface. That is why you see a stripped-down version of the page during note capture. The task is to create usable context from the source. Only committed notes move forward.'
  },
  {
    type: 'faq',
    eyebrow: 'OPERATOR FAQ',
    title: 'FAQ 05: Draft Deliverable',
    faqQuestion: 'WHY DO I SOMETIMES HAVE TO DELETE NOTES TO WRITE THE DELIVERABLE?',
    faqAnswer: 'Generation happens inside a limited context window. The requester question, operator work order, retained notes, and final deliverable all share that same space. If memory takes too much room, there won’t be enough space for the output: Earlier notes must be compressed or removed before the deliverable can be generated. Sometimes, forgetting is the cost of creating.'
  },
  {
    type: 'faq',
    eyebrow: 'OPERATOR FAQ',
    title: 'FAQ 06: Runtime JSON',
    faqQuestion: 'WHAT DOES DOWNLOAD RUNTIME JSON DO?',
    faqAnswer: 'The deliverable is the output of the session. The runtime JSON is the trace of the session. It records the session task, search activity, opened pages, ranked candidate events, note commits, draft commits, phase changes, budget totals, operation counts, and final output. This file allows what you did in the session to be reviewed after completion, which supports oversight, cost analysis, and process review. Act accordingly.'
  }
];

export const responseMessages: Record<string, string> = {
  OUT_OF_BUDGET: 'Session allocation exhausted. End the session or spend less.',
  CONTEXT_FULL: 'Context window full. Use Expand Context, or revise or delete note blocks before committing more text.',
  NO_ACTIVE_TAB: 'Open a browser tab before starting a session.',
  TASK_BANK_EMPTY: 'The built-in task bank is empty.',
  NO_RANK_CANDIDATES: 'Add at least one candidate source before beginning note taking.',
  CANDIDATE_SET_NOT_FINALIZED: 'Press Done Adding Sources in the sidebar before ranking and note taking.',
  INVALID_CANDIDATE_PAGE: 'Only normal public webpages can be added to the ranked candidate set.',
  DUPLICATE_RANK_CANDIDATE: 'That page is already in the ranked candidate set.',
  CANDIDATES_LOCKED: 'End note capture before changing the ranked candidate set.',
  NOT_IN_NOTE_CAPTURE: 'Begin note taking before moving to the next ranked page.',
  NO_NEXT_NOTE_CAPTURE_SOURCE: 'You are already on the last ranked page.',
  MISSING_NOTE_FOR_RANKED_SOURCE: 'Commit at least one note for this ranked page before continuing.',
  MISSING_NOTES_FOR_ALL_RANKED_SOURCES: 'Commit at least one note for every ranked source before entering deliverable.',
  EMPTY_NOTE: 'Add note text before committing.',
  PDF_TOOL_UNAVAILABLE: PDF_TOOL_UNAVAILABLE_MESSAGE
};
