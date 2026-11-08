# Reproducing the aural. dataset

The processed outputs and site assets are already included in this repository; nothing needs to be recomputed to run the site. This document describes how the analysis was verified and how to reproduce it from the original recordings. Collection and analysis methods are in [COLLECTION-METHODOLOGY.md](COLLECTION-METHODOLOGY.md). The live site is at [https://akshajramesh.github.io/aural/](https://akshajramesh.github.io/aural/).

## Verification status

The analysis was independently reproduced from all 23 original WAV recordings in `dataset/raw/` (whose SHA-256 hashes match `dataset/processed/recording-catalog.csv`), in a separate copy of the project with a fresh virtual environment:

- **Counts:** 23 files, 13 clap locations, 39 claps, 9 unique flute references (the duplicate Langford file flagged), and 15 location entries in the site catalogue. The 15 entries describe 14 physical places, because Blocker Staircase (clap) and Blocker Stairwell (flute) are the same stairwell.
- **Measurements:** every value in the six processed CSVs and the three JSON files agrees with the published data within floating-point precision. `recording-catalog.csv`, `decay-curves.csv` and `app/data/decay-curves.json` were byte-identical; the other files differed only in the last few digits (largest relative difference 2 × 10⁻¹¹).
- **Room responses:** all 13 `app/data/ir/*.wav` files reproduced byte-for-byte.
- **Flute previews:** all 9 `app/data/flute/*.mp3` files reproduced acoustically: identical duration, sample rate, peak and RMS level, correlation 1.000000 and no time offset. The difference between the decoded files was more than 327 dB below the signal. Their compressed-file hashes differ, which is normal for re-encoded MP3s.

**Expected, harmless differences.** A reproduction can show two kinds of difference that do not change any reported result:

- **Floating-point rounding.** Different library builds or CPUs can change the last one or two digits of full-precision values in the CSVs (for example `1.228938106683833` versus `1.2289381066838325`). The site data rounds to 5 decimal places, and every displayed value is identical.
- **Line endings.** On Windows, the JSON files are written with CRLF line endings, while the published copies use LF. The parsed content is identical.

## Verified environment

| Component | Version |
| --- | --- |
| Python | 3.14.7 (64-bit, Windows) |
| numpy | 2.5.4 |
| scipy | 1.18.1 |
| soundfile | 0.14.0 (bundled libsndfile 1.2.2) |
| cffi / pycparser / typing_extensions | 2.1.1 / 3.12 / 4.16.0 |
| imageio-ffmpeg | 0.8.1 (provides FFmpeg 9.0.2, gyan.dev essentials build) |

These are pinned in `requirements-lock.txt`. `requirements.txt` lists only the minimum versions.

## Reproduce safely in a separate directory

> **Warning:** both scripts write next to themselves. `analyze-acoustics.py` **deletes and rewrites** `dataset/processed/` (CSVs, `locations.json`, `ir/`, `reference-flute/`), and `export-app-data.py` **deletes and rewrites** `app/data/ir/`, `app/data/flute/` and the site JSON. To keep the verified dataset intact, run them in a copy of the project, never in the original folder.

From PowerShell, in the repository root:

```powershell
# 1. Copy the project somewhere else and work only in the copy
$repro = "$env:TEMP\aural-repro\aural"
robocopy . $repro /E /XD .venv .git
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
- The intermediate folders `dataset/processed/ir/` and `dataset/processed/reference-flute/` are not stored in the repository; the analysis script recreates them.
- The workbook script (`scripts/build-workbook.py`) uses `artifact_tool`, which most Python setups do not have; the built `.xlsx` is already included and was not part of the verification.

## Data files

| Path | Contents |
| --- | --- |
| `dataset/raw/*.wav` | The 23 original recordings (48 kHz, 24-bit, mono PCM). |
| `dataset/processed/recording-catalog.csv` | Inventory of the 23 original WAVs: duration, sample rate, channels, peak/RMS level, SHA-256, duplicate flag. |
| `dataset/processed/locations.csv` / `locations.json` | One row per clap-measured location: T20, T30, EDT, C50, C80, D50, noise floor, clap-to-clap variation, quality flag. |
| `dataset/processed/individual-claps.csv` | Per-clap measurements (39 rows). |
| `dataset/processed/octave-bands.csv` | Per-location results in the 125–4000 Hz octave bands. Blank means no reliable fit, never zero. |
| `dataset/processed/decay-curves.csv` | Schroeder energy-decay curves (median across claps) per location and band. |
| `dataset/processed/flute-features.csv` | Flute descriptors: active time, spectral centroid, roll-off, dominant peak. |
| `dataset/campus-acoustics-analysis.xlsx` | Workbook with the same data, a data dictionary and comparison charts. |
| `dataset/field-notes-template.csv` | Per-location collection notes, including which details were not recorded. |
| `app/data/locations.json`, `app/data/decay-curves.json` | The site's copy of the processed data (15 location entries for 14 places, 13 with room responses). |
| `app/data/ir/*.wav` | 13 clap-derived room responses (24 kHz, mono, 16-bit, 2.2 s) used for convolution. |
| `app/data/flute/*.mp3` | 9 flute recordings re-encoded for the web (24 kHz mono MP3, full length). |

## Known script-level notes

None of these affects the published measurements.

- **Bit depth is hardcoded.** `scripts/analyze-acoustics.py` writes `bits_per_sample = 24` as a constant rather than reading it from each file. The value is correct: all 23 file headers confirm 24-bit PCM.
- **Decay-curve comment.** The comment in the analysis script says "average energy", but the code takes the median of the dB curves across claps; the CSV and charts show that median.
- **Gating window.** The noise window used to gate the web room responses is 1.7–0.7 s before the clap, slightly different from the 1.8–0.7 s window used for the measurements.
