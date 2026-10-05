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

Each session starts with $10 in simulated money:

- Searches and page opens during Collect or Rank cost $0.10 each. Each note or draft commit also costs $0.10.
- Committed text costs an additional $0.001 per context unit. One word counts as one unit. When revising a saved note or draft, only a positive increase in its word count incurs a text charge. Shortening or deleting text frees context without refunding earlier charges.
- Adding 100 units of context capacity costs a fixed $1.00, independently of text charges.
- Starting, pausing, resuming, and changing phases are free. The initial search is charged as a search action.

The **Spent** row separates accumulated action, text, and capacity costs. Accounting and exports retain fractional cents. The remaining budget is displayed rounded to the nearest cent, always with two decimal places; detailed charges use three when needed. For example, committing a new 101-word note costs $0.10 for the action plus $0.101 for text, totaling $0.201.

Existing sessions retain their actual spending and operation counts. Their legacy combined text/capacity amount is split using recorded expansion events at the historical $1 price; future charges use the new rates. Start a new session for a full run under the new prices.

## Custom requests

Open **Settings** to add requester questions and operator work orders, or import JSON using **Download Template** as a starting point. Saved settings apply to the next session.

The built-in requests are in [src/shared/task-bank.json](src/shared/task-bank.json).

## Privacy

Session data and settings are stored locally. The extension has no analytics or developer-operated server. Starting a session sends the initial search query to Google through normal browser navigation.

## License

[MIT](LICENSE)
