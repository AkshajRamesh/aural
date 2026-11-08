# Collection provenance, analysis and known limitations

This document describes how the recordings behind **aural.** (TAMU Datathon 2026) were collected and analysed, and what the resulting numbers can and cannot support. Per-location details are in `dataset/field-notes-template.csv`; the file inventory with SHA-256 checksums is `dataset/processed/recording-catalog.csv`.

## 1. Purpose

The project asks how differently the same voice would sound in different places at Texas A&M. To answer it with primary data rather than published room values, the team recorded short acoustic events in real campus spaces: handclaps, from which room decay and early-energy estimates are derived and which provide the convolution responses used in the site's Studio, and flute playing, as a musical listening reference recorded in the same spaces.

## 2. Recording equipment and application

| Item | Value |
| --- | --- |
| Device | Apple iPhone (specific model not recorded) |
| Microphone | Built-in iPhone microphone; no external microphone was used |
| Recording application | Shure MOTIV |
| Placement | Phone stationary on a stand |

## 3. Collection date and locations

- **Date:** November 7, 2026. Times of day for individual recordings were not recorded. WAV header contents and file or ZIP modification times are not used as evidence of when recordings were made.
- **Setting:** real, in-use locations across the Texas A&M University campus.
- **Locations:** 14 physical locations. 13 have a clap recording; 9 have a flute recording; Zachry Long Hallway has a flute recording only.
- **Blocker Staircase** (clap) and **Blocker Stairwell** (flute) are the same physical stairwell, as confirmed by the team. They are two separate acoustic samples of one place. Each keeps its original file name, location ID and measurements, and they are never merged or averaged. The processed data therefore has 15 location entries for 14 places.
- Building names shown in the site are derived from the location names; "Control Room" and "Control Bathroom" have no building recorded.

## 4. Handclap procedure

At each of the 13 clap locations, three handclaps were recorded in a single WAV file with the phone on its stand and the person clapping approximately 5 feet (1.5 m) from the phone. The analysis independently detects the three prominent transients in each file (39 claps in total).

## 5. Flute procedure

A flute was played at selected locations using approximately the same recording setup (phone on its stand, source approximately 5 feet away). This produced 10 flute files: `Lamgford Atrium Flute.wav` is a byte-for-byte copy of `Langford Atrium Flute.wav`, so there are **9 unique flute recordings**. The duplicate is kept in `dataset/raw/` for provenance but is never counted as an independent observation. Melody, dynamics and the length of each take were not standardised.

## 6. Recording format

All 23 source files are **uncompressed PCM WAV, 48,000 Hz, 24-bit, mono**. This was confirmed by reading every file header, and the files' SHA-256 checksums match `recording-catalog.csv`.

| Count | Files |
| --- | --- |
| 23 | WAV files in `dataset/raw/` |
| 13 | Clap recordings (one per clap location, three claps each) |
| 10 | Flute files, of which 9 are unique (one byte-identical duplicate) |
| 22 | Unique recordings (13 clap + 9 flute) |
| 14 | Physical locations (13 clap locations + Zachry Long Hallway; Blocker Staircase and Blocker Stairwell are one place) |

## 7. Consistency of placement and settings

- The phone stayed **stationary on a stand** during each recording, and sound sources were approximately **5 feet (1.5 m)** away.
- The recording position relative to the source was kept **approximately consistent** across locations. Exact phone and source coordinates, heights and orientations were not measured.
- The **same recording settings** were used throughout the collection. This means the app configuration was not changed between recordings. It does **not** establish that automatic gain control, limiting, noise reduction or other internal processing by iOS or the app was disabled; whether any of these were active, and the exact input gain, were not recorded. All clap recordings peak between −0.64 and −0.85 dBFS with no sample at full scale, which is consistent with, but does not prove, a limiter or automatic gain stage.

## 8. Acoustic analysis methodology

Implemented in `scripts/analyze-acoustics.py`:

1. **Identify claps.** Measure absolute sample maxima per 20-ms block and use a conservative peak-height/prominence threshold with ≥2.5-s spacing. Select the three strongest temporally separated events per clap recording. Refine each event by locating the actual waveform sample peak within a short time window.
2. **Crop.** Extract a response segment beginning 8 ms before each transient peak and lasting up to 2.8 s.
3. **Filter.** Broad band: 100–8000 Hz, third-order Butterworth bandpass. Octave bands: nominal centers of 125, 250, 500, 1000, 2000 and 4000 Hz, with endpoints center/√2 and center×√2, fourth-order Butterworth bandpass. No zero-phase filtering is claimed.
4. **Estimate background.** Use pre-clap audio from about 1.8–0.7 seconds prior to the event. Compute the 25th-percentile 50-ms block power per band as an estimate of ambient floor. Background noise is measured in digital relative units, not calibrated SPL.
5. **Tail selection.** Find the first time after 150 ms at which median-filtered 20-ms energy is below +8 dB relative to the pre-clap noise threshold for five of six neighboring frames. Require a minimum tail length of 240 ms.
6. **Backward integrate.** For each response, subtract approximate ambient power from instantaneous squared amplitude, clamp to nonnegative, integrate from the end backward (Schroeder method), and convert to relative dB.
7. **Regression.** Fit the EDC between −5 and −25 dB for T20 and between −5 and −35 dB for T30. Estimate T60-equivalent decay by `60 / abs(slope_dB_per_s)`. Reject regressions with R² below .84, positive/weak slope, too few samples, or less than 45 ms fitted span. EDT uses −1 to −10 dB (ISO 3382 uses 0 to −10 dB). Median of valid claps is reported, not mean.
8. **Early energy.** Calculate source- and noise-dependent proxies C50, C80 and D50 using energy integrated before/after 50 and 80 ms until the selected response-tail cutoff.
9. **Repeatability.** Compute coefficient of variation for valid broad T20 values; flag poor agreement (>30%) or fewer than two valid T20 estimates for review.
10. **Flute features.** Detect active 100-ms windows above both a noise-relative and activity-relative threshold. Analyze magnitude FFT of every third active window, with a Hann window, and report medians of spectral centroid, spectral rolloff and strongest peak frequency. These are descriptive and not controlled between musical takes.
11. **Web convolution assets.** Choose a clap response with a supported fit, crop up to 2.2 s, soft-gate local noise (using a 1.7–0.7 s pre-clap window), fade the tail, resample to 24 kHz and normalize energy. It is suitable for an acoustic *effect proxy*, not as an independent calibrated IR.

### Terms and interpretations

- T20/T30: decay-time extrapolations using only a 20/30 dB range. They are **not observed -60 dB decays**.
- Higher C50 typically means more signal energy within the first 50 ms relative to later energy for *this specific recorded transient*; source shape can change it.
- “More reverberant” in the app refers to longer measured decay proxy, not a certified material or architectural property.
- Absence of a valid band fit is represented by a blank; never infer a value of zero.
- Flute performance descriptors are not a valid independent estimate of acoustic response without controlling notes, playing, instrument and recording level.

## 9. Data quality limitations

- **Estimates, not calibrated measurements.** All values are derived from handclaps recorded on a phone. A handclap is not a calibrated impulse source: it has its own spectrum and duration, radiates unevenly, and varies from clap to clap. The phone microphone is not a calibrated measurement microphone. Results are exploratory estimates suitable for comparing these spaces with each other, not laboratory or ISO 3382 measurements, and ISO 3382 requirements are not claimed.
- **Single position per space.** One phone position and one source position were used per location, at approximately 5 feet; room-averaged values would need several positions.
- **Possible internal processing.** Unknown automatic gain control, limiting or noise reduction may affect levels, decay shape and early-energy ratios (see section 7).
- **Uncontrolled conditions.** Occupancy, HVAC and other background noise, and background speech were not recorded and may bias results. Exact source and phone positions, heights and orientations, and room dimensions were not measured.
- **Repeatability.** Langford Atrium's three claps disagree by 44% (coefficient of variation); every location above 30% is flagged in the data and in the site.
- **Flute takes are not standardised** in melody, dynamics or duration, and most of each flute file is not flute playing.

A correct measured impulse response would generally use a known excitation (for example a swept sine with deconvolution) and controlled geometry.

## 10. Dataset reproducibility

The full analysis was independently reproduced from the 23 original WAV files in a separate copy of the project with a fresh virtual environment. It again produced 13 clap locations, 39 claps and 9 unique flute references. All measurements agreed with the published data within floating-point precision; the 13 web room-response WAVs reproduced byte-for-byte; and the 9 flute MP3 previews reproduced acoustically (identical decoded audio) despite different compressed-file hashes. Exact steps, pinned dependency versions (`requirements-lock.txt`) and the safe separate-directory procedure are in the README, section 12.

## Safety and publication

Before publishing original WAV files, audit them for recognizable speech or private conversations. Record and document any required permission. Keep the raw originals if safe, or publish consent-cleared snippets and retain provenance privately if needed. No original recording was fabricated, synthesized or relabeled as another physical location.

## Suggested next collection round

At each space, additionally note the exact time, the iPhone model, the app's input gain and processing settings (including whether automatic gain control was active), phone and source heights and positions, room dimensions, occupancy, HVAC/background condition, number of takes, and whether recording was permitted. Repeat a controlled sweep if possible. Enter only actually observed values.
