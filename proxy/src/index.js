const ALLOWED_PAGE_HOSTS = new Set(['animeua.club', 'www.animeua.club']);
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';

function isAllowedAnimeUaHost(hostname = '') {
  return hostname === 'animeua.club' || hostname === 'www.animeua.club' || hostname.endsWith('.animeua.club');
}

function decodeEntities(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#039;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function absoluteUrl(value, base) {
  try { return new URL(decodeEntities(value || ''), base).toString(); }
  catch { return ''; }
}

function attr(tag = '', name) {
  const m = String(tag).match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return m ? m[2] : '';
}

function textHeaders(extra = {}) {
  return {
    'content-type': 'text/plain; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    ...extra,
  };
}

function findPoster(html, pageUrl) {
  let m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (!m) m = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (m) {
    const u = absoluteUrl(m[1], pageUrl);
    if (u && !/no-img|placeholder/i.test(u)) return u;
  }
  const tags = html.match(/<img\b[^>]*>/gi) || [];
  for (const tag of tags) {
    for (const name of ['data-src', 'data-lazy-src', 'data-original', 'data-url', 'data-srcset', 'srcset', 'src']) {
      let raw = attr(tag, name);
      if (!raw) continue;
      if (name.includes('srcset')) raw = raw.split(',').pop().trim().split(/\s+/)[0];
      const u = absoluteUrl(raw, pageUrl);
      if (u && !/no-img|placeholder|avatar|logo|icon/i.test(u)) return u;
    }
  }
  return '';
}

function findPlayerIframe(html, pageUrl) {
  const tags = String(html || '').match(/<iframe\b[^>]*>/gi) || [];
  const names = ['data-src', 'src', 'data-url', 'data-player', 'data-frame', 'data-video'];
  for (const tag of tags) {
    for (const name of names) {
      const raw = attr(tag, name);
      if (!raw || /^(?:about:|javascript:)/i.test(raw)) continue;
      const u = absoluteUrl(raw, pageUrl);
      if (u) return u;
    }
  }
  const patterns = [
    /(?:iframe|player|video|embed|src|url)\s*[:=]\s*["']([^"']+)["']/i,
    /["']((?:https?:)?\/\/[^"']*(?:player|embed|video)[^"']*)["']/i,
  ];
  for (const re of patterns) {
    const m = String(html || '').match(re);
    if (!m) continue;
    const u = absoluteUrl(m[1], pageUrl);
    if (u) return u;
  }
  return '';
}

async function fetchAnimePage(target) {
  return fetch(target.toString(), {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Referer': 'https://animeua.club/',
    },
    redirect: 'follow',
  });
}

async function fetchImage(target) {
  const upstream = await fetch(target.toString(), {
    headers: {
      'User-Agent': UA,
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Referer': 'https://animeua.club/',
    },
    redirect: 'follow',
    cf: { cacheEverything: true, cacheTtl: 86400 },
  });
  if (!upstream.ok) return new Response(`Upstream ${upstream.status}`, { status: upstream.status });
  const contentType = upstream.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) return new Response('Upstream is not an image', { status: 502 });
  const headers = new Headers(upstream.headers);
  headers.set('cache-control', 'public, max-age=86400, s-maxage=86400');
  headers.set('access-control-allow-origin', '*');
  headers.delete('set-cookie');
  return new Response(upstream.body, { status: upstream.status, headers });
}


function isPrivateHost(host = '') {
  const h = String(host).toLowerCase();
  if (h === 'localhost' || h === '::1' || h.endsWith('.local')) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return h === '0.0.0.0' || h === '169.254.169.254';
}

function hlsProxyUrl(originUrl, workerBase) {
  return `${workerBase}/hls?url=${encodeURIComponent(originUrl)}`;
}

function rewriteHls(body, originUrl, workerBase) {
  const lines = String(body || '').split(/\r?\n/);
  return lines.map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (!t.startsWith('#')) {
      const abs = absoluteUrl(t, originUrl);
      if (!abs) return line;
      return /\.m3u8(?:[?#]|$)/i.test(abs) ? hlsProxyUrl(abs, workerBase) : abs;
    }
    return line.replace(/URI=(['"])(.*?)\1/gi, (all, q, raw) => {
      const abs = absoluteUrl(raw, originUrl);
      if (!abs) return all;
      const out = /\.m3u8(?:[?#]|$)/i.test(abs) ? hlsProxyUrl(abs, workerBase) : abs;
      return `URI=${q}${out}${q}`;
    });
  }).join('\n');
}

async function relayHls(rawUrl, workerBase) {
  let target;
  try { target = new URL(rawUrl); } catch { return new Response('Invalid HLS url', { status: 400, headers: textHeaders() }); }
  if (!/^https?:$/.test(target.protocol) || isPrivateHost(target.hostname) || !/\.m3u8(?:$|[?#])/i.test(target.toString())) {
    return new Response('Forbidden HLS url', { status: 403, headers: textHeaders() });
  }

  const cache = caches.default;
  const cacheKey = new Request(`${workerBase}/hls-cache?url=${encodeURIComponent(target.toString())}`);
  const hit = await cache.match(cacheKey);
  if (hit) {
    const headers = new Headers(hit.headers);
    headers.set('x-animeua-hls-cache', 'HIT');
    return new Response(hit.body, { status: hit.status, headers });
  }

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*',
        'Referer': 'https://animeua.club/',
      },
      redirect: 'follow',
      cf: { cacheEverything: true, cacheTtl: 5 },
    });
  } catch {
    return Response.redirect(target.toString(), 302);
  }
  if (!upstream.ok) return Response.redirect(target.toString(), 302);

  const body = await upstream.text();
  if (!/^\s*#EXTM3U/i.test(body)) return Response.redirect(target.toString(), 302);
  const rewritten = rewriteHls(body, target.toString(), workerBase);
  const headers = new Headers({
    'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'public, max-age=5, s-maxage=5',
    'x-animeua-hls-cache': 'MISS',
  });
  const response = new Response(rewritten, { status: 200, headers });
  try { await cache.put(cacheKey, response.clone()); } catch {}
  return response;
}

async function relayPlayer(pageUrl) {
  let page;
  try { page = new URL(pageUrl); } catch { return new Response('Invalid page url', { status: 400, headers: textHeaders() }); }
  if (page.protocol !== 'https:' || !ALLOWED_PAGE_HOSTS.has(page.hostname)) {
    return new Response('Forbidden page host', { status: 403, headers: textHeaders() });
  }

  let pageResp;
  try { pageResp = await fetchAnimePage(page); }
  catch (e) { return new Response(`Page fetch failed: ${e}`, { status: 502, headers: textHeaders() }); }
  if (!pageResp.ok) return new Response(`Page ${pageResp.status}`, { status: 502, headers: textHeaders({ 'x-animeua-page-status': String(pageResp.status) }) });

  const pageHtml = await pageResp.text();
  const iframe = findPlayerIframe(pageHtml, page.toString());
  if (!iframe) return new Response(pageHtml, { status: 200, headers: textHeaders({ 'x-animeua-player-source': 'page', 'x-animeua-player-length': String(pageHtml.length) }) });

  let iframeUrl;
  try { iframeUrl = new URL(iframe); } catch { return new Response('Invalid iframe url', { status: 502, headers: textHeaders() }); }
  if (iframeUrl.protocol !== 'https:' && iframeUrl.protocol !== 'http:') {
    return new Response('Unsupported iframe protocol', { status: 403, headers: textHeaders() });
  }

  let player;
  try {
    player = await fetch(iframeUrl.toString(), {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': page.toString(),
        'Origin': 'https://animeua.club',
      },
      redirect: 'follow',
    });
  } catch (e) {
    return new Response(`Player fetch failed: ${e}`, { status: 502, headers: textHeaders({ 'x-animeua-iframe-host': iframeUrl.hostname }) });
  }

  let body = await player.text();
  let finalStatus = player.status;
  let finalHost = iframeUrl.hostname;
  if (!/\bfile\s*:/i.test(body)) {
    const nested = findPlayerIframe(body, iframeUrl.toString());
    if (nested && nested !== iframeUrl.toString()) {
      try {
        const nestedUrl = new URL(nested);
        if (/^https?:$/.test(nestedUrl.protocol)) {
          const nestedResp = await fetch(nestedUrl.toString(), {
            headers: {
              'User-Agent': UA,
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Referer': iframeUrl.toString(),
              'Origin': iframeUrl.origin,
            },
            redirect: 'follow',
          });
          const nestedBody = await nestedResp.text();
          if (nestedBody) {
            body = nestedBody;
            finalStatus = nestedResp.status;
            finalHost = nestedUrl.hostname;
          }
        }
      } catch {}
    }
  }
  return new Response(body, {
    status: finalStatus >= 200 && finalStatus < 400 ? 200 : 502,
    headers: textHeaders({
      'x-animeua-player-status': String(finalStatus),
      'x-animeua-iframe-host': finalHost,
      'x-animeua-player-length': String(body.length),
    }),
  });
}

export default {
  async fetch(request) {
    const reqUrl = new URL(request.url);

    if (reqUrl.pathname === '/health') {
      return new Response('ok', { headers: textHeaders() });
    }

    if (reqUrl.pathname === '/hls') {
      const raw = reqUrl.searchParams.get('url');
      if (!raw) return new Response('Missing url', { status: 400, headers: textHeaders() });
      return relayHls(raw, reqUrl.origin);
    }

    if (reqUrl.pathname === '/player') {
      const page = reqUrl.searchParams.get('page');
      if (!page) return new Response('Missing page', { status: 400, headers: textHeaders() });
      return relayPlayer(page);
    }

    const raw = reqUrl.searchParams.get('url');
    if (!raw) return new Response('Missing url', { status: 400 });

    let target;
    try { target = new URL(raw); } catch { return new Response('Invalid url', { status: 400 }); }

    if (reqUrl.pathname === '/image') {
      if (target.protocol !== 'https:' || !isAllowedAnimeUaHost(target.hostname)) return new Response('Forbidden host', { status: 403 });
      return fetchImage(target);
    }

    if (reqUrl.pathname === '/poster') {
      if (target.protocol !== 'https:' || !ALLOWED_PAGE_HOSTS.has(target.hostname)) return new Response('Forbidden page host', { status: 403 });
      const page = await fetchAnimePage(target);
      if (!page.ok) return new Response(`Page ${page.status}`, { status: page.status });
      const html = await page.text();
      const poster = findPoster(html, target.toString());
      if (!poster) return new Response('Poster not found', { status: 404 });
      let imageUrl;
      try { imageUrl = new URL(poster); } catch { return new Response('Invalid poster url', { status: 502 }); }
      if (imageUrl.protocol !== 'https:' || !isAllowedAnimeUaHost(imageUrl.hostname)) return new Response('Forbidden poster host', { status: 403 });
      return fetchImage(imageUrl);
    }

    return new Response('AnimeUA proxy', { headers: textHeaders() });
  },
};
