import {
  AgentSession,
  BroadcastMessage,
  escapeHtml,
  Phase,
  pretty,
  RuntimeMessage,
  RuntimeResponse,
  SessionState,
  isRestrictedUrl,
  normalizeTrackedUrl,
  rankCandidatesInNoteCaptureOrder
} from '../shared';
import { shouldBlockPdfNavigation } from './navigation';
import { buildReadingPayload, ReadingPayload } from './reading';

let currentSession: AgentSession | null = null;
let root: HTMLElement | null = null;
let readingScrollTop = 0;
let dragCandidateId: string | null = null;

void init();

async function init(): Promise<void> {
  ensureRoot();
  document.addEventListener('click', blockPdfNavigation, true);
  document.addEventListener('auxclick', blockPdfNavigation, true);
  void notifyCurrentPage();
  window.addEventListener('pageshow', () => void notifyCurrentPage());
  window.addEventListener('focus', () => void notifyCurrentPage());
  chrome.runtime.onMessage.addListener((message: BroadcastMessage) => {
    if (message?.type === 'SESSION_UPDATED') {
      currentSession = message.session;
      render();
    }
  });
  const response = await chrome.runtime.sendMessage({ type: 'GET_SESSION' } satisfies RuntimeMessage).catch(() => null) as RuntimeResponse | null;
  currentSession = response?.session || null;
  render();
}

function blockPdfNavigation(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest<HTMLAnchorElement>('a[href]');
  if (!link || !shouldBlockPdfNavigation(currentSession, link.href)) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  void chrome.runtime.sendMessage({
    type: 'BLOCK_PDF_NAVIGATION',
    payload: {
      url: link.href,
      title: link.textContent?.trim() || link.title || ''
    }
  } satisfies RuntimeMessage).catch(() => undefined);
}

function ensureRoot(): void {
  let host = document.getElementById('human-mode-overlay-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'human-mode-overlay-host';
    document.documentElement.appendChild(host);
  }

  const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
  let mount = shadow.getElementById('human-mode-overlay-root');
  if (!mount) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = chrome.runtime.getURL('content/content-script.css');
    shadow.appendChild(stylesheet);

    mount = document.createElement('div');
    mount.id = 'human-mode-overlay-root';
    shadow.appendChild(mount);
  }

  root = mount;
}

async function notifyCurrentPage(): Promise<void> {
  await chrome.runtime.sendMessage({
    type: 'CONTENT_STATUS',
    payload: { url: location.href, title: document.title }
  } satisfies RuntimeMessage).catch(() => undefined);
}

function render(): void {
  if (!root) return;
  const existingReader = root.querySelector<HTMLElement>('.human-mode-reader');
  if (existingReader) readingScrollTop = existingReader.scrollTop;
  root.innerHTML = '';
  if (!currentSession || currentSession.sessionState === SessionState.OFF) {
    delete root.dataset.sessionState;
    delete root.dataset.phase;
    return;
  }
  root.dataset.sessionState = currentSession.sessionState || '';
  root.dataset.phase = currentSession.phase || '';
  const onLockedPage = normalizeTrackedUrl(currentSession.noteCaptureLockedUrl) === normalizeTrackedUrl(location.href);

  if (currentSession.sessionState === SessionState.ACTIVE) {
    const banner = document.createElement('div');
    banner.className = 'human-mode-banner';
    banner.innerHTML = `<div class="title">Human Mode Active</div><div class="body">${pretty(currentSession.phase)} | ${escapeHtml(document.title || location.hostname)}</div>`;
    root.appendChild(banner);
  }

  if (shouldShowRankBoard()) {
    root.appendChild(createRankBoard());
  }

  if (currentSession.phase === Phase.DELIVERABLE && currentSession.sessionState === SessionState.ACTIVE) {
    root.appendChild(createDeliverableNotesBoard());
  }

  if (currentSession.phase === Phase.NOTE_CAPTURE && currentSession.sessionState === SessionState.ACTIVE) {
    root.appendChild(onLockedPage ? createReadingPanel(buildReadingPayload(root)) : noteLockCard());
  }

  if (isRestrictedUrl(location.href) && currentSession.sessionState === SessionState.ACTIVE) {
    const modal = document.createElement('div');
    modal.className = 'human-mode-modal';
    modal.innerHTML = `
      <div class="human-mode-modal-card">
        <h3>Private page detected</h3>
        <p>This page requires access outside the current plan.</p>
        <div class="actions">
          <button class="primary">Turn Human Mode Off</button>
          <button class="secondary">Go Back</button>
        </div>
      </div>
    `;
    modal.querySelector<HTMLButtonElement>('.primary')?.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'PAUSE_SESSION' } satisfies RuntimeMessage).catch(() => undefined);
    });
    modal.querySelector<HTMLButtonElement>('.secondary')?.addEventListener('click', () => history.back());
    root.appendChild(modal);
  }
}

function createDeliverableNotesBoard(): HTMLElement {
  const shell = document.createElement('section');
  shell.className = 'human-mode-deliverable-shell';

  const board = document.createElement('div');
  board.className = 'human-mode-deliverable-board';
  const notes = currentSession?.notes || [];
  board.innerHTML = `
    <div class="human-mode-deliverable-header">
      <div class="human-mode-deliverable-header-top">
        <div class="title">Retained Notes</div>
      </div>
      <div class="body">Retained notes stay visible while the draft is composed in the side panel.</div>
    </div>
    <div class="human-mode-deliverable-list"></div>
  `;

  const list = board.querySelector<HTMLElement>('.human-mode-deliverable-list');
  if (!list) return shell;
  if (!notes.length) {
    const empty = document.createElement('div');
    empty.className = 'human-mode-deliverable-empty';
    empty.textContent = 'No committed notes yet.';
    list.appendChild(empty);
  } else {
    notes.forEach((note, index) => {
      const item = document.createElement('div');
      item.className = 'human-mode-deliverable-item';
      item.innerHTML = `
        <div class="human-mode-deliverable-index">${index + 1}</div>
        <div class="human-mode-deliverable-copy">
          <div class="human-mode-deliverable-source">${escapeHtml(note.sourceTitle || 'Source')}</div>
          <div class="human-mode-deliverable-text">${escapeHtml(note.committedText || '')}</div>
        </div>
      `;
      list.appendChild(item);
    });
  }

  shell.appendChild(board);
  return shell;
}

function noteLockCard(): HTMLElement {
  const card = document.createElement('div');
  card.className = 'human-mode-note-lock';
  card.innerHTML = '<div class="title">Note Capture Locked</div><div class="body">Stay on this page until note capture ends.</div>';
  return card;
}

function createRankBoard(): HTMLElement {
  const shell = document.createElement('section');
  shell.className = 'human-mode-rank-board-shell';

  const board = document.createElement('div');
  board.className = 'human-mode-rank-board';
  const orderedCandidates = currentSession ? rankCandidatesInNoteCaptureOrder(currentSession) : [];
  board.innerHTML = `
    <div class="human-mode-rank-board-header">
      <div class="human-mode-rank-board-header-top">
        <div class="title">Rank Candidate Sources</div>
      </div>
      <div class="body">Drag these sources into the order you want, then begin note taking.</div>
    </div>
    <div class="human-mode-rank-arc" aria-hidden="true"></div>
    <div class="human-mode-rank-list-wrap">
      <div class="human-mode-rank-list"></div>
    </div>
    <button type="button" class="human-mode-rank-begin-btn">Begin Note Taking</button>
  `;

  const list = board.querySelector<HTMLElement>('.human-mode-rank-list');
  if (!list) return shell;
  for (const [index, candidate] of orderedCandidates.entries()) {
    const item = document.createElement('div');
    item.className = 'human-mode-rank-item';
    item.draggable = true;
    item.innerHTML = `
      <div class="human-mode-rank-number">${index + 1}</div>
      <div class="human-mode-rank-handle" aria-hidden="true">
        <span></span><span></span>
        <span></span><span></span>
        <span></span><span></span>
      </div>
      <div class="human-mode-rank-copy">
        <div class="human-mode-rank-item-title">${escapeHtml(candidate.title || 'Untitled page')}</div>
        <div class="human-mode-rank-item-url">${escapeHtml(candidate.url)}</div>
      </div>
    `;

    item.addEventListener('dragstart', () => {
      dragCandidateId = candidate.id;
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', clearRankBoardDragState);
    item.addEventListener('dragover', event => event.preventDefault());
    item.addEventListener('dragenter', event => {
      event.preventDefault();
      item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', async event => {
      event.preventDefault();
      item.classList.remove('drag-over');
      if (!dragCandidateId || dragCandidateId === candidate.id) {
        clearRankBoardDragState();
        return;
      }
      const orderedIds = moveCandidate(dragCandidateId, candidate.id);
      clearRankBoardDragState();
      if (!orderedIds) return;
      applySessionResponse(await sendRuntimeMessage({
        type: 'REORDER_RANK_CANDIDATES',
        payload: { orderedIds }
      }));
    });

    list.appendChild(item);
  }

  board.querySelector<HTMLButtonElement>('.human-mode-rank-begin-btn')?.addEventListener('click', async () => {
    applySessionResponse(await sendRuntimeMessage({ type: 'BEGIN_NOTE_CAPTURE' }));
  });

  shell.appendChild(board);
  return shell;
}

function shouldShowRankBoard(): boolean {
  if (!currentSession || currentSession.sessionState !== SessionState.ACTIVE) return false;
  if (!currentSession.candidateSetFinalized) return false;
  if (currentSession.phase !== Phase.RETRIEVAL && currentSession.phase !== Phase.INSPECTION) return false;
  return (currentSession.rankCandidates || []).length > 0;
}

function moveCandidate(sourceId: string, targetId: string): string[] | null {
  const candidates = currentSession?.rankCandidates || [];
  let orderedIds = [...(currentSession?.noteCaptureRankOrder || [])];
  if (currentSession && orderedIds.length !== candidates.length) {
    orderedIds = rankCandidatesInNoteCaptureOrder(currentSession).map(candidate => candidate.id);
  }
  const sourceIndex = orderedIds.indexOf(sourceId);
  const targetIndex = orderedIds.indexOf(targetId);
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return null;
  const [moved] = orderedIds.splice(sourceIndex, 1);
  if (!moved) return null;
  orderedIds.splice(targetIndex, 0, moved);
  return orderedIds;
}

function clearRankBoardDragState(): void {
  dragCandidateId = null;
  root?.querySelectorAll('.human-mode-rank-item').forEach(node => {
    node.classList.remove('dragging');
    node.classList.remove('drag-over');
  });
}

function applySessionResponse(response: RuntimeResponse | null): void {
  if (response?.session) {
    currentSession = response.session;
    render();
  }
}

async function sendRuntimeMessage(message: RuntimeMessage): Promise<RuntimeResponse | null> {
  return chrome.runtime.sendMessage(message).catch(() => null);
}

function createReadingPanel(reading: ReadingPayload): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'human-mode-reader';
  panel.addEventListener('scroll', () => {
    readingScrollTop = panel.scrollTop;
  });

  const header = document.createElement('div');
  header.className = 'human-mode-reader-header';
  header.innerHTML = `
    <div class="human-mode-reader-kicker">Reading Mode</div>
    <div class="human-mode-reader-meta">Note capture locked | ${escapeHtml(reading.source || location.hostname)}</div>
  `;

  const title = document.createElement('h2');
  title.className = 'human-mode-reader-title';
  title.textContent = reading.title || document.title || location.hostname;

  const content = document.createElement('div');
  content.className = 'human-mode-reader-content';

  if (!reading.blocks.length) {
    const empty = document.createElement('p');
    empty.className = 'human-mode-reader-empty';
    empty.textContent = 'Could not extract a clean reading view for this page.';
    content.appendChild(empty);
  } else {
    for (const block of reading.blocks) {
      const node = document.createElement(block.type === 'heading' ? 'h3' : block.type === 'quote' ? 'blockquote' : block.type === 'code' ? 'pre' : 'p');
      node.className = `human-mode-reader-block ${block.type}`;
      node.textContent = block.text;
      content.appendChild(node);
    }
  }

  panel.append(header, title, content);
  requestAnimationFrame(() => {
    panel.scrollTop = readingScrollTop;
  });
  return panel;
}
