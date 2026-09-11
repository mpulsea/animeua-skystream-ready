const ALLOWED_PAGE_HOSTS = new Set(['animeua.club', 'www.animeua.club']);

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
  try {
    return new URL(decodeEntities(value || ''), base).toString();
  } catch {
    return '';
  }
}

function attr(tag = '', name) {
  const m = String(tag).match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return m ? m[2] : '';
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

async function fetchImage(target) {
  const upstream = await fetch(target.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
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

export default {
  async fetch(request) {
    const reqUrl = new URL(request.url);

    if (reqUrl.pathname === '/health') {
      return new Response('ok', { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
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

      const page = await fetch(target.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Referer': 'https://animeua.club/',
        },
        redirect: 'follow',
        cf: { cacheEverything: true, cacheTtl: 3600 },
      });
      if (!page.ok) return new Response(`Page ${page.status}`, { status: page.status });
      const html = await page.text();
      const poster = findPoster(html, target.toString());
      if (!poster) return new Response('Poster not found', { status: 404 });

      let imageUrl;
      try { imageUrl = new URL(poster); } catch { return new Response('Invalid poster url', { status: 502 }); }
      if (imageUrl.protocol !== 'https:' || !isAllowedAnimeUaHost(imageUrl.hostname)) return new Response('Forbidden poster host', { status: 403 });
      return fetchImage(imageUrl);
    }

    return new Response('AnimeUA image proxy', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};
