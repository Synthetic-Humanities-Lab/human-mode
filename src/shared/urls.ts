export function isRestrictedUrl(url = ''): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (!/^https?:$/.test(parsed.protocol)) return false;
    return ['docs.google.com', 'drive.google.com', 'mail.google.com'].includes(host);
  } catch {
    return false;
  }
}

export function isSearchEngineUrl(url = ''): boolean {
  try {
    const host = new URL(url).hostname;
    return /^(www\.)?google\.\w+(\.\w+)?$/.test(host)
      || /^(www\.)?bing\.com$/.test(host)
      || /^(www\.)?duckduckgo\.com$/.test(host)
      || /^search\.yahoo\.\w+(\.\w+)?$/.test(host)
      || /^(www\.)?yandex\.\w+$/.test(host)
      || /^(www\.)?baidu\.com$/.test(host)
      || /^(www\.)?ecosia\.org$/.test(host)
      || /^search\.brave\.com$/.test(host);
  } catch {
    return false;
  }
}

export function isSearchResultsUrl(url = ''): boolean {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    const host = parsed.hostname;
    if (/(^|\.)google\./.test(host) && parsed.pathname === '/search' && parsed.searchParams.has('q')) return true;
    if (/^(www\.)?bing\.com$/.test(host) && parsed.pathname === '/search' && parsed.searchParams.has('q')) return true;
    if (/^(www\.)?duckduckgo\.com$/.test(host) && parsed.searchParams.has('q')) return true;
    if (/^search\.yahoo\./.test(host) && parsed.pathname.startsWith('/search') && parsed.searchParams.has('p')) return true;
    if (/(^|\.)yandex\./.test(host) && parsed.pathname.startsWith('/search') && parsed.searchParams.has('text')) return true;
    if (host === 'www.baidu.com' && parsed.pathname === '/s' && parsed.searchParams.has('wd')) return true;
    if (host === 'www.ecosia.org' && parsed.pathname === '/search' && parsed.searchParams.has('q')) return true;
    if (host === 'search.brave.com' && parsed.pathname === '/search' && parsed.searchParams.has('q')) return true;
    return false;
  } catch {
    return false;
  }
}

export function getSearchQueryFromUrl(url = ''): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (/search\.yahoo\./.test(host)) return parsed.searchParams.get('p') || '';
    if (/(^|\.)yandex\./.test(host)) return parsed.searchParams.get('text') || '';
    if (host === 'www.baidu.com') return parsed.searchParams.get('wd') || '';
    return parsed.searchParams.get('q') || '';
  } catch {
    return '';
  }
}

export function isPublicWebUrl(url = ''): boolean {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol);
  } catch {
    return false;
  }
}

export function isPdfUrl(url = ''): boolean {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    let pathname = parsed.pathname;
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      // Preserve the encoded path when it contains malformed escape sequences.
    }
    return /\.pdf\/?$/i.test(pathname);
  } catch {
    return false;
  }
}

export function normalizeTrackedUrl(url = ''): string {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return '';
    parsed.hash = '';
    if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString();
  } catch {
    return '';
  }
}

export function getPageLabel(url = ''): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname + parsed.pathname;
  } catch {
    return url || 'unknown';
  }
}

export function isCandidatePage(url = ''): boolean {
  const normalized = normalizeTrackedUrl(url);
  return !!normalized && isPublicWebUrl(normalized) && !isRestrictedUrl(normalized) && !isSearchResultsUrl(normalized);
}
