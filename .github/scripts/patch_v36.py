from pathlib import Path
import json

p = Path('animeua/plugin.js')
s = p.read_text()
old = 'https://animeua-image-proxy.wholesale-source.workers.dev/player?page='
new = 'https://animeua-image-proxy.telling-fox.workers.dev/player?page='
if old not in s:
    raise SystemExit('old worker endpoint not found')
s = s.replace(old, new)
s = s.replace('skystream=35', 'skystream=36')
p.write_text(s)

mp = Path('animeua/plugin.json')
data = json.loads(mp.read_text())
if data.get('version') != 35:
    raise SystemExit(f"expected v35, got {data.get('version')}")
data['version'] = 36
mp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
