import { normalizeText } from '../shared';

export type ReadingBlockType = 'heading' | 'quote' | 'code' | 'text';

export interface ReadingBlock {
  type: ReadingBlockType;
  text: string;
}

export interface ReadingPayload {
  title: string;
  source: string;
  blocks: ReadingBlock[];
}

export function buildReadingPayload(overlayRoot: HTMLElement | null): ReadingPayload {
  const rootNode = pickReadableRoot(overlayRoot);
  const blocks = extractReadableBlocks(rootNode);
  const title = getReadingTitle(rootNode, blocks);
  return { title, source: location.hostname, blocks };
}

function getReadingTitle(rootNode: Element, blocks: ReadingBlock[]): string {
  const headingBlock = blocks.find(block => block.type === 'heading');
  const heading = headingBlock?.text || normalizeText(rootNode.querySelector('h1, h2')?.textContent || '');
  return heading || normalizeText(document.title) || location.hostname;
}

function pickReadableRoot(overlayRoot: HTMLElement | null): Element {
  const preferred = [...document.querySelectorAll('article, main, [role="main"], #content, #main, .content, .post-content, .article-content, .article-body, .entry-content, .markdown-body')];
  const pool = preferred.length
    ? preferred
    : [...document.body.querySelectorAll('article, main, section, div')].slice(0, 400);

  let best: Element = document.body;
  let bestScore = 0;

  for (const node of pool) {
    if (overlayRoot?.contains(node)) continue;
    const score = scoreReadableNode(node);
    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  }
  return best;
}

function scoreReadableNode(node: Element): number {
  const text = normalizeText(textFromElement(node));
  if (text.length < 300) return 0;

  const headingCount = node.querySelectorAll('h1, h2, h3').length;
  const paragraphCount = node.querySelectorAll('p').length;
  const listItemCount = node.querySelectorAll('li').length;
  const linkTextLength = [...node.querySelectorAll('a')].reduce((sum, link) => sum + normalizeText(link.textContent || '').length, 0);
  const density = text.length ? linkTextLength / text.length : 0;
  const meta = `${node.id || ''} ${typeof node.className === 'string' ? node.className : node.getAttribute('class') || ''}`;

  let score = text.length + (paragraphCount * 180) + (headingCount * 120) + (Math.min(listItemCount, 12) * 24);
  if (/comment|footer|header|hero|menu|modal|nav|promo|related|share|sidebar|social|subscribe/i.test(meta)) score *= 0.15;
  if (density > 0.45) score *= 0.35;
  return score;
}

function extractReadableBlocks(rootNode: Element): ReadingBlock[] {
  const clone = rootNode.cloneNode(true) as Element;
  stripNoise(clone);
  const blocks: ReadingBlock[] = [];
  const pushBlock = (type: ReadingBlockType, text: string | null | undefined): void => {
    const value = normalizeText(text || '');
    if (!value) return;
    if (blocks[blocks.length - 1]?.text === value) return;
    blocks.push({ type, text: value });
  };

  const nodes = [...clone.querySelectorAll('h1, h2, h3, p, li, blockquote, pre')];
  if (!nodes.length) {
    for (const paragraph of normalizeText(textFromElement(clone)).split(/\n{2,}/)) {
      pushBlock('text', paragraph);
    }
    return blocks;
  }

  for (const node of nodes) {
    if (node.closest('nav, aside, footer, form')) continue;
    if (isNoiseNode(node)) continue;
    if (/^H[1-3]$/.test(node.tagName)) pushBlock('heading', node.textContent);
    else if (node.tagName === 'BLOCKQUOTE') pushBlock('quote', node.textContent);
    else if (node.tagName === 'PRE') pushBlock('code', node.textContent);
    else if (node.tagName === 'LI') pushBlock('text', `- ${node.textContent}`);
    else pushBlock('text', node.textContent);
  }
  return blocks;
}

function stripNoise(rootNode: Element): void {
  rootNode.querySelectorAll('script, style, noscript, iframe, svg, canvas, form, button, input, select, textarea, dialog').forEach(node => node.remove());
  for (const node of [...rootNode.querySelectorAll('*')]) {
    if (isNoiseNode(node)) {
      node.remove();
      continue;
    }
    if (!node.children.length && !normalizeText(node.textContent || '') && node.tagName !== 'IMG') {
      node.remove();
    }
  }
}

function isNoiseNode(node: Element): boolean {
  const meta = `${node.id || ''} ${typeof node.className === 'string' ? node.className : node.getAttribute('class') || ''} ${node.getAttribute('role') || ''}`;
  return /comment|cookie|consent|footer|header|menu|modal|nav|promo|related|share|sidebar|social|subscribe|toolbar/i.test(meta);
}

function textFromElement(node: Element): string {
  return node instanceof HTMLElement ? node.innerText || '' : node.textContent || '';
}
