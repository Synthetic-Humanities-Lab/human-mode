# Human Mode

A Chrome extension for learning how research agents work by collecting sources, ranking evidence, taking notes, and writing a deliverable within a simulated budget and context window.

## Install

Requires Chrome 120 or later, Node.js, and npm.

```bash
npm ci
npm run build
```

The build runs type checking and tests, then writes the extension to `dist/`.

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select `dist/`.
3. Click the Human Mode extension icon to open the side panel.

## Usage

1. Start a session and review the assigned question and work order.
2. Collect sources, press **Done Adding Sources**, and rank them on the page.
3. Commit a note for each ranked source, then write and commit your deliverable.
4. End the session and export the deliverable or session record.

Use **Tutorial** for a guided walkthrough.

Each session starts with $10 in simulated money. Charged actions and newly committed context units cost $0.01 each. Adding 100 context units costs $1.00. One word counts as one context unit.

## Custom requests

Open **Settings** to add requester questions and operator work orders, or import JSON using **Download Template** as a starting point. Saved settings apply to the next session.

The built-in requests are in [src/shared/task-bank.json](src/shared/task-bank.json).

## Privacy

Session data and settings are stored locally. The extension has no analytics or developer-operated server. Starting a session sends the initial search query to Google through normal browser navigation.

## License

[MIT](LICENSE)
