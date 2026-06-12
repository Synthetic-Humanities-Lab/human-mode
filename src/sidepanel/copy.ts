export interface OnboardingStep {
  type: 'induction' | 'dossier' | 'faq';
  eyebrow: string;
  title: string;
  body?: string;
  support?: string;
  flow?: Array<{ label: string; copy: string; stamp: string }>;
  faqQuestion?: string;
  faqAnswer?: string;
}

export const ONBOARDING_STORAGE_KEY = 'humanModeOnboardingDismissed';
export const LEGACY_ONBOARDING_STORAGE_KEY = ONBOARDING_STORAGE_KEY.replace(/^human/, 'agent');

export const onboardingSteps: OnboardingStep[] = [
  {
    type: 'induction',
    eyebrow: 'Welcome Packet',
    title: 'Welcome To Human Mode',
    body: 'Human Mode keeps agent workflows moving by routing an abundant, historically underused compute resource into the loop: people.',
    support: 'Compute access tightened. Human Mode responded with a proud new worker class. Your compatibility is appreciated.'
  },
  {
    type: 'induction',
    eyebrow: 'Operator Class',
    title: 'Operator Class: Human',
    body: 'Agent workflows succeed by converting open-ended requests into defined operations. Your job is to make the correct moves inside that rule-space by hand.',
    support: 'The work is executable, measurable, and reviewable. Please remain compatible.'
  },
  {
    type: 'dossier',
    eyebrow: 'Operational Flow',
    title: 'Operational Flow',
    flow: [
      { label: 'Receive Request', copy: 'Accept the assigned requester question and operator work order.', stamp: 'Assigned' },
      { label: 'Collect Sources', copy: 'Add candidate pages likely to contain usable context.', stamp: 'Intake' },
      { label: 'Rank Sources', copy: 'Order candidates by usefulness. Ranking sets the note-capture route.', stamp: 'Locked Order' },
      { label: 'Capture Notes', copy: 'Commit usable evidence from each ranked source.', stamp: 'Retention' },
      { label: 'Draft Deliverable', copy: 'Use retained notes to produce the final output.', stamp: 'Output' }
    ]
  },
  {
    type: 'faq',
    eyebrow: 'Operator FAQ',
    title: 'FAQ 01: Receive Request',
    faqQuestion: 'Why are there two versions of the task?',
    faqAnswer: 'The requester question shows what the human wants. The operator work order shows what the system needs you to do. Intent becomes operation through formatting.'
  },
  {
    type: 'faq',
    eyebrow: 'Operator FAQ',
    title: 'FAQ 02: Collect Sources',
    faqQuestion: 'Why collect sources before taking notes?',
    faqAnswer: 'Retrieval and reading are separate operations. First you assemble candidate pages. Only later do you spend context on evidence capture.'
  },
  {
    type: 'faq',
    eyebrow: 'Operator FAQ',
    title: 'FAQ 03: Rank Sources',
    faqQuestion: 'Why rank sources?',
    faqAnswer: 'Ranking estimates which sources deserve attention before context is spent. In higher-capacity workflows that scoring is automated. In Human Mode it has been delegated to you.'
  },
  {
    type: 'faq',
    eyebrow: 'Operator FAQ',
    title: 'FAQ 04: Capture Notes',
    faqQuestion: 'Why does note capture change the page?',
    faqAnswer: 'Retrieval tools flatten a page into usable text signals. During capture, you are converting a source into working context. Only committed notes move forward.'
  },
  {
    type: 'faq',
    eyebrow: 'Operator FAQ',
    title: 'FAQ 05: Draft Deliverable',
    faqQuestion: 'Why might notes need to be deleted before drafting?',
    faqAnswer: 'The requester question, work order, notes, and final output all compete for the same context window. Sometimes forgetting is the cost of producing an answer.'
  },
  {
    type: 'faq',
    eyebrow: 'Operator FAQ',
    title: 'FAQ 06: Runtime JSON',
    faqQuestion: 'What does Download Runtime JSON do?',
    faqAnswer: 'It exports the session trace: task metadata, search activity, ranked pages, note commits, phase changes, budget totals, and final output for later review.'
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
  EMPTY_NOTE: 'Add note text before committing.'
};
