from pathlib import Path
import json
import re

# Worker: add a tiny cached HLS manifest relay. Video segments stay direct.
wp = Path('proxy/src/index.js')
w = wp.read_text()
anchor = "async function relayPlayer(pageUrl) {"
if anchor not in w:
    raise SystemExit('relayPlayer anchor not found')

helper = r'''
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

'''
if 'async function relayHls(' not in w:
    w = w.replace(anchor, helper + anchor, 1)

route_anchor = "    if (reqUrl.pathname === '/player') {"
route = "    if (reqUrl.pathname === '/hls') {\n      const raw = reqUrl.searchParams.get('url');\n      if (!raw) return new Response('Missing url', { status: 400, headers: textHeaders() });\n      return relayHls(raw, reqUrl.origin);\n    }\n\n"
if route_anchor not in w:
    raise SystemExit('worker route anchor not found')
if "reqUrl.pathname === '/hls'" not in w:
    w = w.replace(route_anchor, route + route_anchor, 1)
wp.write_text(w)

# Plugin: replace the v27 direct retry warmup with one Worker warmup and return
# the Worker manifest URL to SkyStream. This avoids duplicate origin probes.
p = Path('animeua/plugin.js')
s = p.read_text()
pat = re.compile(r"async function warmOne\(u\)\{.*?\}\nasync function warmStreams\(o\)\{.*?\}\nasync function loadStreams\(url,cb\)\{.*?\}\n(?=globalThis\.getHome=)", re.S)
m = pat.search(s)
if not m:
    raise SystemExit('v27 stream block not found')
new = r"""function hlsRelay(u){return 'https://animeua-image-proxy.wholesale-source.workers.dev/hls?url='+encodeURIComponent(u)}
async function prepareStreams(o){try{var jobs=[];for(var i=0;i<o.length;i++){var x=o[i],u=x&&x.url?String(x.url):'';if(!u||!/\.m3u8(?:[?#]|$)/i.test(u))continue;var relay=hlsRelay(u);x.url=relay;jobs.push(getRaw(relay,{}))}if(jobs.length)await Promise.all(jobs)}catch(e){}}
async function loadStreams(url,cb){try{var o=[],r=String(url||'').trim();if(r.indexOf('animeua:studios:')===0){var raw=decodeURIComponent(r.slice('animeua:studios:'.length)),studios=JSON.parse(raw);for(var i=0;i<studios.length;i++)addFile(o,studios[i].file,studios[i].name)}else addFile(o,r,'AnimeUA');if(!o.length)return cb({success:false,error:'AnimeUA: відеопотік не знайдено.'});await prepareStreams(o);cb({success:true,data:o})}catch(e){cb({success:false,error:'AnimeUA loadStreams: '+String(e)})}}
"""
s = s[:m.start()] + new + s[m.end():]
s = s.replace('skystream=27', 'skystream=28')
p.write_text(s)

mp = Path('animeua/plugin.json')
data = json.loads(mp.read_text())
if data.get('version') != 27:
    raise SystemExit(f"expected v27, got {data.get('version')}")
data['version'] = 28
mp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
