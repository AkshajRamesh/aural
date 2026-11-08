# aural.

**aural.** lets you hear an approximation of how your voice would sound in real Texas A&M campus locations. Record or upload a short clip, choose two spaces, and the site plays it through acoustic responses derived from handclaps the team recorded on campus

**Live Website:** [https://akshajramesh.github.io/aural/](https://akshajramesh.github.io/aural/)

**Source Code:** [https://github.com/AkshajRamesh/aural](https://github.com/AkshajRamesh/aural)

Built for TAMU Datathon 2026. The application is static HTML, CSS and JavaScript: no backend, no API keys.

## What It Does

1. Record or upload a voice clip.
2. Select two Texas A&M campus locations.
3. Generate an acoustic simulation for each location.
4. Listen, compare, and explore the measured differences.

The same site charts estimated decay times across the recorded spaces and plays original flute field recordings made in them. All processing happens in the browser; nothing you record is uploaded.

## The Dataset

On November 7, 2026, the team recorded real locations across the Texas A&M campus. Recordings used an Apple iPhone’s built-in microphone and the Shure MOTIV app. The phone sat on a stand about five feet (1.5 m) from the sound source. Placement and recording settings were kept approximately consistent across locations. Format: uncompressed PCM WAV, 48 kHz, 24-bit, mono.

| Count | Value |
| --- | --- |
| Physical locations | 14 |
| Clap-measured locations | 13 |
| Individual handclaps | 39 (three per clap recording) |
| Unique flute recordings | 9 |
| Original WAV files | 23, including one duplicate flute file |
| Internal location entries | 15 |

Blocker Staircase (clap) and Blocker Stairwell (flute) are the same stairwell, stored as two separately named samples. That is why the data files have 15 location entries for 14 places.

Full procedure: [COLLECTION-METHODOLOGY.md](COLLECTION-METHODOLOGY.md). Per-location notes: [dataset/field-notes-template.csv](dataset/field-notes-template.csv). File inventory and SHA-256 checksums: [dataset/processed/recording-catalog.csv](dataset/processed/recording-catalog.csv).

## How It Works

From each clap recording the analysis locates the three strongest claps, filters them into a broad band and six octave bands, and estimates decay with Schroeder backward integration. Straight-line fits to the decay curve give T20 (−5 to −25 dB) and T30 (−5 to −35 dB); the median of valid claps is reported. Frequency-dependent results are stored per octave band from 125 Hz to 4000 Hz, along with early-to-late energy ratios (C50, C80, D50). A 2.2-second clap-derived room response is then extracted for each clap-measured space.

In the browser, a user’s clip is convolved with two of those responses so the same voice can be compared in two real campus spaces. These are exploratory estimates, not ISO 3382 measurements. Details: [COLLECTION-METHODOLOGY.md](COLLECTION-METHODOLOGY.md).

## Run Locally

From the repository root in PowerShell:

```powershell
py -m http.server 8000
```

Then open [http://localhost:8000/app/](http://localhost:8000/app/). Opening `index.html` from disk does not work, because browsers block `fetch` from `file://`. Recording needs localhost or HTTPS. The public website is this same `app/` folder.

## Data and Reproducibility

The original recordings and processed measurements are published in this repository.

| Resource | Location |
| --- | --- |
| Original WAV recordings | [`dataset/raw/`](dataset/raw/) |
| Processed measurements | [`dataset/processed/`](dataset/processed/) |
| Excel workbook | [`dataset/campus-acoustics-analysis.xlsx`](dataset/campus-acoustics-analysis.xlsx) |
| Analysis scripts | [`scripts/`](scripts/) |
| Collection methodology | [`COLLECTION-METHODOLOGY.md`](COLLECTION-METHODOLOGY.md) |
| Reproduction procedure | [`REPRODUCIBILITY.md`](REPRODUCIBILITY.md) |

The analysis was successfully reproduced from all 23 original recordings. The acoustic measurements matched within floating-point precision, and all 13 processed room-response WAV files reproduced byte-for-byte. Full commands, pinned versions and overwrite warnings: [REPRODUCIBILITY.md](REPRODUCIBILITY.md).

## Limitations

- A handclap is not a calibrated impulse source. The 2.2-second room responses derived from it are approximations, not sweep-deconvolved impulse responses.
- The iPhone microphone is not a measurement microphone, and automatic gain or other internal processing may have been active.
- Positions were kept approximately consistent but not measured. Occupancy, HVAC and other conditions were not recorded, and only one position was used per space.
- The simulated audio conveys a space’s acoustic character. It does not reproduce exactly how a voice would sound there.

## Team

**Created by Aakash and Akshaj Ramesh**
