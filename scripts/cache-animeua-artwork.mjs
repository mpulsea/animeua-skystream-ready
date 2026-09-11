import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = 'https://animeua.club';
const RAW_BASE = 'https://raw.githubusercontent.com/mpulsea/animeua-skystream-ready/main';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const ART_DIR = path.resolve('artwork');
const MAP_FILE = path.resolve('animeua/poster-map.json');
const CATALOG_PAGES = 5;

const headers = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Referer': `${BASE}/`,
};

function decodeEntities(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#039;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function absoluteUrl(value = '') {
  const u = decodeEntities(value).trim();
  if (!u) return '';
  if (u.startsWith('//')) return `https:${u}`;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/')) return `${BASE}${u}`;
  return `${BASE}/${u.replace(/^\.?\//, '')}`;
}

function cleanText(value = '') {
  return decodeEntities(value)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(tag = '', name) {
  const m = String(tag).match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return m ? m[2] : '';
}

function imageFromTag(tag = '') {
  for (const name of ['data-src', 'data-lazy-src', 'data-original', 'data-url', 'src']) {
    const u = absoluteUrl(attr(tag, name));
    if (u && !/^data:/i.test(u) && !/placeholder/i.test(u)) return u;
  }
  const srcset = attr(tag, 'data-srcset') || attr(tag, 'srcset');
  if (srcset) {
    const parts = srcset.split(',');
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const u = absoluteUrl(parts[i].trim().split(/\s+/)[0]);
      if (u) return u;
    }
  }
  return '';
}

function parseCards(html = '') {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*class=(["'])[^"']*\bposter\b[^"']*\bgrid-item\b[^"']*\1[^>]*>[\s\S]*?<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const block = m[0];
    const open = block.match(/^<a\b[^>]*>/i)?.[0] || '';
    const url = absoluteUrl(attr(open, 'href'));
    const titleMatch = block.match(/<h3\b[^>]*class=(["'])[^"']*\bposter__title\b[^"']*\1[^>]*>([\s\S]*?)<\/h3>/i);
    const title = titleMatch ? cleanText(titleMatch[2]) : cleanText(attr(open, 'title'));
    const imgTag = block.match(/<img\b[^>]*>/i)?.[0] || '';
    const image = imageFromTag(imgTag);
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title, image });
  }
  return out;
}

function meta(html, property) {
  let m = html.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'));
  if (!m) m = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'));
  return m ? absoluteUrl(m[1]) : '';
}

async function fetchText(url) {
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function extensionFor(contentType, sourceUrl) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('webp')) return '.webp';
  if (type.includes('png')) return '.png';
  if (type.includes('gif')) return '.gif';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  const ext = path.extname(new URL(sourceUrl).pathname).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
}

async function downloadArtwork(sourceUrl, key) {
  const res = await fetch(sourceUrl, {
    headers: {
      'User-Agent': UA,
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Referer': `${BASE}/`,
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${res.status} ${sourceUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 512) throw new Error(`image too small (${buf.length} bytes)`);
  const ext = extensionFor(res.headers.get('content-type'), sourceUrl);
  const filename = `${key}${ext}`;
  await fs.writeFile(path.join(ART_DIR, filename), buf);
  return `${RAW_BASE}/artwork/${filename}`;
}

async function loadExistingMap() {
  try {
    const raw = await fs.readFile(MAP_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      byUrl: parsed.byUrl || {},
      byTitle: parsed.byTitle || {},
    };
  } catch {
    return { byUrl: {}, byTitle: {} };
  }
}

async function cachedFileStillExists(rawUrl) {
  if (!rawUrl || !rawUrl.startsWith(`${RAW_BASE}/artwork/`)) return false;
  const filename = rawUrl.slice(`${RAW_BASE}/artwork/`.length);
  try {
    await fs.access(path.join(ART_DIR, filename));
    return true;
  } catch {
    return false;
  }
}

async function collectCatalog() {
  const all = [];
  const seen = new Set();

  for (let page = 1; page <= CATALOG_PAGES; page += 1) {
    const url = page === 1 ? `${BASE}/` : `${BASE}/page/${page}/`;
    const html = await fetchText(url);
    const cards = parseCards(html);
    console.log(`Catalog page ${page}: ${cards.length} cards`);

    for (const card of cards) {
      if (seen.has(card.url)) continue;
      seen.add(card.url);
      all.push(card);
    }
  }

  return all;
}

async function main() {
  await fs.mkdir(ART_DIR, { recursive: true });

  const cards = await collectCatalog();
  if (!cards.length) throw new Error('No AnimeUA cards found');

  const oldMap = await loadExistingMap();
  const byUrl = {};
  const byTitle = {};
  let reused = 0;
  let downloaded = 0;
  let failed = 0;

  for (const card of cards) {
    try {
      const existing = oldMap.byUrl[card.url] || oldMap.byTitle[card.title];
      if (await cachedFileStillExists(existing)) {
        byUrl[card.url] = existing;
        byTitle[card.title] = existing;
        reused += 1;
        continue;
      }

      let source = card.image;
      if (!source) {
        const detail = await fetchText(card.url);
        source = meta(detail, 'og:image');
      }
      if (!source) throw new Error('poster source not found');

      const key = crypto.createHash('sha1').update(card.url).digest('hex').slice(0, 16);
      const raw = await downloadArtwork(source, key);
      byUrl[card.url] = raw;
      byTitle[card.title] = raw;
      downloaded += 1;
      console.log(`Downloaded ${downloaded}: ${card.title}`);
    } catch (e) {
      failed += 1;
      console.warn(`Failed ${card.title}: ${e.message}`);
    }
  }

  const map = {
    updatedAt: new Date().toISOString(),
    pages: CATALOG_PAGES,
    catalogCount: cards.length,
    count: Object.keys(byUrl).length,
    reused,
    downloaded,
    failed,
    byUrl,
    byTitle,
  };

  await fs.writeFile(MAP_FILE, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  console.log(`Poster map: ${map.count}/${cards.length}, reused=${reused}, downloaded=${downloaded}, failed=${failed}`);

  if (!map.count) throw new Error('No AnimeUA posters available');
}

await main();
