# Human Mode

Human Mode is a Chrome extension and research prototype for constrained, human-in-the-loop web research. Instead of hiding research behind automation, it keeps the browser user in direct control while instrumenting the same phases an agent would normally perform: task assignment, retrieval, inspection, source ordering, note capture, context management, and final drafting.

## Motivation

The extension is motivated by three educational questions:

- How can a browser workflow help users understand the sequence of steps a research agent performs behind the scenes?
- What do retrieval, source triage, note retention, and synthesis feel like when a person has to carry them out directly?
- Can users learn agent constraints such as context windows, budgets, and ordered evidence collection by moving through them manually?

## System Design

The extension is organized as four runtime surfaces:

- `src/background/`: service-worker authority for session state, Chrome events, navigation constraints, storage, budget accounting, and runtime message routing.
- `src/shared/`: typed session model, message contracts, URL rules, task bank, context calculations, and migration/hydration helpers.
- `src/sidepanel/`: side-panel controls for session lifecycle, candidate management, note entry, draft export, trace review, and onboarding.
- `src/content/`: page overlay for active-mode status, source ranking, note-capture reading mode, restricted-page warnings, and retained-note display.

The built extension is generated into `dist/`.

## Experimental Protocol

1. Start a session from the side panel.
2. Accept the randomly assigned task.
3. Inspect search results and candidate pages.
4. Add candidate sources from the side panel.
5. Finalize the candidate set.
6. Rank sources in the page overlay.
7. Begin note capture.
8. Commit at least one note for each ranked source.
9. Enter deliverable mode and draft the output.
10. Complete the session and export the deliverable or runtime JSON.

## Data And Privacy Model

Human Mode stores session state in `chrome.storage.local` under `humanModeSession`. It reads active-tab URL/title metadata, committed notes, draft text, task metadata, budget counters, and runtime trace events to support the user-facing workflow. The extension does not include analytics, does not call a developer-operated server, and does not transmit user data off-device.

## Reproducibility

```bash
npm install
npm run build
```

`npm run build` runs the full typecheck, test, and build sequence.

Load the built extension:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select the `dist/` directory.
5. Click the Human Mode extension icon to open the side panel.
