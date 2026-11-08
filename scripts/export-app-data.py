#!/usr/bin/env python3
"""Refresh web app assets from the analyzed primary audio features.
Requires: standard Python, and ffmpeg on PATH for compact MP3 flute assets.
"""
import csv,json,subprocess,shutil,re
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'dataset'/'processed';APP=ROOT/'app'/'data'
(APP/'ir').mkdir(parents=True,exist_ok=True)
(APP/'flute').mkdir(parents=True,exist_ok=True)
for old in (APP/'ir').glob('*.wav'):old.unlink()
for old in (APP/'flute').glob('*.mp3'):old.unlink()
for p in (OUT/'ir').glob('*.wav'):shutil.copyfile(p,APP/'ir'/p.name)
with open(OUT/'locations.json',encoding='utf8') as h: info=json.load(h)
with open(OUT/'flute-features.csv',encoding='utf8') as h: flute=list(csv.DictReader(h))
by={v['location'] for v in info['locations']}
def slug(x):return re.sub(r'-+','-',re.sub(r'[^a-z0-9]+','-',x.lower())).strip('-')
for f in flute:
 if f['location'] in by:continue
 loc=f['location'];lid=slug(loc)
 info['locations'].append({'location':loc,'location_id':lid,'flute_available':True,'flute_recording':f['filename'],
  'mode':'flute-only','ir_filename':None,'bands':[],'data_quality':'reference only',
  'flute_features':{k:float(v) if k not in ('location','filename','sha256') and v else v for k,v in f.items()},
  'flute_preview':f'flute/{lid}.mp3'})
for loc in info['locations']:
 loc['mode']='acoustics' if loc.get('ir_filename') else 'flute-only'
 if loc.get('flute_preview'):
  loc['flute_preview']=f'flute/{loc["location_id"]}.mp3'
with open(APP/'locations.json','w',encoding='utf8') as h:json.dump(info,h,indent=2)
with open(OUT/'decay-curves.csv',newline='',encoding='utf8') as h:curves=list(csv.DictReader(h))
d={}
for x in curves:
 if x['band_hz']=='broad':d.setdefault(x['location_id'],[]).append([float(x['time_s']),round(float(x['decay_db']),2)])
with open(APP/'decay-curves.json','w',encoding='utf8') as h:json.dump(d,h,separators=(',',':'))
for f in flute:
 lid=slug(f['location']); src=OUT/'reference-flute'/f'{lid}.flac'
 if not src.exists():raise FileNotFoundError(src)
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(src),'-ac','1','-ar','24000',
                 '-b:a','64k',str(APP/'flute'/f'{lid}.mp3')],check=True)
print('Updated app: ',len(info['locations']),'spaces, ',len(list((APP/'ir').glob('*.wav'))),'IR proxies,',len(flute),'flute previews')
