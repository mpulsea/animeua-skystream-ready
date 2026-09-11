(function () {
    var UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';

    function headers(extra) {
        var h = {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': manifest.baseUrl + '/'
        };
        if (extra) {
            for (var k in extra) h[k] = extra[k];
        }
        return h;
    }

    function absUrl(url) {
        if (!url) return '';
        if (url.indexOf('//') === 0) return 'https:' + url;
        if (url.indexOf('/') === 0) return manifest.baseUrl + url;
        return url;
    }

    function cleanText(s) {
        return (s || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
    }

    function parseCards(html) {
        var out = [];
        if (!html) return out;

        var re = /<a class="poster grid-item[^>]*href="([^"]+)"[^>]*>[\s\S]*?<img[^>]*(?:data-src|src)="([^"]+)"[^>]*>[\s\S]*?<h3 class="poster__title[^>]*>([^<]+)<\/h3>/g;
        var m;
        var seen = {};
        while ((m = re.exec(html)) !== null) {
            var url = absUrl(m[1]);
            if (seen[url]) continue;
            seen[url] = true;
            out.push(new MultimediaItem({
                title: cleanText(m[3]),
                url: url,
                posterUrl: absUrl(m[2]),
                type: 'anime'
            }));
        }
        return out;
    }

    async function fetchHtml(url, customHeaders) {
        var res = await http_get(url, customHeaders || headers());
        return res && typeof res.body === 'string' ? res.body : '';
    }

    async function getHome(cb) {
        try {
            var html = await fetchHtml(manifest.baseUrl + '/');
            var items = parseCards(html);
            if (!items.length) return cb({ success: false, error: 'AnimeUA: каталог не знайдено.' });

            cb({
                success: true,
                data: {
                    'AnimeUA': items.slice(0, 40)
                }
            });
        } catch (e) {
            cb({ success: false, error: 'AnimeUA getHome: ' + String(e) });
        }
    }

    async function search(query, cb) {
        try {
            // DLE search endpoint. AnimeUA's Sora module uses this same endpoint.
            // GET is used here because SkyStream's current runtime exposes http_get reliably.
            var u = manifest.baseUrl + '/index.php?do=search&subaction=search&search_start=0&full_search=0&result_from=1&story=' + encodeURIComponent(query);
            var html = await fetchHtml(u);
            var items = parseCards(html);

            // Fallback: filter current home page if the endpoint returns no cards.
            if (!items.length) {
                var home = await fetchHtml(manifest.baseUrl + '/');
                var q = (query || '').toLowerCase();
                items = parseCards(home).filter(function (x) {
                    return (x.title || '').toLowerCase().indexOf(q) !== -1;
                });
            }

            if (!items.length) return cb({ success: false, error: 'Нічого не знайдено.' });
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, error: 'AnimeUA search: ' + String(e) });
        }
    }

    function getMeta(html, prop) {
        var re = new RegExp('<meta[^>]+property=["\\\']' + prop + '["\\\'][^>]+content=["\\\']([^"\\\']+)["\\\']', 'i');
        var m = html.match(re);
        if (!m) {
            re = new RegExp('<meta[^>]+content=["\\\']([^"\\\']+)["\\\'][^>]+property=["\\\']' + prop + '["\\\']', 'i');
            m = html.match(re);
        }
        return m ? m[1] : '';
    }

    async function getPlayerData(pageHtml) {
        var iframe = pageHtml.match(/<div[^>]*class="[^"]*video-inside[^"]*"[^>]*>[\s\S]*?<iframe[^>]*(?:data-src|src)="([^"]+)"[^>]*>/i);
        if (!iframe) return { playerUrl: '', file: null };

        var playerUrl = absUrl(iframe[1]);
        var playerHtml = await fetchHtml(playerUrl, {
            'User-Agent': UA,
            'Referer': manifest.baseUrl + '/'
        });

        var m = playerHtml.match(/(?:var\s+\w+\s*=\s*)?new\s+Playerjs\s*\(\s*\{[\s\S]*?file\s*:\s*["'](\[[\s\S]*?\]|https?:\/\/[^"']+)["'][\s\S]*?\}\s*\)/);
        return { playerUrl: playerUrl, file: m ? m[1] : null };
    }

    function flattenEpisodes(node, out) {
        if (!node) return;
        if (Array.isArray(node)) {
            for (var i = 0; i < node.length; i++) flattenEpisodes(node[i], out);
            return;
        }
        if (typeof node !== 'object') return;

        if (node.file) {
            var n = parseInt(String(node.title || '').replace(/^Серія\s*/i, '').trim(), 10);
            out.push({
                title: cleanText(node.title || (isNaN(n) ? 'Серія' : 'Серія ' + n)),
                number: isNaN(n) ? out.length + 1 : n,
                file: node.file
            });
        }
        if (node.folder) flattenEpisodes(node.folder, out);
    }

    async function load(url, cb) {
        try {
            var html = await fetchHtml(url);
            if (!html) return cb({ success: false, error: 'AnimeUA: сторінка недоступна.' });

            var title = getMeta(html, 'og:title');
            if (!title) {
                var h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
                title = h1 ? cleanText(h1[1]) : 'AnimeUA';
            }

            var poster = absUrl(getMeta(html, 'og:image'));
            var descMatch = html.match(/<div class="page__text[^>]*>([\s\S]*?)<\/div>/i);
            var description = descMatch ? cleanText(descMatch[1]) : '';

            var year = undefined;
            var yearMatch = html.match(/<div class="pmovie__year">([^<]+)<\/div>/i);
            if (yearMatch) {
                var ym = yearMatch[1].match(/(19|20)\d{2}/);
                if (ym) year = parseInt(ym[0], 10);
            }

            var pdata = await getPlayerData(html);
            var eps = [];

            if (pdata.file) {
                if (/^https?:\/\//i.test(pdata.file)) {
                    eps.push(new Episode({
                        name: 'Серія 1',
                        url: pdata.file,
                        season: 1,
                        episode: 1,
                        dubStatus: 'dubbed'
                    }));
                } else {
                    try {
                        var cfg = JSON.parse(pdata.file);
                        var flat = [];
                        flattenEpisodes(cfg, flat);
                        flat.sort(function (a, b) { return a.number - b.number; });
                        for (var i = 0; i < flat.length; i++) {
                            eps.push(new Episode({
                                name: flat[i].title || ('Серія ' + flat[i].number),
                                url: flat[i].file,
                                season: 1,
                                episode: flat[i].number,
                                dubStatus: 'dubbed'
                            }));
                        }
                    } catch (_) {}
                }
            }

            cb({
                success: true,
                data: new MultimediaItem({
                    title: cleanText(title),
                    url: url,
                    posterUrl: poster || (manifest.baseUrl + '/templates/animeua/images/logo.png'),
                    type: 'anime',
                    year: year,
                    description: description,
                    episodes: eps,
                    playbackPolicy: 'VPN Ukraine may be required outside Ukraine'
                })
            });
        } catch (e) {
            cb({ success: false, error: 'AnimeUA load: ' + String(e) });
        }
    }

    function addStream(out, url, quality, referer) {
        if (!url) return;
        out.push(new StreamResult({
            url: url,
            quality: quality || 'Auto',
            source: 'AnimeUA',
            headers: {
                'Referer': referer || (manifest.baseUrl + '/'),
                'User-Agent': UA
            }
        }));
    }

    async function loadStreams(url, cb) {
        try {
            var streams = [];
            var raw = String(url || '').trim();

            // Some Playerjs configs store multiple qualities like:
            // [720p]https://...m3u8,[1080p]https://...m3u8
            var qr = /\[([^\]]+)\](https?:\/\/[^,\s]+)/g;
            var m;
            while ((m = qr.exec(raw)) !== null) {
                addStream(streams, m[2], m[1], manifest.baseUrl + '/');
            }

            if (!streams.length && /^https?:\/\//i.test(raw)) {
                addStream(streams, raw, raw.indexOf('.m3u8') !== -1 ? 'HLS' : 'Auto', manifest.baseUrl + '/');
            }

            if (!streams.length) return cb({ success: false, error: 'AnimeUA: відеопотік не знайдено.' });
            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, error: 'AnimeUA loadStreams: ' + String(e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
}());
