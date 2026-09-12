from pathlib import Path
import json
import re

p = Path('animeua/plugin.js')
s = p.read_text()

pat = re.compile(r"async function playerDebug\(s,pageUrl\)\{.*?\}\n(?=function episodeNumber)", re.S)
m = pat.search(s)
if not m:
    raise SystemExit('playerDebug block not found')

new = r'''async function playerDebug(s,pageUrl){var d={iframe:false,player:false,file:false,playerLen:0,fileType:'none',error:'',status:0,attempt:0};try{var f=s.match(/<div[^>]*class=[\"'][^\"']*video-inside[^\"']*[\"'][^>]*>[\s\S]*?<iframe[^>]*(?:data-src|src)=[\"']([^\"']+)[\"'][^>]*>/i)||s.match(/<iframe[^>]*(?:data-src|src)=[\"']([^\"']+)[\"'][^>]*>/i);if(!f)return{file:null,debug:d};d.iframe=true;var pu=abs(f[1]),rr=await getRaw(pu,{}),ph=rr.body||'',pf=null;d.attempt=1;d.status=rr.status||0;if(rr.error)d.error=rr.error;if(ph){d.player=true;d.playerLen=ph.length;pf=playerFileValue(ph)}if(!pf){var relay='https://animeua-image-proxy.wholesale-source.workers.dev/player?page='+encodeURIComponent(pageUrl||manifest.baseUrl+'/');rr=await getRaw(relay,{});d.attempt=9;d.status=rr.status||d.status;if(rr.error)d.error=rr.error;if(rr.body){ph=rr.body;d.player=true;d.playerLen=ph.length;pf=playerFileValue(ph)}}d.file=!!pf;if(pf)d.fileType=/^https?:\/\//i.test(pf)?'url':(pf.charAt(0)==='['?'array':'other');return{file:pf,debug:d}}catch(e){d.error=String(e).slice(0,120);return{file:null,debug:d}}}
'''

s = s[:m.start()] + new + s[m.end():]
s = s.replace('skystream=28', 'skystream=33')
s = s.replace('skystream=32', 'skystream=33')
p.write_text(s)

mp = Path('animeua/plugin.json')
data = json.loads(mp.read_text())
if data.get('version') != 32:
    raise SystemExit(f"expected v32, got {data.get('version')}")
data['version'] = 33
mp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
