#!/usr/bin/env python3
"""Reproducible analysis of clap- and flute-recorded room-acoustic proxies.

Important: handclaps captured on a single uncalibrated microphone are NOT
measured/true room impulse responses. All RT-style results are estimates from
Schroeder backward integration, subject to source, AGC and noise limitations.
"""
from __future__ import annotations
import csv, hashlib, json, math, os, re, wave
from collections import defaultdict
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy import signal, stats, ndimage

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
RAW = ROOT / 'dataset' / 'raw'; OUT = ROOT / 'dataset' / 'processed'; OUT.mkdir(parents=True,exist_ok=True)
(OUT/'ir').mkdir(exist_ok=True)
(OUT/'reference-flute').mkdir(exist_ok=True)
for previous in list((OUT/'ir').glob('*.wav')) + list((OUT/'reference-flute').glob('*.flac')):
    previous.unlink()
BANDS = [125, 250, 500, 1000, 2000, 4000]
LENGTH = 2.8

def norm(v):
    return None if v is None or not np.isfinite(v) else round(float(v), 5)

def loadwav(p):
    a, sr=sf.read(str(p), dtype='float32', always_2d=True)
    return np.mean(a,axis=1),sr,a.shape[1]

def make_id(s):
    return re.sub(r'-+','-',re.sub(r'[^a-z0-9]+','-',s.lower())).strip('-')

def onsets(x,sr):
    hop = int(sr*.02)
    arr=np.pad(np.abs(x), (0,(-len(x))%hop)).reshape(-1,hop)
    peak=arr.max(axis=1)
    peaks, props=signal.find_peaks(peak,height=.35*peak.max(),prominence=.25*peak.max(),distance=int(2.5/.02))
    peaks=sorted(sorted(peaks,key=lambda n:peak[n],reverse=True)[:3])
    indices=[]
    for p in peaks:
        start=max(0,int(p*.02*sr)-int(.02*sr))
        stop=min(len(x),int((p+1)*.02*sr)+int(.01*sr))
        idx=start+int(np.argmax(np.abs(x[start:stop])))
        indices.append(idx)
    return indices

def filt(x,sr,band):
    if band=='broad':
        return signal.sosfilt(signal.butter(3, [100,8000],btype='bandpass',fs=sr,output='sos'),x).astype(np.float32)
    lo=band/np.sqrt(2);hi=band*np.sqrt(2)
    return signal.sosfilt(signal.butter(4,[lo,hi],btype='bandpass',fs=sr,output='sos'),x).astype(np.float32)

def noise_level(x,sr):
    hop=max(1,int(.05*sr))
    if len(x)<hop:return float(np.mean(x*x))
    p=np.mean(np.square(x[:len(x)//hop*hop].reshape(-1,hop)),axis=1)
    return float(np.percentile(p,25))

def decay_stats(tail,sr,noisesq):
    # Truncate only AFTER the transient, once smoothed response power reaches
    # noise + 8 dB. Schroeder integrated energies are noise-floor compensated.
    frame=max(1,int(sr*.02)); n=len(tail)//frame
    if n < 15:return {},[]
    fr=tail[:n*frame].reshape(n,frame)
    powers=np.mean(fr.astype(np.float64)**2,axis=1)
    smooth=ndimage.median_filter(powers,size=5,mode='nearest')
    threshold=max(noisesq*6.3,1e-14)
    low=smooth < threshold
    idx=None
    for i in range(int(.15/.02),n-6):
        if np.sum(low[i:i+6])>=5:
            idx=i
            break
    cutoff=(idx if idx is not None else n-1)*frame
    cutoff=max(int(.24*sr),min(cutoff,len(tail)))
    segment=tail[:cutoff].astype(np.float64)
    clean=np.maximum(segment*segment-noisesq,0)
    integrated=np.cumsum(clean[::-1])[::-1]
    if integrated[0]<=0:return {},[]
    db=10*np.log10(np.maximum(integrated/integrated[0],1e-16))
    tm=np.arange(len(db))/sr
    def fit(upper,lower,extrap):
        valid=(db<=upper)&(db>=lower)&(tm>=.002)
        if np.count_nonzero(valid)<int(.025*sr):return None
        t=tm[valid][::max(1,int(sr*.003))]
        y=db[valid][::max(1,int(sr*.003))]
        if len(t)<8:return None
        slope,intercept,r,p,stderr=stats.linregress(t,y)
        if slope>=-1 or r*r<.84:return None
        if (t.max()-t.min())<.045:return None
        return {'seconds':float(extrap/-slope),'r2':float(r*r),'span_s':float(t.max()-t.min())}
    vals={'t20':fit(-5,-25,60),'t30':fit(-5,-35,60),'edt':fit(-1,-10,60)}
    out={k:(v['seconds'] if v else None) for k,v in vals.items()}
    out.update({k+'_r2':(v['r2'] if v else None) for k,v in vals.items()})
    out['cutoff_s']=cutoff/sr
    out['noise_floor_dbfs']=10*np.log10(max(noisesq,1e-16))
    return out,(tm[::max(1,int(sr*.01))],db[::max(1,int(sr*.01))])

def clarity(tail,sr,noisesq,limit):
    lim=min(len(tail),int(min(limit,2.8)*sr))
    y=np.maximum(np.square(tail[:lim].astype(np.float64))-noisesq,0)
    if len(y)<int(.12*sr):return None,None,None
    t50=min(len(y),int(.05*sr));t80=min(len(y),int(.08*sr))
    e50=float(y[:t50].sum()); e80=float(y[:t80].sum()); total=float(y.sum())
    def c(e):return 10*np.log10(max(e,1e-14)/max(total-e,1e-14)) if total>1e-12 else None
    return c(e50),c(e80),100*e50/total if total>1e-12 else None

def band_stats(x,sr,idx,band):
    # Recording at least 1s before each clap provides local ambient floor.
    pre=x[max(0,idx-int(1.8*sr)):max(0,idx-int(.7*sr))]
    start=max(0,idx-int(.008*sr));end=min(len(x),start+int(LENGTH*sr))
    y=x[start:end]
    yp=filt(y,sr,band)
    prev=filt(pre,sr,band) if len(pre) else pre
    n=noise_level(prev,sr) if len(prev)>100 else 1e-14
    d,curve=decay_stats(yp,sr,n)
    if not d:return None,None
    c50,c80,d50=clarity(yp,sr,n,d['cutoff_s'])
    d.update({'c50_db':c50,'c80_db':c80,'d50_pct':d50,
              'signal_peak':float(np.max(np.abs(yp))),
              'energy':float(np.square(yp).sum())})
    return d,curve

def central(rows,key):
    v=[r[key] for r in rows if r.get(key) is not None and np.isfinite(r[key])]
    return float(np.median(v)) if v else None

def flute_analysis(x,sr):
    hop=int(.1*sr); length=(len(x)//hop)*hop
    frames=x[:length].reshape(-1,hop)
    rms=np.sqrt(np.mean(frames.astype(np.float64)**2,axis=1))
    base=max(float(np.percentile(rms,10)),1e-8)
    hi=float(np.percentile(rms,90))
    active=rms>max(base*4, hi*.10)
    cent=[];roll=[]; dom=[]
    for k in np.flatnonzero(active)[::3]:
        sl=frames[k].astype(np.float64)
        if len(sl)<100:continue
        sp=np.abs(np.fft.rfft(sl*np.hanning(len(sl))))
        f=np.fft.rfftfreq(len(sl),1/sr)
        use=(f>100)&(f<8000)
        sp=sp[use];f=f[use]
        if sp.sum()<1e-8:continue
        cent.append(float(np.sum(sp*f)/sp.sum()))
        roll.append(float(f[np.searchsorted(np.cumsum(sp),sp.sum()*.85)]))
        dom.append(float(f[np.argmax(sp)]))
    return {
      'duration_s':len(x)/sr,'active_s':float(active.sum()*.1),
      'active_pct':float(active.mean()*100),
      'rms_active_dbfs':float(20*np.log10(max(float(np.sqrt(np.mean(rms[active]**2))) if active.any() else 1e-8,1e-8))),
      'spectral_centroid_hz':float(np.median(cent)) if cent else None,
      'spectral_rolloff_85_hz':float(np.median(roll)) if roll else None,
      'dominant_peak_median_hz':float(np.median(dom)) if dom else None,
      'noise_floor_dbfs':float(20*np.log10(base)),
    }

def write_csv(path,rows,fieldnames=None):
    if not rows:return
    fn=fieldnames or list(rows[0])
    with open(path,'w',newline='',encoding='utf-8') as h:
        w=csv.DictWriter(h,fieldnames=fn,extrasaction='ignore');w.writeheader();w.writerows(rows)

files=sorted(RAW.glob('*.wav'))
# Explicit canonicalization of known filename differences: do not merge
# Blocker Staircase with Blocker Stairwell without physical-place confirmation.
flute_mapping={'Lamgford Atrium':'Langford Atrium'}
allfiles=[]; all_flute={}; flute_rows=[]; events=[]; bands=[]; curves=[]; rooms=[]; irs={}
for p in files:
    name=p.stem;kind='clap' if name.endswith(' Clap') else 'flute'
    location=name.rsplit(' ',1)[0]
    canonical=flute_mapping.get(location,location)
    x,sr,ch=loadwav(p)
    sha=hashlib.sha256(p.read_bytes()).hexdigest()
    allfiles.append({'filename':p.name,'type':kind,'inferred_location':location,
        'canonical_location':canonical,'duration_s':len(x)/sr,'sample_rate_hz':sr,
        'channels':ch,'bits_per_sample':24,'peak_dbfs':20*np.log10(max(float(np.max(np.abs(x))),1e-12)),
        'rms_dbfs':20*np.log10(max(float(np.sqrt(np.mean(x.astype(np.float64)**2))),1e-12)),
        'sha256':sha,'duplicate_of':None, 'notes':''})
    if kind=='flute':
        if location=='Lamgford Atrium':
            allfiles[-1]['duplicate_of']='Langford Atrium Flute.wav'
            allfiles[-1]['notes']='Byte-identical duplicate; excluded from flute counts.'
            continue
        m=flute_analysis(x,sr);m.update({'location':canonical,'filename':p.name,'sha256':sha})
        flute_rows.append(m);all_flute[canonical]=m
    else:
        inds=onsets(x,sr)
        irs[location]={'x':x,'sr':sr,'inds':inds,'filename':p.name,'sha256':sha}
        allfiles[-1]['notes']=f'{len(inds)} prominent claps detected'

for room,record in sorted(irs.items()):
    x,sr,inds=record['x'],record['sr'],record['inds'];rid=make_id(room)
    allm={band:[] for band in ['broad']+BANDS};allcurves=defaultdict(list)
    irs_for_room=[]
    for i,idx in enumerate(inds,1):
        broad,curve=band_stats(x,sr,idx,'broad')
        event={'location':room,'location_id':rid,'clap_number':i,'onset_s':idx/sr,
               'peak_dbfs':20*np.log10(max(float(np.abs(x[idx])),1e-10)),
               'recording':record['filename'],'duration_analyzed_s':LENGTH}
        if broad:
            event.update({k:broad.get(k) for k in ['t20','t30','edt','t20_r2','t30_r2','edt_r2','c50_db','c80_db','d50_pct','cutoff_s','noise_floor_dbfs']})
            allm['broad'].append(broad)
            allcurves['broad'].append(curve)
        events.append(event)
        for b in BANDS:
            m,c=band_stats(x,sr,idx,b)
            if m:
                allm[b].append(m);allcurves[b].append(c)
        # Construct a normalized, denoised clap-shaped convolution proxy.
        # A handclap is an imperfect excitation, and AGC/noise may change it.
        start=max(0,idx-int(.008*sr)); y=x[start:start+int(2.2*sr)].copy()
        if len(y)<int(2.2*sr):y=np.pad(y,(0,int(2.2*sr)-len(y)))
        # Noise gate from RMS envelope: gain decays with measured signal RMS.
        short=max(16,int(.02*sr)); sq=ndimage.uniform_filter1d(y*y,size=short)
        rms=np.sqrt(np.maximum(sq,1e-14))
        pre=x[max(0,idx-int(1.7*sr)):max(0,idx-int(.7*sr))]
        floor=np.sqrt(max(noise_level(pre,sr),1e-14))
        gate=np.clip((rms-floor*1.4)/(max(floor,1e-7)*5),0,1)
        gate=ndimage.gaussian_filter1d(gate,sigma=int(.006*sr))
        fade=np.minimum(1,np.arange(len(y))[::-1]/(.20*sr))
        irs_for_room.append(y*gate*fade)
    # Use best quality response among 3 claps rather than summing claps with
    # different delays (they were recorded at different times/positions).
    best_i=0
    scores=[]
    for i in range(len(inds)):
        b=allm['broad'][i] if i<len(allm['broad']) else {}
        scores.append((1 if b.get('t20') is not None else 0, b.get('t20_r2') or 0))
    if scores:best_i=max(range(len(scores)), key=lambda i:scores[i])
    ir=irs_for_room[best_i] if irs_for_room else np.zeros(int(sr*2.2),dtype=np.float32)
    # Normalize energy rather than peak: prevents giant clipping when convolved.
    ir=signal.resample_poly(ir,1,2)
    ir=ir/(np.sqrt(np.sum(ir.astype(np.float64)**2))+1e-10)*.36
    ir=np.clip(ir,-.95,.95)
    sf.write(OUT/'ir'/f'{rid}.wav',ir,24000,subtype='PCM_16')
    by_band={}
    for b in ['broad']+BANDS:
        d=allm[b]
        entry={'location':room,'location_id':rid,'band_hz':b,'sample_count':len(d),
               't20_s':central(d,'t20'),'t30_s':central(d,'t30'),
               'edt_s':central(d,'edt'),'c50_db':central(d,'c50_db'),
               'c80_db':central(d,'c80_db'),'d50_pct':central(d,'d50_pct'),
               't20_valid_claps':sum(1 for v in d if v.get('t20') is not None),
               't30_valid_claps':sum(1 for v in d if v.get('t30') is not None),
               't20_median_r2':central([v for v in d if v.get('t20') is not None],'t20_r2'),
               'cutoff_s':central(d,'cutoff_s')}
        bands.append(entry);by_band[b]=entry
        cs=allcurves[b]
        if cs:
            # average ENERGY per position; retain available portions of each.
            for t in np.arange(0,2.551,.05):
                vals=[float(np.interp(t,tm,db)) for tm,db in cs if t<=tm[-1]]
                if vals:
                    curves.append({'location':room,'location_id':rid,'band_hz':b,
                                   'time_s':float(round(t,3)),'decay_db':float(np.median(vals)),
                                   'replicate_count':len(vals)})
    broad=by_band['broad'];speech=[by_band[b]['t20_s'] for b in [500,1000] if by_band[b]['t20_s'] is not None]
    t20=[v['t20'] for v in allm['broad'] if v.get('t20') is not None]
    cv=np.std(t20,ddof=1)/np.mean(t20) if len(t20)>=2 else None
    roomrow={'location':room,'location_id':rid,'recording':record['filename'],
        'flute_available':room in all_flute,'flute_recording':all_flute.get(room,{}).get('filename'),
        'clap_count':len(inds),'t20_broad_s':broad['t20_s'],'t30_broad_s':broad['t30_s'],
        'edt_broad_s':broad['edt_s'],'t20_500_1000_s':np.median(speech) if speech else None,
        'c50_broad_db':broad['c50_db'],'c80_broad_db':broad['c80_db'],
        'd50_broad_pct':broad['d50_pct'],'noise_floor_dbfs':central(allm['broad'],'noise_floor_dbfs'),
        'valid_broad_t20':broad['t20_valid_claps'],'cv_broad_t20':cv,
        't20_r2_median':broad['t20_median_r2'],'response_cutoff_s':broad['cutoff_s'],
        'ir_filename':f'ir/{rid}.wav',
        'data_quality':('usable proxy' if broad['t20_valid_claps']>=2 and (cv is None or cv<.3) else 'limited / review'),
        'interpretation':'Handclap-based response estimate, not calibrated ISO 3382 measurement'}
    rooms.append(roomrow)

# Independent, descriptive flute measurements are NOT synthetic comparisons;
# include reference audio separately. Use compact FLAC lossless for project.
for p in files:
    if not p.stem.endswith(' Flute') or p.stem.startswith('Lamgford '):continue
    loc=p.stem[:-6];loc=flute_mapping.get(loc,loc)
    x,sr,_=loadwav(p)
    # Small downloadable source: 24kHz OGG if ffmpeg installed will be exported
    # externally, or 24kHz lossless FLAC as no-codec fallback.
    shortened=signal.resample_poly(x,1,2)
    sf.write(OUT/'reference-flute'/f'{make_id(loc)}.flac',shortened,24000,subtype='PCM_16')

write_csv(OUT/'recording-catalog.csv',allfiles)
write_csv(OUT/'locations.csv',rooms)
write_csv(OUT/'individual-claps.csv',events)
write_csv(OUT/'octave-bands.csv',bands)
write_csv(OUT/'decay-curves.csv',curves)
write_csv(OUT/'flute-features.csv',flute_rows)
export={'generated_from':'Team-collected recordings supplied by user','method':'Clap-derived, approximate acoustic response',
 'qualification':'Not true calibrated impulse responses or ISO 3382 reverberation times',
 'locations':[]}
for r in rooms:
    data={k:(bool(v) if isinstance(v,np.bool_) else norm(v) if isinstance(v,(float,np.floating)) else v) for k,v in r.items()}
    data['bands']=[{k:norm(v) if isinstance(v,(float,np.floating)) else v for k,v in b.items()} for b in bands if b['location']==r['location']]
    data['flute_features']=next(( {k:norm(v) if isinstance(v,(float,np.floating)) else v for k,v in f.items()} for f in flute_rows if f['location']==r['location']),None)
    data['flute_preview']=(f'reference-flute/{make_id(r["location"])}.flac') if r['flute_available'] else None
    export['locations'].append(data)
with open(OUT/'locations.json','w',encoding='utf-8') as h:json.dump(export,h,indent=2,allow_nan=False)
for r in rooms:
 print(f"{r['location']:34} t20 broad={r['t20_broad_s']!s:8} t20 speech={r['t20_500_1000_s']!s:8} valid={r['valid_broad_t20']} c50={r['c50_broad_db']} flag={r['data_quality']}")
print(f'ALL: files={len(allfiles)} clap events={len(events)} bands={len(bands)} edc rows={len(curves)} flutes={len(flute_rows)}')
