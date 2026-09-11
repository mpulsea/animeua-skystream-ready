const ALLOWED_HOSTS = new Set(['animeua.club', 'www.animeua.club']);

export default {
  async fetch(request) {
    const reqUrl = new URL(request.url);

    if (reqUrl.pathname === '/health') {
      return new Response('ok', {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }

    if (reqUrl.pathname !== '/image') {
      return new Response('AnimeUA image proxy', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    const raw = reqUrl.searchParams.get('url');
    if (!raw) return new Response('Missing url', { status: 400 });

    let target;
    try {
      target = new URL(raw);
    } catch {
      return new Response('Invalid url', { status: 400 });
    }

    if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
      return new Response('Forbidden host', { status: 403 });
    }

    const upstream = await fetch(target.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Referer': 'https://animeua.club/',
      },
      redirect: 'follow',
      cf: {
        cacheEverything: true,
        cacheTtl: 86400,
      },
    });

    if (!upstream.ok) {
      return new Response(`Upstream ${upstream.status}`, { status: upstream.status });
    }

    const contentType = upstream.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return new Response('Upstream is not an image', { status: 502 });
    }

    const headers = new Headers(upstream.headers);
    headers.set('cache-control', 'public, max-age=86400, s-maxage=86400');
    headers.set('access-control-allow-origin', '*');
    headers.delete('set-cookie');

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  },
};
