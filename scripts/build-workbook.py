#!/usr/bin/env python3
"""Build an Excel analysis workbook from source-derived CSV data.
Workbook editing uses artifact_tool exclusively.
"""
import csv, math, statistics
from pathlib import Path
from artifact_tool import Workbook, SpreadsheetFile
P=Path(__file__).resolve().parent.parent/'dataset'/'processed'
DEST=Path(__file__).resolve().parent.parent/'dataset'/'campus-acoustics-analysis.xlsx'
def rows(f):
 with open(P/f,encoding='utf-8',newline='') as h:return list(csv.DictReader(h))
def num(v):
 if v is None or v=='':return None
 try:
  f=float(v);return round(f,6) if math.isfinite(f) else None
 except:return v
rooms=rows('locations.csv');octs=rows('octave-bands.csv');claps=rows('individual-claps.csv');flutes=rows('flute-features.csv');catalog=rows('recording-catalog.csv');curves=rows('decay-curves.csv')
BANDS=[125,250,500,1000,2000,4000]
# theme
NAVY='#17263D';DARK='#101B2D';MAROON='#6B2137';TEAL='#177E89';INK='#203149';MUTED='#66788D';WHITE='#FFFFFF';PALE='#ECF4F7';FAINT='#F5F8FA';GOLD='#C8934C';RED='#A94442'
wb=Workbook.create()

def sh(name,title,sub,headers,widths,records,table_name=None):
 s=wb.worksheets.add(name);n=len(headers)
 s.merge_cells(f'A1:{col(n)}1');s.get_range('A1').values=[[title]]
 s.get_range(f'A1:{col(n)}1').format={'fill':NAVY,'font':{'color':WHITE,'bold':True,'size':18},'row_height':38,'vertical_alignment':'center'}
 s.merge_cells(f'A2:{col(n)}2');s.get_range('A2').values=[[sub]]
 s.get_range(f'A2:{col(n)}2').format={'fill':PALE,'font':{'color':MUTED,'italic':True,'size':10},'row_height':26,'vertical_alignment':'center'}
 s.get_range_by_indexes(3,0,1,n).values=[headers]
 s.get_range_by_indexes(3,0,1,n).format={'fill':MAROON,'font':{'bold':True,'color':WHITE,'size':10},'wrap_text':True,'row_height':33,'vertical_alignment':'center'}
 if records:
  s.get_range_by_indexes(4,0,len(records),n).values=records
  s.get_range_by_indexes(4,0,len(records),n).format={'font':{'size':10,'color':INK},'row_height':20}
 for i,w in enumerate(widths):s.get_range(f'{col(i+1)}:{col(i+1)}').format.column_width=w
 s.freeze_panes.freeze_rows(4)
 if records and table_name:s.tables.add(f'A4:{col(n)}{len(records)+4}',True,table_name)
 return s

def col(n):
 s=''
 while n:s=chr(65+(n-1)%26)+s;n=(n-1)//26
 return s

def frow(d,keys):return [num(d.get(k,'')) for k in keys]

# Basic room-level dataset
rheads=['Location','Location ID','Claps','Flute?','T20 500–1k (s)','T20 broad (s)','T30 broad (s)','EDT broad (s)','C50 (dB)','C80 (dB)','D50 (%)','Pre-clap noise (dBFS)','T20 replicate CV','Valid T20 (of 3)','Quality review','Clap-derived IR','Clap source filename','Flute source filename','Useful tail (s)','T20 fit R²','Decay category']
rkeys=['location','location_id','clap_count','flute_available','t20_500_1000_s','t20_broad_s','t30_broad_s','edt_broad_s','c50_broad_db','c80_broad_db','d50_broad_pct','noise_floor_dbfs','cv_broad_t20','valid_broad_t20','data_quality','ir_filename','recording','flute_recording','response_cutoff_s','t20_r2_median']
rvalues=[]
for r in rooms:
 x=frow(r,rkeys);x[3]='Yes' if r.get('flute_available')=='True' else 'No';rvalues.append(x+[''])
s=sh('Room Profiles','ROOM PROFILES  /  canonical spaces','Primary measurement table: 13 spaces · medians across up to three claps · times are provisional clap-derived estimates',rheads,[35,30,9,10,18,16,16,16,13,13,13,23,20,19,20,32,38,38,16,16,18],rvalues,'RoomProfiles')
s.get_range('U5').formulas=[['=IF(E5="","insufficient",IF(E5<0.6,"short decay",IF(E5>=1.5,"long decay","mid decay")))']]
s.get_range(f'U5:U{4+len(rooms)}').fill_down()
s.get_range(f'E5:K{4+len(rooms)}').set_number_format('0.000')
s.get_range(f'L5:M{4+len(rooms)}').set_number_format('0.000')
s.get_range(f'T5:T{4+len(rooms)}').set_number_format('0.000')
s.get_range(f'E5:E{4+len(rooms)}').conditional_formats.add_data_bar({'color':TEAL,'gradient':True})
s.get_range(f'M5:M{4+len(rooms)}').conditional_formats.add_cell_is({'operator':'greaterThan','formula':0.30,'format':{'fill':'#FCE8E6'}})

# Frequencies per location
bandheads=['Location','Location ID','Band (Hz)','Claps analyzed','Valid T20 claps','T20 median (s)','T30 median (s)','EDT median (s)','C50 (dB)','C80 (dB)','D50 (%)','Valid T30 claps','T20 R² median','Tail cutoff (s)']
bandkeys=['location','location_id','band_hz','sample_count','t20_valid_claps','t20_s','t30_s','edt_s','c50_db','c80_db','d50_pct','t30_valid_claps','t20_median_r2','cutoff_s']
bvalues=[frow(r,bandkeys) for r in octs]
s=sh('Octave Bands','OCTAVE-BAND REVERBERATION ESTIMATES','Nominal octave center bands 125–4000 Hz (Butterworth filters); blank = fit not defensible, never zero',bandheads,[35,28,14,18,20,18,18,18,15,15,15,20,20,18],bvalues,'OctaveBandMeasurements')
s.get_range(f'F5:K{len(bvalues)+4}').set_number_format('0.000')
s.get_range(f'M5:N{len(bvalues)+4}').set_number_format('0.000')
s.get_range(f'F5:F{len(bvalues)+4}').conditional_formats.add_data_bar({'color':TEAL,'gradient':True})

# Claps individually
clapheads=['Location','Location ID','Clap #','Peak time (s)','Peak (dBFS)','Source WAV','Cutout (s)','T20 (s)','T30 (s)','EDT (s)','T20 fit R²','T30 fit R²','EDT fit R²','C50 (dB)','C80 (dB)','D50 (%)','Usable tail (s)','Pre-clap noise (dBFS)']
clapkeys=['location','location_id','clap_number','onset_s','peak_dbfs','recording','duration_analyzed_s','t20','t30','edt','t20_r2','t30_r2','edt_r2','c50_db','c80_db','d50_pct','cutoff_s','noise_floor_dbfs']
cvalues=[frow(r,clapkeys) for r in claps]
s=sh('Individual Claps','INDIVIDUAL CLAPS  /  repeatability','Each detected handclap is a separate replicate. Check fit quality and cross-clap variance before interpretation.',clapheads,[35,28,10,17,17,40,15,13,13,13,17,17,17,13,13,13,18,21],cvalues,'ClapEvents')
s.get_range(f'D5:R{len(cvalues)+4}').set_number_format('0.000')

# Flute features, including flute-only locations
fheads=['Inferred location','Flute WAV source','Duration (s)','Active playing (s)','Active (%)','Active RMS (dBFS)','Median centroid (Hz)','85% rolloff (Hz)','Median dominant peak (Hz)','Quiet-frame floor (dBFS)','SHA256','Application use']
fkeys=['location','filename','duration_s','active_s','active_pct','rms_active_dbfs','spectral_centroid_hz','spectral_rolloff_85_hz','dominant_peak_median_hz','noise_floor_dbfs','sha256']
fvalues=[];clap_names={r['location'] for r in rooms}
for f in flutes:
 v=frow(f,fkeys);v.append('Live flute reference + IR' if f['location'] in clap_names else 'Flute-only reference; no measured IR');fvalues.append(v)
s=sh('Flute References','FLUTE RECORDING FEATURES','Independent ambient musical references; not standardized test tones, source-instrument acoustics and melody affect these features',fheads,[35,42,17,20,15,21,22,20,25,24,66,38],fvalues,'FluteSources')
s.get_range(f'C5:J{len(fvalues)+4}').set_number_format('0.00')

# Catalog
heads=['Original WAV filename','Type','Filename location','Canonical location','Duration (s)','Rate (Hz)','Channels','Depth (bits)','Peak (dBFS)','RMS (dBFS)','SHA256 checksum','Duplicate of','Audit notes']
keys=['filename','type','inferred_location','canonical_location','duration_s','sample_rate_hz','channels','bits_per_sample','peak_dbfs','rms_dbfs','sha256','duplicate_of','notes']
values=[frow(r,keys) for r in catalog]
s=sh('File Audit','SOURCE RECORDING INVENTORY','All 23 supplied files. SHA-256 identifies exact duplicates; timestamps inside archive are not verified recording times.',heads,[44,13,31,31,17,16,15,17,19,19,70,43,46],values,'RecordingAudit')
s.get_range(f'E5:E{len(values)+4}').set_number_format('0.00')
s.get_range(f'I5:J{len(values)+4}').set_number_format('0.00')

# Longitudinal (time series) dataset
heads=['Location','Location ID','Band (Hz)','Time since clap (s)','Schroeder decay (dB)','Contributing claps']
keys=['location','location_id','band_hz','time_s','decay_db','replicate_count']
values=[frow(r,keys) for r in curves]
s=sh('Decay Curve Data','SCHROEDER ENERGY-DECAY CURVES','50 ms time steps, median across valid unclipped replicate curves; absent timestamps mean no supported signal remains',heads,[35,30,14,23,23,23],values,'SchroederDecays')
s.get_range(f'D5:E{len(values)+4}').set_number_format('0.000')

# Overview/dashboard - with readable measured facts and dedicated charts
s=wb.worksheets.add('Dashboard')
s.merge_cells('A1:R2');s.get_range('A1').values=[['CAMPUS ACOUSTICS  /  FIELD SOUND ATLAS']]
s.get_range('A1:R2').format={'fill':DARK,'font':{'bold':True,'color':WHITE,'size':20},'row_height':25,'vertical_alignment':'center'}
s.merge_cells('A3:R3');s.get_range('A3').values=[['TAMU Datathon · original-location recordings · source-driven analysis and user-interactive sound simulation']]
s.get_range('A3:R3').format={'fill':PALE,'font':{'color':INK,'size':11},'row_height':26}
s.merge_cells('A5:R5');s.get_range('A5').values=[['Source: 23 files (one exact duplicate), 13 clap locations and 2 additional flute-only locations. Every RT value is a non-calibrated estimate.']]
s.get_range('A5:R5').format={'fill':'#FFF2E8','font':{'color':'#854A22','size':10},'row_height':27}
for a,label,value in [('A7','Clap locations',13),('E7','Clap events',39),('I7','Unique flute recordings',9),('M7','Flute-only locations',2)]:
 c=int(ord(a[0])-ord('A'))
 s.merge_cells(f'{col(c+1)}7:{col(c+4)}7');s.get_range(a).values=[[label]]
 s.get_range(f'{col(c+1)}7:{col(c+4)}7').format={'fill':NAVY,'font':{'color':WHITE,'bold':True},'row_height':26}
 s.merge_cells(f'{col(c+1)}8:{col(c+4)}9');s.get_range(f'{col(c+1)}8').values=[[value]]
 s.get_range(f'{col(c+1)}8:{col(c+4)}9').format={'fill':FAINT,'font':{'color':TEAL,'bold':True,'size':24},'row_height':25}
for a in ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R']:s.get_range(f'{a}:{a}').format.column_width=13
s.get_range('A11:E11').values=[['RANK','LOCATION','T20 mid (s)','C50 (dB)','STATUS']]
s.get_range('A11:E11').format={'fill':MAROON,'font':{'bold':True,'color':WHITE},'row_height':26}
ranked=sorted(rooms,key=lambda x: -float(x['t20_500_1000_s'] or 0))
for i,r in enumerate(ranked,12):
 s.get_range(f'A{i}:E{i}').values=[[i-11,r['location'],num(r['t20_500_1000_s']),num(r['c50_broad_db']),r['data_quality']]]
 s.get_range(f'A{i}:E{i}').format.row_height=21
s.get_range('B:B').format.column_width=37
s.get_range('C12:D24').set_number_format('0.00')
s.get_range('C12:C24').conditional_formats.add_data_bar({'color':TEAL,'gradient':True})
s.get_range('A27:F27').values=[['Frequency','125 Hz','250 Hz','500 Hz','1000 Hz','2000 Hz']]
s.get_range('A27:F27').format={'fill':MAROON,'font':{'bold':True,'color':WHITE},'row_height':25}
# normalized median T20 across *valid rooms* per band, computed from actual observations
s.get_range('A28:F28').values=[['Median T20 (s)']+[round(statistics.median(float(v['t20_s']) for v in octs if v['band_hz']==str(b) and v['t20_s']),3) if any(v['band_hz']==str(b) and v['t20_s'] for v in octs) else None for b in BANDS[:5]]]
s.get_range('A29:F29').values=[['Available rooms']+[sum(1 for v in octs if v['band_hz']==str(b) and v['t20_s']) for b in BANDS[:5]]]
s.get_range('A31:F31').values=[['Frequency','4000 Hz','','','','']]
s.get_range('A32:B32').values=[['Median T20 (s)',round(statistics.median(float(v['t20_s']) for v in octs if v['band_hz']=='4000' and v['t20_s']),3)]]
s.merge_cells('A35:R35');s.get_range('A35').values=[['MEANINGFUL FINDINGS FROM THE PROVIDED RECORDINGS']]
s.get_range('A35:R35').format={'fill':NAVY,'font':{'color':WHITE,'bold':True},'row_height':26}
longest=max(rooms,key=lambda x:float(x['t20_500_1000_s'] or 0));shortest=min(rooms,key=lambda x:float(x['t20_500_1000_s'] or 99))
msgs=[f"Longest measured mid-frequency decay: {longest['location']} ({float(longest['t20_500_1000_s']):.2f}s T20 proxy).",f"Shortest measured mid-frequency decay: {shortest['location']} ({float(shortest['t20_500_1000_s']):.2f}s T20 proxy).",'Numbers are estimates from uncalibrated handclaps, NOT ISO-certified reverberation times. They can be biased by AGC, background noise and clap spectrum.','Two flute-only spaces have real music examples but no convolver: Blocker Stairwell and Zachry Long Hallway.','One of the two Langford Atrium flute files is an identical duplicate, not a new sample.']
for n,msg in enumerate(msgs,37):
 s.merge_cells(f'A{n}:R{n}');s.get_range(f'A{n}').values=[[msg]];s.get_range(f'A{n}:R{n}').format={'font':{'color':INK,'size':11},'row_height':24}
chart=s.charts.add('bar',{'title':'Campus spaces · mid-frequency T20 estimate','has_legend':False})
chart.bar_options.direction='bar'
series=chart.series.add('T20 estimate (s)')
series.category_formula="'Dashboard'!$B$12:$B$24";series.formula="'Dashboard'!$C$12:$C$24"
chart.set_position('H11','R30')

# Compare two spaces with live dropdowns + formulas.
s=wb.worksheets.add('Compare Two Rooms')
s.merge_cells('A1:N2');s.get_range('A1').values=[['LISTENING SPACE COMPARISON']]
s.get_range('A1:N2').format={'fill':DARK,'font':{'color':WHITE,'bold':True,'size':18},'row_height':23}
s.merge_cells('A3:N3');s.get_range('A3').values=[['Select two clap-measured rooms. Excel formulas automatically retrieve their measured metrics and octave-band estimates.']]
s.get_range('A3:N3').format={'fill':PALE,'font':{'color':INK,'size':11},'row_height':24}
s.get_range('A6').values=[['ROOM A']];s.get_range('G6').values=[['ROOM B']]
s.merge_cells('B6:E6');s.merge_cells('H6:K6')
s.get_range('B6').values=[['Zachry Stairwell']];s.get_range('H6').values=[['Zachry Collaboration Room']]
s.get_range('A6:K6').format.row_height=31
s.get_range('B6:E6').format={'fill':'#E8F6F6','font':{'bold':True,'color':TEAL},'row_height':29}
s.get_range('H6:K6').format={'fill':'#F7E9EE','font':{'bold':True,'color':MAROON},'row_height':29}
choices=[r['location'] for r in rooms]
s.get_range('B6').data_validation={'rule':{'type':'list','values':choices}}
s.get_range('H6').data_validation={'rule':{'type':'list','values':choices}}
s.get_range('A9:C9').values=[['MEASURE','ROOM A','ROOM B']]
s.get_range('A9:C9').format={'fill':MAROON,'font':{'bold':True,'color':WHITE},'row_height':24}
measures=[('Mid-frequency T20 (s)','E'),('Broadband T20 (s)','F'),('Broadband T30 (s)','G'),('Early decay EDT (s)','H'),('Clarity C50 (dB)','I'),('Clarity C80 (dB)','J'),('Definition D50 (%)','K'),('Background (dBFS)','L'),('Replicate CV','M')]
for i,(label,column) in enumerate(measures,10):
 s.get_range(f'A{i}').values=[[label]]
 for dest,sel in [('B','$B$6'),('C','$H$6')]:
  # IFERROR returns empty if missing; raw values remain unaltered.
  s.get_range(f'{dest}{i}').formulas=[[f'=IFERROR(INDEX(\'Room Profiles\'!${column}$5:${column}$17,MATCH({sel},\'Room Profiles\'!$A$5:$A$17,0)),"")']]
s.get_range('B10:C18').set_number_format('0.000')
s.get_range('A21:C21').values=[['OCTAVE (Hz)','ROOM A T20 (s)','ROOM B T20 (s)']]
s.get_range('A21:C21').format={'fill':MAROON,'font':{'bold':True,'color':WHITE},'row_height':25}
for i,b in enumerate(BANDS,22):
 s.get_range(f'A{i}').values=[[b]]
 for dest,sel in [('B','$B$6'),('C','$H$6')]:
  # one matching record per location / band; missing accepted estimates remain blank
  formula=f'=IF(COUNTIFS(\'Octave Bands\'!$A$5:$A$95,{sel},\'Octave Bands\'!$C$5:$C$95,$A{i},\'Octave Bands\'!$E$5:$E$95,">0")=0,"",SUMIFS(\'Octave Bands\'!$F$5:$F$95,\'Octave Bands\'!$A$5:$A$95,{sel},\'Octave Bands\'!$C$5:$C$95,$A{i}))'
  s.get_range(f'{dest}{i}').formulas=[[formula]]
s.get_range('B22:C27').set_number_format('0.000')
s.merge_cells('A30:N30');s.get_range('A30').values=[['Do not interpret the room that sounds “best” as objectively better. Speech, singing, ambience, and recording have different tradeoffs.']]
s.get_range('A30:N30').format={'fill':'#FFF2E8','font':{'color':'#854A22'},'row_height':28}
chart=s.charts.add('bar',{'title':'T20 frequency response · selected spaces','has_legend':True})
for dest,name in [('B','Room A'),('C','Room B')]:
 ser=chart.series.add(name);ser.category_formula="'Compare Two Rooms'!$A$22:$A$27";ser.formula=f"'Compare Two Rooms'!${dest}$22:${dest}$27"
chart.bar_options.direction='column';chart.set_position('E10','N27')
for a,w in {'A':33,'B':22,'C':22,'D':13,'E':12,'F':12,'G':15,'H':21,'I':15,'J':14,'K':15,'L':15,'M':15,'N':15}.items():s.get_range(f'{a}:{a}').format.column_width=w
s.freeze_panes.freeze_rows(3)

# Explicit decay-curve panel from measured time samples; no extrapolation
s=wb.worksheets.add('EDC Examples')
s.merge_cells('A1:N2');s.get_range('A1').values=[['SCHROEDER BACKWARD INTEGRATION  /  EXAMPLES']]
s.get_range('A1:N2').format={'fill':NAVY,'font':{'color':WHITE,'bold':True,'size':16},'row_height':23}
s.merge_cells('A3:N3');s.get_range('A3').values=[['Measured room decay relative to initial response energy; gaps mean the recorded tail dropped to the noise floor.']]
s.get_range('A3:N3').format={'fill':PALE,'font':{'color':INK},'row_height':26}
ex=['Zachry Stairwell','Control Room','Zachry Collaboration Room']
s.get_range('A5:D5').values=[['Seconds']+ex];s.get_range('A5:D5').format={'fill':MAROON,'font':{'color':WHITE,'bold':True},'row_height':28}
lookup={(r['location'],float(r['time_s'])):float(r['decay_db']) for r in curves if r['band_hz']=='broad'}
val=[]
for i in range(0,52):
 t=round(i*.05,2);val.append([t]+[round(lookup[(room,t)],3) if (room,t) in lookup else None for room in ex])
s.get_range('A6:D57').values=val;s.get_range('A6:D57').set_number_format('0.000')
chart=s.charts.add('line',{'title':'Measured broadband energy-decay curves','has_legend':True})
for c,room in zip(['B','C','D'],ex):
 ser=chart.series.add(room);ser.category_formula="'EDC Examples'!$A$6:$A$57";ser.formula=f"'EDC Examples'!${c}$6:${c}$57"
chart.set_position('F6','N30')
for k in range(1,15):s.get_range(f'{col(k)}:{col(k)}').format.column_width=(33 if k in [2,3,4] else 15)

# Methodology and responsible interpretations
method=[
('WHAT THIS IS','Source: the 23 WAV files supplied in Locations Claps and Flute.zip; thirteen rooms with three detected claps each.'),
('PRIMARY COLLECTION','The user reports on-site recording during TAMU Datathon. Device, microphone placement, people present, and exact acquisition time are NOT provided; fill them in from field notes.'),
('NO FABRICATION','No inferred collection timestamp, microphone calibration, physical room volume, absorption coefficient, temperature, geometry, or SPL was invented.'),
('ONE DUPLICATE','Lamgford Atrium Flute.wav is exactly identical to Langford Atrium Flute.wav; both are retained in inventory and counted as one unique flute reference.'),
('NAME MAPPING','Blocker Staircase Clap and Blocker Stairwell Flute were NOT joined. Physical equivalence is unknown. Both Blocker Stairwell and Zachry Long Hallway are flute-only references.'),
('ORIGINAL SIGNAL','All original sources are 48,000 Hz · mono · 24-bit PCM WAV, determined from header inspection.'),
('CLAP DETECTION','For each clap file: 20ms absolute-peak envelope; local maxima above 35% of global peak, with 25% prominence and at least 2.5s apart; keep the three largest.'),
('SEGMENTATION','Locate absolute waveform maximum around each envelope peak. Analyze up to 2.8 seconds after onset (8ms before peak).'),
('FILTERING','Broad band = 100–8000 Hz 3rd-order Butterworth bandpass. Octave bands = centers 125, 250, 500, 1000, 2000, 4000 Hz; edges = center/√2 and center×√2; 4th-order Butterworth.'),
('LOCAL NOISE FLOOR','Estimate 25th percentile of short-block pre-clap signal power from about 1.8–0.7s before each clap, separately by frequency band.'),
('NOISE-TRUNCATED TAIL','Response integration ends when 20ms energy (5-frame median-filtered) is sustained below +8dB above background; minimum 0.24s tail.'),
('SCHROEDER INTEGRATION','Compute EDC(t) = 10log10[Σ_{τ≥t} max(x(τ)^2 − estimated noise power,0) / Σ_{τ≥0} max(x(τ)^2 − estimated noise power,0)].'),
('T20','Fit a linear regression to EDC from −5 to −25dB. Extrapolate to −60dB using 60 / abs(fitted slope in dB/s). Require R² ≥ 0.84 and >45ms span.'),
('T30','Same as T20, using −5 to −35dB; missing when signal dynamic range or linear fit is insufficient.'),
('EDT','Approximate early decay time by extrapolating regression of −1 to −10dB to −60dB. A handclap has a finite source decay; this is not a certified EDT.'),
('C50','10log10(energy in 0–50ms / energy from 50ms to noise-truncated response end), noise-power compensated; source clap width affects the estimate.'),
('C80','10log10(energy in 0–80ms / energy from 80ms to noise-truncated response end); approximate music-clarity proxy.'),
('D50','100 × (energy within 50ms / energy within noise-truncated response). 0–100% by construction.'),
('REPLICATES','Use median of available measurements across three claps. Replicate CV = sample standard deviation / mean of valid broad T20 measurements.'),
('T20 MID-FREQUENCY','Median of valid 500Hz and 1000Hz octave T20 estimates; may be based on one band if the other is missing.'),
('FLUTE ACTIVE DETECTION','Split flute recordings into 100ms blocks. Active when RMS exceeds both 4×10th-percentile RMS and 10% of 90th-percentile RMS.'),
('FLUTE SPECTRAL FEATURES','100ms FFT with Hann window on every third active block, 100–8000Hz. Record median spectral centroid, 85% spectral rolloff, and dominant spectral peak.'),
('FLUTE INTERPRETATION','Dominant spectral peak is NOT necessarily fundamental pitch. Melody, technique, noise, and mic distance are uncontrolled. Flute clips are illustrative listening references.'),
('CONVOLUTION PROXIES','IR files are 2.2s cropped clap responses with noise gating, fade-out, 24kHz resampling, and energy normalization. A handclap is not a swept-sine deconvolved impulse response.'),
('SIGNAL CHAIN RISKS','Unknown phone automatic gain control, dynamic range compression, mic directionality, clap strength, position, occupancy, and background noise bias response metrics.'),
('CAVEAT ON “T60”','T20 and T30 are estimates of RT60 made by extrapolation, not full −60dB measured decay; there is no calibration or standards-conforming room-impulse measurement.'),
('WHAT TO COLLECT NEXT','For each room, add date/time, device+mic, source/mic positions, three onsets, room use, background noise, any nearby listeners, permission status, and ambient notes.'),
('HIGHER RIGOR OPTION','If time permits, use a known exponential sine sweep from a speaker, fixed mic/source position, repeat recordings, and deconvolve to obtain a better physical impulse response.'),
('SAFETY / PRIVACY','Before public release listen to raw clips for incidental identifiable speech. Do not publish consent-sensitive recordings or precise private-room details.'),
('USAGE','For a judge demo, pick a location, upload a short dry voice clip, hear the clap-derived convolution, switch locations, and inspect frequency-dependent decay bars.'),
]
s=sh('Methodology','METHODOLOGY  /  PROVENANCE  /  LIMITATIONS','Plain-language documentation; measurement labels are intentionally qualified to avoid overstating the method.', ['SECTION','DETAILS'],[32,145],[[a,b] for a,b in method],'MethodNotes')
s.get_range(f'B5:B{4+len(method)}').format.wrap_text=True;s.get_range(f'A5:B{4+len(method)}').format.row_height=40

# Collection log template: blanks intentional
logheads=['Site','Collection date','Local time','Recordist','Device / mic','Mic position','Clap position','Approx distance (m)','Presence / occupancy','Other noise / HVAC','Permission / consent checked','Notes / surfaces observed']
logrows=[[r['location']]+[None]*11 for r in rooms]+[['Blocker Stairwell (flute-only)']+[None]*11,['Zachry Long Hallway (flute-only)']+[None]*11]
s=sh('Field Notes To Fill','FIELD COLLECTION METADATA  /  NOT SUPPLIED','Complete these empty records from actual team notes. Do not invent collection time, phone model, room dimensions or sample locations.',logheads,[36,20,18,22,23,25,25,19,29,31,32,60],logrows,'FieldCollectionLog')
s.get_range(f'B5:L{4+len(logrows)}').format.fill='#FFF8E9'

# Data dictionary
fields=[
('Room Profiles','T20 500–1k (s)','Median of 500 Hz and 1000 Hz octave-band T20 estimates','seconds','null if no valid band'),
('Room Profiles','T20 broad (s)','Median across up to 3 clap events of 100–8000 Hz T20','seconds','null when fit fails'),
('Room Profiles','T30 broad (s)','Median T30 extrapolated from −5dB to −35dB slope','seconds','null when fit fails'),
('Room Profiles','EDT broad (s)','Early decay time based on −1 to −10dB slope','seconds','noise sensitive'),
('Room Profiles','C50 (dB)','Early 50ms versus remaining energy','dB','clap source affects estimate'),
('Room Profiles','C80 (dB)','Early 80ms versus remaining energy','dB','clap source affects estimate'),
('Room Profiles','D50 (%)','Fraction of first 50ms signal energy','percent','0 to 100'),
('Room Profiles','Pre-clap noise (dBFS)','Pre-event digital RMS noise-power estimate, not acoustic SPL','dBFS','relative to digital full scale'),
('Room Profiles','T20 replicate CV','Sample standard deviation / mean across valid broad T20 claps','unitless','greater than .30 triggers review'),
('Room Profiles','T20 fit R²','Median regression coefficient of determination for valid broad T20 fits','unitless','acceptance threshold 0.84'),
('Room Profiles','Quality review','Review if repeatability poor or fewer than 2 good T20 replicates','text','not a room-quality rating'),
('Octave Bands','Band (Hz)','Octave-band center; broad means 100–8000 Hz','Hz/text','125,250,500,1000,2000,4000'),
('Octave Bands','Valid T20 claps','Number of claps contributing a valid T20 estimate','count','0–3'),
('Individual Claps','Peak time (s)','Detected sample-peak time within original WAV','seconds','not measured arrival time'),
('Individual Claps','Peak (dBFS)','Digital sample magnitude relative to full scale','dBFS','NOT sound pressure level'),
('Individual Claps','Usable tail (s)','Noise-floor-determined analysis cutoff','seconds','limits backward integration'),
('Flute References','Active playing (s)','Sum of 100ms active windows','seconds','activity-heuristic dependent'),
('Flute References','Median centroid (Hz)','Median magnitude-weighted FFT center over active windows','Hz','not a room-only metric'),
('Flute References','85% rolloff (Hz)','Frequency below which 85% of FFT magnitude accumulates','Hz','dependent on melody and microphone'),
('Flute References','Median dominant peak (Hz)','Strongest Fourier component per analyzed active window','Hz','not calibrated fundamental'),
('File Audit','SHA256 checksum','Digest of exact bytes from user supplied WAV','hex','permits duplicate detection'),
('Decay Curve Data','Schroeder decay (dB)','Relative backward-integrated, floor-compensated energy decay','dB','curve truncated at noise threshold'),
('Field Notes To Fill','Approx distance (m)','Actual clap-source to recording microphone separation','meters','must be entered from field notes'),
('Compare Two Rooms','Room dropdown','Select two canonical clap locations for live Excel comparison','text','flute-only cannot be convolved'),
]
s=sh('Data Dictionary','DATA DICTIONARY  /  DEFINITIONS','All numeric measurements originate from user recordings; equations and limitations documented separately.', ['SOURCE SHEET','FIELD','DEFINITION','UNITS','NOTES'],[31,33,93,17,55],[[*a] for a in fields],'FieldDefinitions')
s.get_range(f'B5:E{len(fields)+4}').format.wrap_text=True;s.get_range(f'A5:E{len(fields)+4}').format.row_height=32

checks=[
('Collection and quality (20)','Original new campus WAV data','23 originals uploaded; 22 unique files; 3 claps per each of 13 clap sites','Add source mic/device, locations and field log details.'),
('Collection and quality (20)','Reliable data treatment','Octave-specific fit checks, exact duplicate detection, 3 repeats, noise-floor and R² flags','Repeat variable/problematic recordings if time allows.'),
('App and integration (20)','Real interaction','Browser can accept voice and convolve with a selected, measured clap-derived response','Show one dry clip in two different rooms.'),
('App and integration (20)','Central dataset role','All location options, IR assets, octave bars, and room comparisons depend on measured audio','Do not replace with synthetic impulse responses.'),
('Creativity and originality (20)','Question and contrast','How do real TAMU locations color and prolong the same voice?','Demonstrate opposite spaces.'),
('Usefulness and impact (20)','Potential audience','Speech, podcast, instrument, songwriting, and room-selection exploration','Explain limitations; no calibrated acoustics claim.'),
('Communication (20)','Video narrative','Field collection → three claps → fitting → speak and switch room → octave visualization','Use 60–90 seconds with side-by-side audio.'),
('Communication (20)','Repository','Raw primary dataset (subject to consent) + code + method + instructions + cleaned CSV + site demo','Check recording privacy before public release.'),
]
s=sh('Rubric Checklist','TAMU DATATHON  /  CHALLENGE CHECKLIST','Submission is an interactive app with original data as the engine, not an Excel-only static report.', ['CATEGORY','REQUIREMENT','CURRENT EVIDENCE','ACTION BEFORE SUBMITTING'],[36,38,94,94],[[*a] for a in checks],'RubricReadiness')
s.get_range(f'B5:D{len(checks)+4}').format.wrap_text=True;s.get_range(f'A5:D{len(checks)+4}').format.row_height=44

# workbook verification / export
for sheet_name,range_name in [('Dashboard','A7:R9'),('Room Profiles','A4:F7'),('Octave Bands','A4:F6'),('Compare Two Rooms','A9:C12')]:
 try:
  r=wb.inspect({'kind':'table','range':f"'{sheet_name}'!{range_name}",'include':'values,formulas','table_max_rows':7,'table_max_cols':8})
  print(sheet_name,r.ndjson[:1300])
 except Exception as e:print('INSPECT WARNING',sheet_name,str(e)[:200])
try:
 r=wb.inspect({'kind':'match','search_term':'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A','options':{'use_regex':True,'max_results':20}})
 print('ERROR SEARCH',r.ndjson[:1200])
except Exception as e:print('ERROR SCAN WARNING',str(e)[:300])
SpreadsheetFile.export_xlsx(wb).save(str(DEST))
print('EXPORTED',DEST,DEST.stat().st_size,'bytes')
