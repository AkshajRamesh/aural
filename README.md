# aural. — every space has a sound

**aural.** (always lowercase) is a browser-based acoustic project built for **TAMU Datathon 2026** from recordings the team made on the Texas A&M campus. You record or upload a short clip, choose two real campus spaces, and hear your clip through acoustic responses derived from handclaps recorded in those spaces. The site also lets you compare measured decay times across spaces and listen to real flute recordings made in them.

Created by **Aakash and Akshaj Ramesh**.

The source folder is still named `campus-echo/` (the project's earlier working name). Folder and asset paths were left unchanged so links keep working.

---

## 1. Project overview

| Part of the site | What it does |
| --- | --- |
| **Studio** | Record (up to 12 s used) or upload audio, choose spaces A and B, set the room effect, generate both results, compare them with linked A/B playback, and download each as WAV. |
| **Explore** | All 14 recorded places, sortable by decay time, with plain-language descriptions and one-click selection into the Studio. |
| **The Science** | Reverberation time for all 13 clap-measured spaces, decay by octave band, and Schroeder decay curves for the two selected spaces. |
| **Field recordings** | Nine real flute recordings captured in the spaces; leading/trailing silence is skipped during playback only. |
| **Methodology** | How the data was collected and analysed, and where the numbers stop being exact. |

Everything runs locally in the browser. There is no backend, no build step and no JavaScript dependency.

## 2. Research question

> How differently would the same voice sound in different places at Texas A&M?

## 3. Purpose and use cases

- **Students and the curious:** hear what reverberation does to speech, and see why a stairwell sounds different from a meeting room.
- **Singers, musicians and podcasters:** preview the general character of a campus space before going there.
- **Data storytelling:** connect primary field recordings to measurable acoustic quantities (T20, EDT, C50, D50) and to an audible result.

All outputs are estimates from handclaps; see [Limitations](#10-limitations). They are suitable for comparing these spaces with each other, not for certified acoustic design decisions.

## 4. Data collection

All recordings were made by the team on **November 7, 2026**, in real locations across Texas A&M University's campus. Full procedure: `COLLECTION-METHODOLOGY.md`; per-location notes: `dataset/field-notes-template.csv`; file inventory: `dataset/processed/recording-catalog.csv`.

| Item | Value |
| --- | --- |
| Device | Apple iPhone, built-in microphone (no external microphone) |
| Recording app | Shure MOTIV |
| Format | Uncompressed PCM WAV, 48,000 Hz, 24-bit, mono |
| Placement | Phone stationary on a stand, sound source approximately 5 ft (1.5 m) away |
| Consistency | Position kept approximately consistent across locations; same recording settings throughout |

- **23 WAV recordings** in `dataset/raw/` (format confirmed from the file headers).
- **13 clap recordings**, one per location, each containing three handclaps (39 claps in total, all detected by the analysis).
- **10 flute recordings**, played at selected locations with approximately the same setup, of which **9 are unique**: `Lamgford Atrium Flute.wav` and `Langford Atrium Flute.wav` are byte-for-byte identical, so they are counted once.
- **14 physical locations in total**: 13 with claps, plus **Zachry Long Hallway**, which has a flute recording only.
- **Blocker Staircase** (clap) and **Blocker Stairwell** (flute) are the **same physical stairwell**, confirmed by the team. They are two separate samples of one place and keep their original file names, location IDs (`blocker-staircase`, `blocker-stairwell`) and measurements; nothing is merged or averaged. The data files therefore contain 15 location entries for 14 places, and the site lists the place once.

**Metadata that was not recorded** (marked "Not recorded" or "Unknown" in the field notes, never estimated): time of each recording, recordist per recording, specific iPhone model, input gain, whether automatic gain control or other internal processing was active, exact phone and source coordinates and heights, room dimensions, occupancy, HVAC/background conditions and permissions. Using the same settings throughout does not mean automatic gain control was disabled.

## 5. Datasets

| Path | Contents |
| --- | --- |
| `dataset/processed/recording-catalog.csv` | Inventory of the 23 original WAVs: duration, sample rate, channels, peak/RMS level, SHA-256, duplicate flag. |
| `dataset/processed/locations.csv` / `locations.json` | One row per clap-measured location: T20, T30, EDT, C50, C80, D50, noise floor, clap-to-clap variation, quality flag. |
| `dataset/processed/individual-claps.csv` | Per-clap measurements (39 rows). |
| `dataset/processed/octave-bands.csv` | Per-location results in the 125–4000 Hz octave bands. Blank means no reliable fit, never zero. |
| `dataset/processed/decay-curves.csv` | Schroeder energy-decay curves (median across claps) per location and band. |
| `dataset/processed/flute-features.csv` | Flute descriptors: active time, spectral centroid, roll-off, dominant peak. |
| `dataset/campus-acoustics-analysis.xlsx` | Workbook with the same data, a data dictionary and comparison charts. |
| `dataset/field-notes-template.csv` | Per-location collection notes: date, device, app, format, placement, files, and which details were not recorded. |
| `app/data/locations.json`, `app/data/decay-curves.json` | The site's copy of the processed data. |
| `app/data/ir/*.wav` | 13 clap-derived room responses (24 kHz, mono, 16-bit, 2.2 s) used for convolution. |
| `app/data/flute/*.mp3` | 9 flute recordings re-encoded for the web (24 kHz mono MP3, full length). |

> **Original recordings:** the 23 original WAVs are in `dataset/raw/`, and their SHA-256 hashes match `recording-catalog.csv`. The intermediate folders `dataset/processed/ir/` and `dataset/processed/reference-flute/` are not stored in the project; the analysis script recreates them (see [Reproduction](#12-reproduction)).

## 6. Acoustic methodology

For each clap (details in `COLLECTION-METHODOLOGY.md` and `scripts/analyze-acoustics.py`):

1. Locate the three strongest, well-separated claps in each recording.
2. Crop each response from 8 ms before the peak.
3. Filter into a broad band (100–8000 Hz) and six octave bands (125, 250, 500, 1000, 2000, 4000 Hz).
4. Estimate the background-noise power from 1.8–0.7 s before the clap, subtract it, and cut the response where it falls back into the noise.
5. Integrate the squared response backwards (**Schroeder backward integration**) to get a smooth energy-decay curve.
6. Fit straight lines to that curve:
   - **T20**: −5 to −25 dB, extrapolated to a 60 dB decay.
   - **T30**: −5 to −35 dB, where the response allows it.
   - **EDT**: −1 to −10 dB. ISO 3382 uses 0 to −10 dB; this is a deliberate, documented deviation.
   - Fits with R² below 0.84, too few points or too short a span are rejected and left blank.
7. **C50 / C80 / D50**: early-to-late energy ratios at 50 and 80 ms.
8. Report the **median** of valid claps per location, plus the clap-to-clap coefficient of variation (above 30% is flagged as approximate).

The headline "decay time" shown in the site is `t20_500_1000_s`, the median (equal to the mean, with two values) of the 500 Hz and 1000 Hz band T20 values, where most speech energy sits.

## 7. Convolution methodology

1. **Room responses.** For each location, the clap with the best valid fit is cropped to 2.2 s, softly noise-gated, faded out, resampled to 24 kHz and energy-normalised. These are clap-derived *approximations* of an impulse response.
2. **Your clip.** The clip is decoded by the browser and mixed to mono. **Leading and trailing silence is trimmed** using a short-time energy detector with an adaptive noise floor: pauses inside the clip are never removed, quiet speech is kept, 150 ms is kept before the first sound and 200 ms after the last, and short fades prevent clicks. A clip with no meaningful sound is rejected with an explanation. At most 12 seconds of the trimmed clip are used. The same trimmed clip feeds both A and B.
3. **Sample rate.** Rendering happens at the clip's decoded sample rate (usually 44.1 or 48 kHz). Each room response is decoded and resampled to that same rate before it reaches the `ConvolverNode`, so pitch and duration are preserved.
4. **Mixing.** The convolver runs with `normalize = false`. The room-effect slider crossfades between the dry clip and the convolved signal.
5. **Reverb tail.** Each output is the trimmed clip length + 2.2 s + 0.1 s long, so the room's full decay after your last sound is kept. Trimming happens only on the dry input, never on the result.
6. **Level.** A and B receive one shared gain (peak ceiling −1 dBFS, at most +12 dB make-up), which prevents clipping while preserving the loudness difference between the rooms.
7. **Export.** Downloads are 16-bit PCM WAV named `aural-<a|b>-<location>-<effect>pct.wav`.

**Field-recording playback** uses the same trimming utility with a flute-specific profile. The stored MP3 is fetched, decoded and trimmed **in memory**, then played from a temporary Blob URL that is released when another recording starts. No audio file on disk is modified, overwritten or replaced.

## 8. Features

- Microphone recording with a live level meter, automatic stop at 12 s, and clear permission or device error messages.
- Upload or drag-and-drop of WAV, MP3, M4A or anything else the browser can decode.
- Automatic leading/trailing silence trimming, with the waveform, duration and status message updated to match.
- Two-space A/B rendering with linked playback position, waveform display, stale-result warnings when settings change, and WAV download.
- Side-by-side measured properties (T20, EDT, C50, D50) with plain-language explanations.
- Location explorer with sorting, quality flags for inconsistent clap sets, and building names derived from location names.
- Three charts: reverberation time, decay by frequency, and decay curve with the T20 fit range shaded.
- Field-recording players with play, pause, seek, keyboard control and in-memory silence skipping.
- Responsive layout from phone to wide desktop, keyboard navigation and visible focus states.

## 9. Local setup

No API keys, build tools or JavaScript dependencies are needed. On Windows, open PowerShell in the folder containing this README:

```powershell
py -m http.server 8000
```

Then open **http://localhost:8000/app/**. Opening `index.html` directly from disk does not work, because browsers block `fetch` from `file://`. The microphone needs `localhost` or HTTPS.

**Publishing (for example on GitHub Pages):** serve the repository root so that `app/` is the site path. The Methodology section links to `../README.md`, `../COLLECTION-METHODOLOGY.md` and files under `../dataset/`, so publish those too.

## 10. Limitations

- **A handclap is not a calibrated impulse response.** It has its own spectrum and duration, radiates unevenly, and was captured with a phone's built-in microphone, which is not a calibrated measurement microphone and may apply automatic gain or limiting (not verified either way). The `app/data/ir/*.wav` files are noise-gated clap responses, not sweep-deconvolved impulse responses.
- **Estimates, not ISO 3382 measurements.** T20, T30, EDT, C50, C80 and D50 are exploratory. The phone stood on a stand about 5 ft from the source in an approximately consistent arrangement, but positions were not measured, and only one phone position per space was recorded.
- **Repeatability varies.** Langford Atrium's three claps disagree by 44% (coefficient of variation). The site flags every location above 30%.
- **The simulation is an approximation.** It conveys a space's character; it does not reproduce exactly how your voice would sound there.
- **Flute recordings are not standardised.** The setup was approximately the same as for the claps, but melody, dynamics and take length were not controlled, so flute descriptors are not room measurements.
- **Incomplete collection metadata.** Times, iPhone model, gain, automatic-gain state, exact positions, room dimensions and conditions were not recorded. See [Data collection](#4-data-collection).
- **Bit depth is hardcoded in the script.** `scripts/analyze-acoustics.py` writes `bits_per_sample = 24` as a constant rather than reading it from each file. The value happens to be correct: all 23 file headers confirm 24-bit PCM.
- **Minor documentation notes.** The decay-curve comment in the analysis script says "average energy", but the code takes the median of the dB curves across claps (the CSV and charts show that median). The noise window used to gate the web room responses is 1.7–0.7 s before the clap, slightly different from the 1.8–0.7 s window used for the measurements. Neither affects the published measurements.
- **Privacy.** Several flute recordings contain long non-playing stretches (by the dataset's own activity measure, roughly 9–35% of each file is flute playing). Before publishing the originals or the MP3s, listen for background conversation or identifiable voices, and remove or obtain consent where needed. Playback trimming skips some of this audio but does not delete it from the files.

## 11. Team credits

- **Aakash Ramesh**
- **Akshaj Ramesh**

Recordings, analysis and website by the team for **TAMU Datathon 2026**. Typefaces: Fraunces, IBM Plex Sans and IBM Plex Mono (Google Fonts, SIL Open Font License).

## 12. Reproduction

The processed outputs and site assets are already included; nothing needs to be recomputed to run the site.

### Verification status

The analysis was independently reproduced from all 23 original WAV recordings in `dataset/raw/` (whose SHA-256 hashes match `dataset/processed/recording-catalog.csv`), in a separate copy of the project with a fresh virtual environment:

- **Counts:** 23 files, 13 clap locations, 39 claps, 9 unique flute references (the duplicate Langford file flagged), 15 location entries in the site catalogue (14 physical places; see [Data collection](#4-data-collection)).
- **Measurements:** every value in the six processed CSVs and the three JSON files agrees with the published data within floating-point precision. `recording-catalog.csv`, `decay-curves.csv` and `app/data/decay-curves.json` were byte-identical; the other files differed only in the last few digits (largest relative difference 2 × 10⁻¹¹).
- **Room responses:** all 13 `app/data/ir/*.wav` files reproduced byte-for-byte.
- **Flute previews:** all 9 `app/data/flute/*.mp3` files reproduced acoustically: identical duration, sample rate, peak and RMS level, correlation 1.000000 and no time offset. The difference between the decoded files was more than 327 dB below the signal. Their compressed-file hashes differ, which is normal for re-encoded MP3s.

**Expected, harmless differences.** A reproduction can show two kinds of difference that do not change any reported result:

- **Floating-point rounding.** Different library builds or CPUs can change the last one or two digits of full-precision values in the CSVs (for example `1.228938106683833` versus `1.2289381066838325`). The site data rounds to 5 decimal places, and every displayed value is identical.
- **Line endings.** On Windows, the JSON files are written with CRLF line endings, while the published copies use LF. The parsed content is identical.

### Verified environment

| Component | Version |
| --- | --- |
| Python | 3.14.7 (64-bit, Windows) |
| numpy | 2.5.4 |
| scipy | 1.18.1 |
| soundfile | 0.14.0 (bundled libsndfile 1.2.2) |
| cffi / pycparser / typing_extensions | 2.1.1 / 3.12 / 4.16.0 |
| imageio-ffmpeg | 0.8.1 (provides FFmpeg 9.0.2, gyan.dev essentials build) |

These are pinned in `requirements-lock.txt`. `requirements.txt` lists only the minimum versions.

### Reproduce safely in a separate directory

Both scripts write next to themselves: `analyze-acoustics.py` **deletes and rewrites** `dataset/processed/` (CSVs, `locations.json`, `ir/`, `reference-flute/`), and `export-app-data.py` **deletes and rewrites** `app/data/ir/`, `app/data/flute/` and the site JSON. To keep the verified dataset intact, run them in a copy of the project, never in the original folder.

From PowerShell, in the folder containing this README:

```powershell
# 1. Copy the project somewhere else and work only in the copy
$repro = "$env:TEMP\aural-repro\campus-echo"
robocopy . $repro /E /XD .venv
Set-Location $repro

# 2. Create an isolated virtual environment and install the pinned versions
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-lock.txt

# 3. Make FFmpeg available for this PowerShell session only (no global install)
$ff = .\.venv\Scripts\python.exe -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"
New-Item -ItemType Directory -Force .\.ffmpeg-bin | Out-Null
Copy-Item $ff .\.ffmpeg-bin\ffmpeg.exe
$env:PATH = "$PWD\.ffmpeg-bin;$env:PATH"

# 4. Reproduce the analysis from dataset/raw/, then rebuild the site assets
.\.venv\Scripts\python.exe scripts\analyze-acoustics.py
.\.venv\Scripts\python.exe scripts\export-app-data.py
```

Notes:

- `dataset/raw/` must contain the 23 original WAVs with their original names. Check them against the SHA-256 column of `dataset/processed/recording-catalog.csv` first.
- The PATH change in step 3 lasts only for that PowerShell window. `imageio-ffmpeg` keeps its FFmpeg binary inside the virtual environment; the copy is needed because `export-app-data.py` calls the command `ffmpeg` by name.
- FFmpeg is needed only for the export step (flute MP3s). The analysis step itself needs only numpy, scipy and soundfile.
- After running, compare the copy's `dataset/processed/` and `app/data/` with the original folder's. Compare values numerically, and compare MP3s by decoded audio rather than file hashes.
- The workbook script (`scripts/build-workbook.py`) uses `artifact_tool`, which most Python setups do not have; the built `.xlsx` is already included and was not part of the verification.

---

## File layout

```text
app/
  index.html               Studio, Explore, The Science, Field recordings, Methodology
  styles.css               Design tokens and responsive layout
  app.js                   Silence trimming, Web Audio convolution, recording/upload,
                           A/B playback, WAV export, field-recording playback, charts
  data/locations.json      15 location entries for 14 places (13 with room responses)
  data/decay-curves.json   Broadband decay curves for the charts
  data/ir/*.wav            13 clap-derived room responses
  data/flute/*.mp3         9 flute recordings (web copies)
dataset/
  raw/*.wav                23 original recordings (48 kHz, mono, 24-bit PCM)
  processed/*.csv          Locations, claps, octave bands, decay curves, flute features, file inventory
  processed/locations.json Processed location data
  campus-acoustics-analysis.xlsx  Workbook and comparison charts
  field-notes-template.csv Per-location collection notes
scripts/
  analyze-acoustics.py     Acoustic feature extraction (needs dataset/raw/)
  export-app-data.py       Rebuild site assets from processed outputs
  build-workbook.py        Workbook build recipe (artifact_tool)
COLLECTION-METHODOLOGY.md  Methods, known unknowns, privacy notes
DEMO-VIDEO-OUTLINE.md      Plan for the demo video (the video itself is not included)
requirements.txt           Minimum Python package versions
requirements-lock.txt      Exact versions used for the verified reproduction
```

## TAMU Datathon 2026 submission checklist

- [ ] **App:** publish `app/` (for example via GitHub Pages) or record a demo on localhost. See `DEMO-VIDEO-OUTLINE.md`.
- [ ] **Original data:** decide whether to publish the 23 original WAVs in `dataset/raw/`. If so, first review them for private conversations (see [Limitations](#10-limitations)).
- [x] **Collection metadata:** `dataset/field-notes-template.csv` documents the verified collection details; unrecorded items are marked as such. WAV headers and ZIP dates are not used as evidence of when recordings were made.
- [ ] **Methods:** share this README, `COLLECTION-METHODOLOGY.md` and the scripts.
- [ ] **Presentation:** the clearest contrast is **Zachry Stairwell (T20 ≈ 3.38 s)** versus **Zachry Collaboration Room (T20 ≈ 0.39 s)**. Say plainly that these are handclap estimates.

**The originality lies in the primary data collection and the real acoustic measurements, not only in the browser effects.**
