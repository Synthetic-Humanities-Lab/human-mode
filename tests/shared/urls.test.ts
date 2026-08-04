import { describe, expect, it } from 'vitest';
import {
  buildGoogleSearchUrl,
  getSearchQueryFromUrl,
  isCandidatePage,
  isPdfUrl,
  isRestrictedUrl,
  isSearchResultsUrl,
  normalizeTrackedUrl
} from '../../src/shared';

describe('URL rules', () => {
  it('normalizes tracked public URLs without fragments or trailing slashes', () => {
    expect(normalizeTrackedUrl('https://example.com/research/#notes')).toBe('https://example.com/research');
    expect(normalizeTrackedUrl('chrome://extensions')).toBe('');
  });

  it('detects search result and restricted surfaces', () => {
    expect(isSearchResultsUrl('https://www.google.com/search?q=field+research')).toBe(true);
    expect(getSearchQueryFromUrl('https://www.google.com/search?q=field+research')).toBe('field research');
    expect(isRestrictedUrl('https://docs.google.com/document/d/example')).toBe(true);
  });

  it('accepts ordinary public pages as candidate sources', () => {
    expect(isCandidatePage('https://example.com/article')).toBe(true);
    expect(isCandidatePage('https://www.google.com/search?q=test')).toBe(false);
  });

  it('detects direct PDF URLs without treating PDF-like query values as files', () => {
    expect(isPdfUrl('https://example.com/report.pdf')).toBe(true);
    expect(isPdfUrl('https://example.com/report.PDF?download=1#page=4')).toBe(true);
    expect(isPdfUrl('https://example.com/report%2Epdf')).toBe(true);
    expect(isPdfUrl('https://example.com/report.pdf/')).toBe(true);
    expect(isPdfUrl('https://example.com/article?download=report.pdf')).toBe(false);
    expect(isPdfUrl('not a url')).toBe(false);
  });

  it('builds Google search URLs for assigned tasks', () => {
    expect(buildGoogleSearchUrl('compare sources')).toBe('https://www.google.com/search?q=compare%20sources');
  });
});
