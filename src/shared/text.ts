export function pretty(value = ''): string {
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}

export function escapeHtml(text = ''): string {
  return String(text).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character] || character);
}

export function normalizeText(text = ''): string {
  return String(text)
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function countWords(text = ''): number {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}
