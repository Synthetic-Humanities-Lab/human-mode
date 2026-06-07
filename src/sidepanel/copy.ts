export interface OnboardingStep {
  type: 'induction' | 'dossier';
  eyebrow: string;
  title: string;
  body?: string;
  support?: string;
  flow?: Array<{ label: string; copy: string; stamp: string }>;
}

export const ONBOARDING_STORAGE_KEY = 'humanModeOnboardingDismissed';
export const LEGACY_ONBOARDING_STORAGE_KEY = ONBOARDING_STORAGE_KEY.replace(/^human/, 'agent');

export const onboardingSteps: OnboardingStep[] = [
  {
    type: 'induction',
    eyebrow: 'Orientation Material',
    title: 'Human Mode Induction',
    body: 'AI assistance is now a luxury reserved only to the few powerful enough to afford it. Because the expense remains prohibitive, you will complete the agent loop by hand. Accept the assigned task. Inspect the sources. Preserve useful notes. Produce the deliverable.',
    support: 'The system will track your budget, context, and compliance. You remain responsible for the thinking.'
  },
  {
    type: 'dossier',
    eyebrow: 'Intake Dossier',
    title: 'Operational Flow',
    flow: [
      { label: 'Receive Task', copy: 'Start the session and accept the randomly assigned research task.', stamp: 'Assigned' },
      { label: 'Collect Sources', copy: 'Add candidate pages with usable context.', stamp: 'Intake' },
      { label: 'Rank Sources', copy: 'Order the sources by usefulness. This becomes the route for note-taking.', stamp: 'Locked Order' },
      { label: 'Take Notes', copy: 'Commit at least one note from every ranked source.', stamp: 'Coverage' },
      { label: 'Draft Deliverable', copy: 'Use retained notes to produce the final output.', stamp: 'Output' }
    ]
  }
];

export const responseMessages: Record<string, string> = {
  OUT_OF_BUDGET: 'Budget exhausted. End the session or spend less. A familiar institution.',
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
