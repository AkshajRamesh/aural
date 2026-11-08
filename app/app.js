/* aural. — browser-only Web Audio convolution of handclap-derived room responses.
 * Every acoustic value shown comes from the team's campus recordings
 * (data/locations.json, data/decay-curves.json). Filtered handclaps are
 * PROXIES for impulse responses, not calibrated room measurements.
 */
'use strict';

const MAX_SECONDS = 12;
const PEAK_CEILING = 0.891;   // -1 dBFS
const MAX_MAKEUP_GAIN = 4;    // never raise quiet results by more than +12 dB
const BANDS = [125, 250, 500, 1000, 2000, 4000];
const COLOR = {
  a: '#500000', b: '#B08D57', other: '#D6CEC3', ink: '#242222', mute: '#706A65',
  line: '#DED8D0', grid: '#EEE9E2', wave: '#C3BAAE', waveFill: '#500000'
};
const FONT = {
  mono: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
  sans: '"IBM Plex Sans", system-ui, "Segoe UI", sans-serif'
};
// Building names implied by the location names the team gave each recording.
const BUILDINGS = [
  ['Zachry', 'Zachry Engineering Education Complex'], ['Blocker', 'Blocker Building'],
  ['MSC', 'Memorial Student Center'], ['Rudder Tower', 'Rudder Tower'],
  ['Koldus', 'Koldus Building'], ['Langford', 'Langford Architecture Center']
];
// Flute-only samples recorded at the same physical place as a clap sample.
// Both keep their own names, IDs and files; they are shown as one place.
const SAME_PLACE = { 'blocker-stairwell': 'blocker-staircase' };

const AC = window.AudioContext || window.webkitAudioContext;
const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const fixed = (n, d = 2) => isNum(n) ? n.toFixed(d) : '—';
const fmtTime = (t) => {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

const state = {
  locations: [], measured: [], curves: {}, A: null, B: null, wet: 0.75,
  clip: null,               // { name, buffer (mono AudioBuffer), url, truncated, sourceDuration }
  clipId: 0,
  results: { A: null, B: null }, // { buffer, blob, url, roomId, wet }
  busy: false, rec: null, sort: 'decay', tab: 'rt'
};
const byId = (id) => state.locations.find(r => r.location_id === id);
const room = (slot) => byId(state[slot]);
const placeOf = (r) => (SAME_PLACE[r.location_id] && byId(SAME_PLACE[r.location_id])) || null;
const fluteSampleAt = (r) => state.locations.find(s => SAME_PLACE[s.location_id] === r.location_id && s.flute_available) || null;
const places = () => state.locations.filter(r => !placeOf(r));

/* ---------------------------------------------------------------------------
   Location descriptors (derived only from measured values)
   ------------------------------------------------------------------------ */
function buildingOf(r) {
  const hit = BUILDINGS.find(([prefix]) => r.location.startsWith(prefix + ' '));
  if (hit) return hit[1];
  if (r.location.startsWith('Control ')) return 'Control space · building not recorded';
  return 'Building not recorded';
}
function decayCharacter(t) {
  if (!isNum(t)) return null;
  if (t >= 2) return 'Long, lingering decay';
  if (t >= 1) return 'Noticeable reverberation';
  if (t >= 0.6) return 'Moderate decay';
  return 'Short, dry decay';
}
function clarityPhrase(c50) {
  if (!isNum(c50)) return '';
  if (c50 >= 5) return 'speech stays crisp';
  if (c50 >= 0) return 'speech stays fairly clear';
  if (c50 >= -3) return 'reflections start to blur speech';
  return 'late reflections dominate speech';
}
function describe(r) {
  const ch = decayCharacter(r.t20_500_1000_s);
  if (!ch) return '';
  const cl = clarityPhrase(r.c50_broad_db);
  return cl ? `${ch}; ${cl}.` : `${ch}.`;
}
function qualityFlag(r) {
  if (isNum(r.cv_broad_t20) && r.cv_broad_t20 > 0.3)
    return `The three claps disagree by ${Math.round(r.cv_broad_t20 * 100)}% (coefficient of variation), so treat this estimate as approximate.`;
  return '';
}

/* ---------------------------------------------------------------------------
   Audio engine
   ------------------------------------------------------------------------ */
const irBytes = new Map();
const irBuffers = new Map();

function fetchIR(r) {
  if (!irBytes.has(r.location_id)) {
    const p = fetch(`data/${r.ir_filename}`).then(res => {
      if (!res.ok) throw new Error(`The ${r.location} room response could not be loaded (HTTP ${res.status}).`);
      return res.arrayBuffer();
    });
    irBytes.set(r.location_id, p);
    p.catch(() => irBytes.delete(r.location_id));
  }
  return irBytes.get(r.location_id);
}

async function resampleBuffer(buf, rate) {
  if (buf.sampleRate === rate) return buf;
  const ctx = new OAC(buf.numberOfChannels, Math.max(1, Math.ceil(buf.duration * rate)), rate);
  const src = ctx.createBufferSource();
  src.buffer = buf; src.connect(ctx.destination); src.start(0);
  return ctx.startRendering();
}

// A ConvolverNode only accepts a buffer at its context's sample rate, so each
// room response is decoded (and if needed resampled) to the clip's rate.
function loadIR(r, rate) {
  const key = `${r.location_id}@${rate}`;
  if (!irBuffers.has(key)) {
    const p = (async () => {
      const bytes = (await fetchIR(r)).slice(0);
      const decoded = await new OAC(1, 1, rate).decodeAudioData(bytes);
      return resampleBuffer(decoded, rate);
    })();
    irBuffers.set(key, p);
    p.catch(() => irBuffers.delete(key));
  }
  return irBuffers.get(key);
}

function toMono(decoded, maxSeconds) {
  const n = Math.min(decoded.length, Math.round(maxSeconds * decoded.sampleRate));
  const out = new AudioBuffer({ numberOfChannels: 1, length: Math.max(1, n), sampleRate: decoded.sampleRate });
  const mono = out.getChannelData(0);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const ch = decoded.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += ch[i] / decoded.numberOfChannels;
  }
  return out;
}

/* ---------------------------------------------------------------------------
   Silence trimming (leading and trailing only; interior pauses are never touched)
   ------------------------------------------------------------------------ */
// Thresholds sit a bounded number of dB above an adaptive noise floor (5th
// percentile of short-time RMS), so quiet speech and soft decays stay above them.
// `start` / `end` are [fraction of dynamic range, min dB, max dB] above the floor.
const TRIM_PROFILES = {
  speech: { frameMs: 10, start: [0.35, 6, 12], end: [0.3, 5, 10], startRun: 3, endRun: 3, padStart: 0.15, padEnd: 0.2, minTail: 0, fadeMs: 8 },
  // Background noise in the flute takes can change level mid-recording, so the
  // onset threshold is also kept within 35 dB of the loudest note.
  flute:  { frameMs: 20, start: [0.3, 10, 14], end: [0.2, 6, 10], startRun: 3, endRun: 3, padStart: 0.15, padEnd: 0.6, minTail: 1.0, fadeMs: 10, startBelowPeak: 35 },
  // Clap tails decay slowly into the noise floor: the end threshold is only a few
  // dB above it and at least 3 s after the last strong frame is always kept.
  clap:   { frameMs: 20, start: [0.3, 10, 15], end: [0.1, 3, 5], startRun: 1, endRun: 3, padStart: 0.1, padEnd: 1.0, minTail: 3.0, fadeMs: 5 }
};
const SILENCE_PEAK_DBFS = -65;
const MIN_DYNAMIC_RANGE_DB = 6;

function frameLevels(channels, rate, frameMs) {
  const len = channels[0].length, hop = Math.max(1, Math.round(rate * frameMs / 1000));
  const n = Math.max(1, Math.ceil(len / hop)), db = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const a = f * hop, b = Math.min(len, a + hop);
    let sum = 0;
    for (const ch of channels) for (let i = a; i < b; i++) sum += ch[i] * ch[i];
    db[f] = 10 * Math.log10(Math.max(sum / Math.max(1, (b - a) * channels.length), 1e-13));
  }
  return { db, hop };
}

function findContentBounds(channels, rate, profile) {
  const len = channels[0].length;
  const { db, hop } = frameLevels(channels, rate, profile.frameMs);
  const sorted = Float32Array.from(db).sort();
  const noise = sorted[Math.floor(0.05 * (sorted.length - 1))];
  const peak = sorted[sorted.length - 1];
  const base = { length: len, noiseDb: noise, peakDb: peak, silent: false, trimmed: false, start: 0, end: len };
  if (peak < SILENCE_PEAK_DBFS) return { ...base, silent: true };
  const range = peak - noise;
  if (range < MIN_DYNAMIC_RANGE_DB) return base;
  const above = ([frac, lo, hi]) => noise + Math.min(hi, Math.max(lo, range * frac));
  let startThr = above(profile.start);
  if (profile.startBelowPeak) startThr = Math.max(startThr, peak - profile.startBelowPeak);
  const endThr = Math.min(above(profile.end), startThr);

  let first = -1;
  for (let f = 0, run = 0; f < db.length; f++) {
    run = db[f] > startThr ? run + 1 : 0;
    if (run >= profile.startRun) { first = f - run + 1; break; }
  }
  let lastStrong = -1;
  for (let f = db.length - 1, run = 0; f >= 0; f--) {
    run = db[f] > startThr ? run + 1 : 0;
    if (run >= profile.startRun) { lastStrong = f + run - 1; break; }
  }
  if (first < 0 || lastStrong < 0) return base;
  let last = lastStrong;
  for (let f = db.length - 1, run = 0; f > lastStrong; f--) {
    run = db[f] > endThr ? run + 1 : 0;
    if (run >= profile.endRun) { last = f + run - 1; break; }
  }
  const start = Math.max(0, first * hop - Math.round(profile.padStart * rate));
  let end = Math.min(len, (last + 1) * hop + Math.round(profile.padEnd * rate));
  end = Math.min(len, Math.max(end, (lastStrong + 1) * hop + Math.round(profile.minTail * rate)));
  return { ...base, start, end, trimmed: start > 0 || end < len };
}

function applyFades(data, fadeIn, fadeOut) {
  for (let i = 0; i < fadeIn && i < data.length; i++) data[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut && i < data.length; i++) data[data.length - 1 - i] *= i / fadeOut;
}

// Returns a new AudioBuffer covering [start, end); the input buffer is never modified.
function sliceBuffer(buffer, start, end, fadeInSamples, fadeOutSamples) {
  const out = new AudioBuffer({ numberOfChannels: buffer.numberOfChannels, length: Math.max(1, end - start), sampleRate: buffer.sampleRate });
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = out.getChannelData(c);
    d.set(buffer.getChannelData(c).subarray(start, end));
    applyFades(d, fadeInSamples, fadeOutSamples);
  }
  return out;
}

function trimSilence(buffer, profileName) {
  const profile = TRIM_PROFILES[profileName];
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const bounds = findContentBounds(channels, buffer.sampleRate, profile);
  if (bounds.silent || !bounds.trimmed) return { buffer, bounds };
  const fade = Math.round(profile.fadeMs / 1000 * buffer.sampleRate);
  const trimmed = sliceBuffer(buffer, bounds.start, bounds.end, bounds.start > 0 ? fade : 0, bounds.end < bounds.length ? fade : 0);
  return { buffer: trimmed, bounds };
}

function peakOf(buffers) {
  let peak = 0;
  for (const b of buffers) {
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
  }
  return peak;
}

async function decodeClip(blob, name) {
  if (!AC || !OAC) throw new Error('This browser does not support the Web Audio API. Try a current version of Chrome, Edge, Firefox or Safari.');
  const bytes = await blob.arrayBuffer();
  if (!bytes.byteLength) throw new Error(`${name} is empty.`);
  const ctx = new AC();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(bytes);
  } catch (err) {
    throw new Error(`${name} could not be decoded by this browser. WAV and MP3 work everywhere; M4A support varies by browser.`);
  } finally {
    if (ctx.close) ctx.close().catch(() => {});
  }
  if (!decoded.length) throw new Error(`${name} contains no audio.`);
  const full = toMono(decoded, Infinity);
  const { buffer: trimmed, bounds } = trimSilence(full, 'speech');
  if (bounds.silent) throw new Error('No meaningful sound was detected. The audio is silent or extremely quiet; check the microphone input level and try again.');
  const maxLen = Math.round(MAX_SECONDS * trimmed.sampleRate);
  const truncated = trimmed.length > maxLen;
  const mono = truncated
    ? sliceBuffer(trimmed, 0, maxLen, 0, Math.round(TRIM_PROFILES.speech.fadeMs / 1000 * trimmed.sampleRate))
    : trimmed;
  return {
    mono, truncated, sourceDuration: decoded.duration,
    leadTrimmed: bounds.start / full.sampleRate,
    tailTrimmed: (bounds.length - bounds.end) / full.sampleRate
  };
}

async function convolve(original, ir, wet) {
  const rate = original.sampleRate;
  if (ir.sampleRate !== rate) throw new Error(`Internal sample-rate mismatch (${ir.sampleRate} vs ${rate} Hz).`);
  const length = Math.ceil((original.duration + ir.duration + 0.1) * rate);
  const ctx = new OAC(1, length, rate);
  const source = ctx.createBufferSource();
  const dry = ctx.createGain(), wetGain = ctx.createGain(), convolver = ctx.createConvolver();
  source.buffer = original;
  convolver.normalize = false;
  convolver.buffer = ir;
  dry.gain.value = 0.93 - 0.67 * wet;
  wetGain.gain.value = 2.4 * wet;
  source.connect(dry).connect(ctx.destination);
  source.connect(convolver).connect(wetGain).connect(ctx.destination);
  source.start(0);
  return ctx.startRendering();
}

// One shared gain for both rooms keeps the loudness difference between A and B audible.
function normalizeTogether(buffers) {
  const peak = peakOf(buffers);
  if (!peak) return 1;
  const gain = Math.min(PEAK_CEILING / peak, MAX_MAKEUP_GAIN);
  for (const b of buffers) { const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] *= gain; }
  return gain;
}

function bufferToWav(buf) {
  const samples = buf.getChannelData(0), len = samples.length, rate = buf.sampleRate;
  const bytes = new ArrayBuffer(44 + len * 2), view = new DataView(bytes);
  const str = (pos, s) => { for (let i = 0; i < s.length; i++) view.setUint8(pos + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + len * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, len * 2, true);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

/* ---------------------------------------------------------------------------
   Waveforms
   ------------------------------------------------------------------------ */
function sizeCanvas(canvas, w, h) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function computePeaks(samples, columns) {
  const out = new Float32Array(columns * 2);
  const per = samples.length / columns;
  for (let x = 0; x < columns; x++) {
    let min = 0, max = 0;
    const start = Math.floor(x * per), end = Math.min(samples.length, Math.max(start + 1, Math.floor((x + 1) * per)));
    for (let i = start; i < end; i++) { const s = samples[i]; if (s < min) min = s; if (s > max) max = s; }
    out[x * 2] = min; out[x * 2 + 1] = max;
  }
  return out;
}

// wave.dataset holds nothing; samples are kept on the element for redraws.
function drawWave(wave, samples, opts = {}) {
  wave._samples = samples || null;
  wave._opts = opts;
  const base = $('.wave-base', wave), fill = $('.wave-fill canvas', wave);
  const w = wave.clientWidth, h = wave.clientHeight;
  if (!w || !h) return;
  fill.style.width = `${w}px`;
  const bctx = sizeCanvas(base, w, h), fctx = sizeCanvas(fill, w, h);
  const ruler = opts.ruler ? 18 : 0, mid = (h - ruler) / 2;
  bctx.clearRect(0, 0, w, h); fctx.clearRect(0, 0, w, h);
  bctx.fillStyle = COLOR.grid; bctx.fillRect(0, Math.round(mid), w, 1);
  if (opts.ruler && opts.duration) {
    bctx.fillStyle = COLOR.line; bctx.fillRect(0, h - ruler, w, 1);
    bctx.font = `10px ${FONT.mono}`; bctx.fillStyle = COLOR.mute; bctx.textBaseline = 'middle';
    const step = opts.duration > 8 ? 2 : 1;
    for (let s = 0; s <= opts.duration; s += step) {
      const x = Math.round((s / opts.duration) * (w - 1));
      bctx.fillRect(x, h - ruler, 1, 4);
      if (x < w - 22) bctx.fillText(`${s}s`, x + 3, h - ruler / 2 + 1);
    }
  }
  if (!samples || !samples.length) return;
  const bar = 2, gap = 1, cols = Math.floor(w / (bar + gap));
  const peaks = computePeaks(samples, cols);
  let norm = 0; for (let i = 0; i < peaks.length; i++) norm = Math.max(norm, Math.abs(peaks[i]));
  norm = norm || 1;
  const amp = (mid - 4) / norm;
  for (const [ctx, color] of [[bctx, COLOR.wave], [fctx, opts.fillColor || COLOR.waveFill]]) {
    ctx.fillStyle = color;
    for (let x = 0; x < cols; x++) {
      const top = mid - peaks[x * 2 + 1] * amp, bottom = mid - peaks[x * 2] * amp;
      ctx.fillRect(x * (bar + gap), top, bar, Math.max(1, bottom - top));
    }
  }
}

function drawLiveLevels(wave, levels) {
  const base = $('.wave-base', wave);
  const w = wave.clientWidth, h = wave.clientHeight, mid = h / 2;
  const ctx = sizeCanvas(base, w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = COLOR.grid; ctx.fillRect(0, Math.round(mid), w, 1);
  ctx.fillStyle = COLOR.a;
  for (const [t, level] of levels) {
    const x = (t / MAX_SECONDS) * w, half = Math.max(0.5, level * (mid - 4));
    ctx.fillRect(x, mid - half, 2, half * 2);
  }
  const last = levels.length ? levels[levels.length - 1][0] : 0;
  ctx.fillStyle = COLOR.a; ctx.fillRect((last / MAX_SECONDS) * w, 0, 1, h);
}

/* ---------------------------------------------------------------------------
   Players: one plays at a time; linked tracks keep their position on switch
   ------------------------------------------------------------------------ */
const players = [];

function bindPlayer(root, { progressEl, prepare, onError } = {}) {
  const p = {
    root, audio: $('audio', root), btn: $('[data-play]', root), time: $('[data-time]', root),
    wave: $('.wave', root), seek: $('[data-seek]', root), progress: progressEl || null,
    linked: root.hasAttribute('data-linked'), prepare: prepare || null, onError: onError || null,
    loading: false
  };
  const label = p.btn.getAttribute('aria-label') || 'Play';
  p.btn.addEventListener('click', () => toggle(p));
  const sync = () => syncPlayer(p);
  ['timeupdate', 'loadedmetadata', 'durationchange', 'emptied', 'seeked'].forEach(ev => p.audio.addEventListener(ev, sync));
  p.audio.addEventListener('play', () => {
    p.btn.classList.add('is-playing'); p.btn.setAttribute('aria-label', label.replace(/^Play/, 'Pause'));
    requestAnimationFrame(tick);
  });
  const stopped = () => { p.btn.classList.remove('is-playing'); p.btn.setAttribute('aria-label', label); sync(); };
  p.audio.addEventListener('pause', stopped);
  p.audio.addEventListener('ended', stopped);
  p.audio.addEventListener('error', () => { if (p.audio.getAttribute('src')) { stopped(); flashError(p, 'This audio could not be played.'); } });
  if (p.seek) {
    p.seek.addEventListener('click', async (e) => {
      if (!canPlay(p)) return;
      const rect = p.seek.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      if (!hasAudio(p) && !(await ensureReady(p))) return;
      p.audio.currentTime = frac * duration(p);
    });
    p.seek.addEventListener('keydown', async (e) => {
      if (!canPlay(p)) return;
      if (!hasAudio(p) && !(e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); if (!(await ensureReady(p))) return; }
      const d = duration(p), steps = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1, PageDown: -5, PageUp: 5 };
      if (e.key in steps) p.audio.currentTime = Math.max(0, Math.min(d, p.audio.currentTime + steps[e.key]));
      else if (e.key === 'Home') p.audio.currentTime = 0;
      else if (e.key === 'End') p.audio.currentTime = d;
      else if (e.key === ' ' || e.key === 'Enter') toggle(p);
      else return;
      e.preventDefault();
    });
  }
  players.push(p);
  syncPlayer(p);
  return p;
}

const hasAudio = (p) => !!p.audio.getAttribute('src');
const canPlay = (p) => hasAudio(p) || !!p.prepare;
const duration = (p) => (Number.isFinite(p.audio.duration) && p.audio.duration) || p.knownDuration || 0;

// Lazily prepared players (field recordings) build their source on first use.
let playRequest = 0;

async function ensureReady(p) {
  if (hasAudio(p)) return true;
  if (!p.prepare || p.loading) return false;
  const request = playRequest;
  p.loading = true; p.root.classList.add('is-loading'); p.btn.setAttribute('aria-busy', 'true');
  let ready = false;
  try {
    players.forEach(q => { if (q !== p && q.release) q.release(); });
    await p.prepare();
    await new Promise(res => {
      if (p.audio.readyState >= 1) return res();
      p.audio.addEventListener('loadedmetadata', res, { once: true });
      p.audio.addEventListener('error', res, { once: true });
    });
    ready = hasAudio(p);
  } catch (err) {
    console.error(err);
    flashError(p, err.message || 'This recording could not be loaded.');
  } finally {
    p.loading = false; p.root.classList.remove('is-loading'); p.btn.removeAttribute('aria-busy');
  }
  // Another player was started while this one was loading.
  if (ready && request !== playRequest) { p.release(); return false; }
  syncPlayer(p);
  return ready;
}

async function toggle(p) {
  if (!canPlay(p) || p.loading) return;
  if (!p.audio.paused) { p.audio.pause(); return; }
  playRequest++;
  const other = players.find(q => q !== p && !q.audio.paused);
  if (other) {
    if (p.linked && other.linked && hasAudio(p)) p.audio.currentTime = Math.min(other.audio.currentTime, Math.max(0, duration(p) - 0.05));
    other.audio.pause();
  }
  if (!hasAudio(p) && !(await ensureReady(p))) return;
  if (p.audio.ended || p.audio.currentTime >= duration(p) - 0.02) p.audio.currentTime = 0;
  p.audio.play().catch(err => { if (err.name !== 'AbortError') flashError(p, 'Playback was blocked by the browser. Press play again.'); });
}
function pauseAll() { players.forEach(p => { if (!p.audio.paused) p.audio.pause(); }); }

function syncPlayer(p) {
  const d = duration(p), t = Math.min(p.audio.currentTime || 0, d || 0), frac = d ? t / d : 0;
  if (p.time) p.time.textContent = `${fmtTime(t)} / ${fmtTime(d)}`;
  p.btn.disabled = !canPlay(p);
  if (p.wave) {
    const w = p.wave.clientWidth;
    $('.wave-fill', p.wave).style.width = `${frac * w}px`;
    $('.playhead', p.wave).style.transform = `translateX(${frac * w}px)`;
    p.wave.classList.toggle('has-audio', hasAudio(p));
  }
  if (p.seek) {
    p.seek.tabIndex = canPlay(p) ? 0 : -1;
    p.seek.setAttribute('aria-valuemax', d.toFixed(1));
    p.seek.setAttribute('aria-valuenow', t.toFixed(1));
    p.seek.setAttribute('aria-valuetext', canPlay(p) ? `${fmtTime(t)} of ${fmtTime(d)}` : 'No audio');
  }
  if (p.progress) p.progress.style.width = `${frac * 100}%`;
}
function tick() {
  const playing = players.filter(p => !p.audio.paused);
  playing.forEach(syncPlayer);
  if (playing.length) requestAnimationFrame(tick);
}
function setSource(p, url, knownDuration) {
  p.audio.pause();
  p.knownDuration = knownDuration || 0;
  if (url) p.audio.src = url; else { p.audio.removeAttribute('src'); p.audio.load(); }
  syncPlayer(p);
}
function flashError(p, msg) {
  if (p.onError) p.onError(msg);
  else if (p.root.dataset.player === 'dry') setCapture('error', msg);
  else setRenderStatus('error', msg);
}

/* ---------------------------------------------------------------------------
   Studio: capture
   ------------------------------------------------------------------------ */
let dryPlayer, trackPlayers;

function setCapture(tone, msg) { const el = $('#captureStatus'); el.dataset.tone = tone; el.textContent = msg; }
function setRenderStatus(tone, msg) { const el = $('#renderStatus'); el.dataset.tone = tone; el.textContent = msg; }
function setStep(n) {
  $$('.steps li').forEach(li => {
    const s = Number(li.dataset.step);
    li.classList.toggle('is-current', s === n);
    li.classList.toggle('is-done', s < n);
    if (s === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
}

function micProblem() {
  if (!window.isSecureContext) return 'Recording needs a secure page (https:// or localhost). You can still upload a file.';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return 'This browser cannot access a microphone. Upload a file instead.';
  if (!window.MediaRecorder) return 'This browser cannot record audio. Upload a file instead.';
  return null;
}
function micErrorMessage(err) {
  switch (err && err.name) {
    case 'NotAllowedError': case 'SecurityError':
      return 'Microphone access was blocked. Allow it in your browser’s site settings (the icon left of the address bar), then press Record again, or upload a file.';
    case 'NotFoundError': case 'OverconstrainedError':
      return 'No microphone was found. Connect one, or upload a file instead.';
    case 'NotReadableError': case 'AbortError':
      return 'The microphone is in use by another application or could not be started.';
    default:
      return `The microphone could not be started${err && err.message ? `: ${err.message}` : '.'}`;
  }
}

async function toggleRecording() {
  if (state.rec) { stopRecording(); return; }
  const problem = micProblem();
  if (problem) { setCapture('error', problem); return; }
  pauseAll();
  const btn = $('#recordBtn');
  btn.disabled = true;
  setCapture('busy', 'Waiting for microphone permission…');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    btn.disabled = false;
    setCapture('error', micErrorMessage(err));
    return;
  }
  btn.disabled = false;
  const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t));
  let recorder;
  try { recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
  catch (err) { stream.getTracks().forEach(t => t.stop()); setCapture('error', `Recording could not start: ${err.message}`); return; }

  const chunks = [];
  const meterCtx = new AC();
  const analyser = meterCtx.createAnalyser();
  analyser.fftSize = 1024;
  meterCtx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const rec = { recorder, stream, meterCtx, levels: [], start: performance.now(), raf: 0 };
  state.rec = rec;

  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onerror = (e) => { setCapture('error', `Recording failed: ${(e.error && e.error.message) || 'unknown error'}`); };
  recorder.onstop = () => {
    cancelAnimationFrame(rec.raf);
    stream.getTracks().forEach(t => t.stop());
    meterCtx.close().catch(() => {});
    state.rec = null;
    btn.classList.remove('is-recording'); btn.setAttribute('aria-pressed', 'false');
    $('.btn-label', btn).textContent = 'Record';
    const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' });
    if (!blob.size) { setCapture('error', 'Nothing was recorded. Check your microphone and try again.'); redrawDry(); return; }
    loadClip(blob, 'Microphone recording');
  };

  invalidateClip();
  $('#waveEmpty').hidden = true;
  btn.classList.add('is-recording'); btn.setAttribute('aria-pressed', 'true');
  setCapture('busy', `Recording… stops automatically at ${MAX_SECONDS} seconds.`);
  recorder.start(250);

  const wave = $('.wave', dryPlayer.root);
  const loop = () => {
    const t = (performance.now() - rec.start) / 1000;
    analyser.getFloatTimeDomainData(buf);
    let peak = 0; for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
    rec.levels.push([t, Math.min(1, peak)]);
    drawLiveLevels(wave, rec.levels);
    $('.btn-label', btn).textContent = `Stop  ${fmtTime(t)}`;
    if (t >= MAX_SECONDS) { stopRecording(); return; }
    rec.raf = requestAnimationFrame(loop);
  };
  rec.raf = requestAnimationFrame(loop);
}
function stopRecording() {
  const rec = state.rec;
  if (!rec || rec.recorder.state === 'inactive') return;
  cancelAnimationFrame(rec.raf);
  setCapture('busy', 'Processing recording…');
  rec.recorder.stop();
}

function invalidateClip() {
  state.clipId++;
  pauseAll();
  if (state.clip && state.clip.url) URL.revokeObjectURL(state.clip.url);
  state.clip = null;
  setSource(dryPlayer, null);
  clearResults();
  $('#clipSpec').textContent = 'No audio loaded';
  $('#clipName').textContent = 'Original';
  setStep(1);
  updateRenderReadiness();
}

async function loadClip(blob, name) {
  invalidateClip();
  const id = state.clipId;
  const wave = $('.wave', dryPlayer.root);
  $('#waveEmpty').hidden = true;
  drawWave(wave, null);
  setCapture('busy', `Decoding ${name}…`);
  try {
    const { mono, sourceDuration, truncated, leadTrimmed, tailTrimmed } = await decodeClip(blob, name);
    if (id !== state.clipId) return;
    const url = URL.createObjectURL(bufferToWav(mono));
    state.clip = { name, buffer: mono, url, truncated, sourceDuration };
    setSource(dryPlayer, url, mono.duration);
    drawWave(wave, mono.getChannelData(0), { ruler: true, duration: mono.duration });
    $('#clipName').textContent = name;
    $('#clipSpec').textContent = `${(mono.sampleRate / 1000).toFixed(1)} kHz · mono · ${fmtTime(mono.duration)}`;
    const trimmedParts = [
      leadTrimmed >= 0.05 && `${leadTrimmed.toFixed(1)} s before`,
      tailTrimmed >= 0.05 && `${tailTrimmed.toFixed(1)} s after`
    ].filter(Boolean);
    const trimNote = trimmedParts.length ? `Trimmed silence: ${trimmedParts.join(', ')} the sound. ` : '';
    setCapture('ok', truncated
      ? `${trimNote}Only the first ${MAX_SECONDS} seconds will be used.`
      : `${trimNote}Ready. Choose two spaces and generate.`);
    setStep(2);
    updateRenderReadiness();
  } catch (err) {
    if (id !== state.clipId) return;
    console.error(err);
    drawWave(wave, null);
    $('#waveEmpty').hidden = false;
    setCapture('error', err.message || 'This audio could not be loaded.');
    updateRenderReadiness();
  }
}

function redrawDry() {
  const wave = $('.wave', dryPlayer.root);
  if (state.clip) drawWave(wave, state.clip.buffer.getChannelData(0), { ruler: true, duration: state.clip.buffer.duration });
  else { drawWave(wave, null); $('#waveEmpty').hidden = false; }
}

/* ---------------------------------------------------------------------------
   Studio: render & results
   ------------------------------------------------------------------------ */
function updateRenderReadiness() {
  if (state.busy) return;
  if (!state.clip) setRenderStatus('idle', 'Add a recording to begin.');
  else if (!state.results.A) setRenderStatus('ready', `Ready to process ${fmtTime(state.clip.buffer.duration)} of audio through two spaces.`);
}

function clearResults() {
  for (const k of ['A', 'B']) {
    const res = state.results[k];
    if (res && res.url) URL.revokeObjectURL(res.url);
    state.results[k] = null;
    const p = trackPlayers[k];
    setSource(p, null);
    drawWave($('.wave', p.root), null);
    $(`#download${k}`).disabled = true;
    p.root.classList.remove('is-stale', 'is-fresh');
    $('.track-stale', p.root).hidden = true;
  }
  updateTrackLabels();
}

async function render() {
  if (state.busy) return;
  if (state.rec) { setRenderStatus('error', 'Stop the recording before generating.'); return; }
  if (!state.clip) { setRenderStatus('error', 'Record or upload a clip first.'); $('#recordBtn').focus(); return; }
  const rooms = [room('A'), room('B')];
  if (rooms.some(r => !r || !r.ir_filename)) { setRenderStatus('error', 'Choose two measured spaces.'); return; }

  const clipId = state.clipId, wet = state.wet, original = state.clip.buffer, rate = original.sampleRate;
  const btn = $('#renderBtn');
  state.busy = true; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Processing…';
  pauseAll();
  setRenderStatus('busy', `Convolving with ${rooms[0].location} and ${rooms[1].location} at ${(rate / 1000).toFixed(1)} kHz…`);
  try {
    const irs = await Promise.all(rooms.map(r => loadIR(r, rate)));
    const out = await Promise.all(irs.map(ir => convolve(original, ir, wet)));
    if (clipId !== state.clipId) return;
    const gain = normalizeTogether(out);
    ['A', 'B'].forEach((k, i) => setResult(k, out[i], rooms[i].location_id, wet));
    const gainDb = 20 * Math.log10(gain);
    const gainText = `${gainDb >= 0 ? '+' : '−'}${Math.abs(gainDb).toFixed(1)} dB`;
    setRenderStatus('ok', `Done. Both tracks got the same ${gainText} level adjustment, so the loudness difference between them is preserved.`);
    setStep(3);
  } catch (err) {
    console.error(err);
    if (clipId === state.clipId) setRenderStatus('error', `Processing failed. ${err.message || 'Unknown error.'}`);
  } finally {
    state.busy = false; btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Generate A/B comparison';
  }
}

function setResult(k, buffer, roomId, wet) {
  const old = state.results[k];
  if (old && old.url) URL.revokeObjectURL(old.url);
  const blob = bufferToWav(buffer), url = URL.createObjectURL(blob);
  state.results[k] = { buffer, blob, url, roomId, wet };
  const p = trackPlayers[k];
  setSource(p, url, buffer.duration);
  drawWave($('.wave', p.root), buffer.getChannelData(0), { fillColor: k === 'A' ? COLOR.a : COLOR.b });
  $(`#download${k}`).disabled = false;
  p.root.classList.remove('is-fresh'); void p.root.offsetWidth; p.root.classList.add('is-fresh');
  updateTrackLabels();
}

function updateTrackLabels() {
  for (const k of ['A', 'B']) {
    const res = state.results[k], selected = room(k);
    const shown = res ? byId(res.roomId) : selected;
    $(`#track${k}Name`).textContent = shown ? shown.location : '—';
    $(`#track${k}Meta`).textContent = res
      ? `${(res.buffer.sampleRate / 1000).toFixed(1)} kHz · ${Math.round(res.wet * 100)}% room · ${fmtTime(res.buffer.duration)}`
      : 'Not generated yet';
    const stale = !!res && (res.roomId !== state[k] || Math.abs(res.wet - state.wet) > 1e-6);
    const p = trackPlayers[k];
    p.root.classList.toggle('is-stale', stale);
    $('.track-stale', p.root).hidden = !stale;
  }
}

function download(k) {
  const res = state.results[k];
  if (!res) return;
  const a = document.createElement('a');
  a.href = res.url;
  a.download = `aural-${k.toLowerCase()}-${res.roomId}-${Math.round(res.wet * 100)}pct.wav`;
  document.body.appendChild(a); a.click(); a.remove();
}

/* ---------------------------------------------------------------------------
   Room selection (shared by Studio, Explore and Science)
   ------------------------------------------------------------------------ */
function setRoom(slot, id) {
  if (!byId(id) || !byId(id).ir_filename) return;
  state[slot] = id;
  syncRoomUI();
}
function syncRoomUI() {
  for (const slot of ['A', 'B']) {
    $(`#room${slot}`).value = state[slot];
    $(`#sci${slot}`).value = state[slot];
    const r = room(slot);
    $(`#meta${slot}`).textContent = r ? `T20 ${fixed(r.t20_500_1000_s)} s · ${decayCharacter(r.t20_500_1000_s) || 'no estimate'}` : '';
  }
  $('#compareHeadA').textContent = room('A').location;
  $('#compareHeadB').textContent = room('B').location;
  renderCompare();
  renderAtlas();
  updateTrackLabels();
  drawChart();
}
function fillSelects() {
  const opts = state.measured.map(r => `<option value="${esc(r.location_id)}">${esc(r.location)}</option>`).join('');
  ['#roomA', '#roomB', '#sciA', '#sciB'].forEach(s => { $(s).innerHTML = opts; });
}

function renderCompare() {
  const a = room('A'), b = room('B');
  const rows = [
    ['Decay time', 'T20, 500–1000 Hz', 't20_500_1000_s', ' s', 2, 'How long sound takes to fade by 60 dB. Longer feels more echoey.'],
    ['Early decay', 'EDT, broadband', 'edt_broad_s', ' s', 2, 'How quickly the first reflections die away, closest to what you perceive.'],
    ['Speech clarity', 'C50, broadband', 'c50_broad_db', ' dB', 1, 'Early versus late energy. Above 0 dB, words stay distinct.'],
    ['Early energy', 'D50, broadband', 'd50_broad_pct', '%', 0, 'Share of sound arriving within 50 ms.']
  ];
  $('#compareBody').innerHTML = rows.map(([title, sub, key, unit, d, note]) => {
    const va = a[key], vb = b[key];
    const vals = [va, vb].filter(isNum);
    const min = key === 'c50_broad_db' ? Math.min(0, ...vals, -10) : 0;
    const max = Math.max(...vals.map(Math.abs), key === 'd50_broad_pct' ? 100 : 0.001);
    const cell = (v, cls) => isNum(v)
      ? `<td class="${cls}"><div class="cmp-val"><span class="mono">${v.toFixed(d)}${unit}</span><span class="cmp-bar" aria-hidden="true"><i style="width:${Math.max(2, ((v - min) / (max - min)) * 100).toFixed(1)}%"></i></span></div></td>`
      : `<td class="${cls}"><span class="cmp-na">No reliable fit</span></td>`;
    return `<tr><th scope="row">${title}<small>${sub}</small></th>${cell(va, 'col-a')}${cell(vb, 'col-b')}<td class="col-note">${note}</td></tr>`;
  }).join('');
}

/* ---------------------------------------------------------------------------
   Explore
   ------------------------------------------------------------------------ */
function renderAtlas() {
  const t = (r) => isNum(r.t20_500_1000_s) ? r.t20_500_1000_s : null;
  const rows = places().sort((a, b) => {
    if (state.sort === 'alpha') return a.location.localeCompare(b.location);
    const ta = t(a), tb = t(b);
    if (ta === null && tb === null) return a.location.localeCompare(b.location);
    if (ta === null) return 1;
    if (tb === null) return -1;
    return state.sort === 'short' ? ta - tb : tb - ta;
  });
  const scale = Math.ceil(Math.max(...state.measured.map(t).filter(isNum)) * 2) / 2;
  $('#atlas').innerHTML = rows.map((r, i) => {
    const measured = !!r.ir_filename, isA = state.A === r.location_id, isB = state.B === r.location_id;
    const flag = qualityFlag(r);
    const sibling = fluteSampleAt(r);
    const fluteNote = r.flute_available ? '<small>Flute recording available below.</small>'
      : sibling ? `<small>Flute recording from the same place available below, filed as “${esc(sibling.location)}”.</small>` : '';
    const decay = measured && isNum(r.t20_500_1000_s)
      ? `<div class="atlas-decay"><span class="decay-track" aria-hidden="true"><i style="width:${(r.t20_500_1000_s / scale * 100).toFixed(1)}%"></i></span><span class="decay-val mono">${r.t20_500_1000_s.toFixed(2)} s</span></div>`
      : `<p class="atlas-na">No clap recording, so no decay measurement</p>`;
    const desc = measured
      ? `<p class="atlas-desc">${esc(describe(r))}${flag ? `<small class="atlas-flag">${esc(flag)}</small>` : ''}${fluteNote}</p>`
      : `<p class="atlas-desc">Flute recording only.<small>Can’t be simulated in the Studio without a clap response.</small></p>`;
    const actions = measured
      ? `<div class="atlas-actions"><button type="button" data-use="A" data-id="${esc(r.location_id)}" aria-pressed="${isA}" aria-label="Use ${esc(r.location)} as space A">${isA ? 'Space A' : 'Use as A'}</button><button type="button" data-use="B" data-id="${esc(r.location_id)}" aria-pressed="${isB}" aria-label="Use ${esc(r.location)} as space B">${isB ? 'Space B' : 'Use as B'}</button></div>`
      : `<p class="atlas-ref"><a href="#field-recordings">Listen to the flute</a></p>`;
    return `<li class="atlas-row${isA ? ' is-a' : ''}${isB ? ' is-b' : ''}">
      <span class="atlas-no">${String(i + 1).padStart(2, '0')}</span>
      <div class="atlas-name"><h3>${esc(r.location)}</h3><p>${esc(buildingOf(r))}</p></div>
      ${decay}${desc}${actions}
    </li>`;
  }).join('');
}

function renderFlutes() {
  const list = state.locations.filter(r => r.flute_available && r.flute_preview).sort((a, b) => a.location.localeCompare(b.location));
  $('#fluteList').innerHTML = list.map(r => {
    const d = r.flute_features && r.flute_features.duration_s;
    return `<li class="flute-item" data-player="flute-${esc(r.location_id)}">
      <button type="button" class="play" data-play aria-label="Play flute recorded in ${esc(r.location)}"><span class="play-icon" aria-hidden="true"></span></button>
      <div class="flute-title"><strong>${esc(r.location)}</strong><span class="mono" data-time>0:00.0 / ${fmtTime(d)}</span></div>
      <div class="flute-sub"><span class="tag" data-note>${r.ir_filename ? 'Also clap-measured' : placeOf(r) ? `Same place as ${esc(placeOf(r).location)} (clap sample)` : 'Flute only'}</span>
        <span class="flute-progress" data-seek role="slider" tabindex="0" aria-label="Position in ${esc(r.location)} flute recording" aria-valuemin="0"><i></i></span></div>
      <audio preload="auto"></audio>
    </li>`;
  }).join('');
  $$('.flute-item').forEach((li, i) => bindFieldRecording(li, list[i], 'flute', `data/${list[i].flute_preview}`));
}

// Field recordings are trimmed for listening only: the file on disk is fetched,
// decoded and trimmed in memory, then served from a temporary Blob URL.
function bindFieldRecording(li, r, profile, url) {
  const note = $('[data-note]', li), defaultNote = note.textContent;
  const originalDuration = r.flute_features && r.flute_features.duration_s;
  const setNote = (text, isError) => { note.textContent = text; note.classList.toggle('is-error', !!isError); };
  const p = bindPlayer(li, {
    progressEl: $('.flute-progress i', li),
    onError: (msg) => setNote(msg, true),
    prepare: async () => {
      setNote('Loading…');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Recording unavailable (HTTP ${res.status}).`);
      const bytes = await res.arrayBuffer();
      const ctx = new AC();
      let decoded;
      try { decoded = await ctx.decodeAudioData(bytes); }
      catch (err) { throw new Error('This browser could not decode the recording.'); }
      finally { ctx.close().catch(() => {}); }
      const { buffer, bounds } = trimSilence(toMono(decoded, Infinity), profile);
      p.objectUrl = URL.createObjectURL(bufferToWav(buffer));
      p.knownDuration = buffer.duration;
      p.trim = { lead: bounds.start / decoded.sampleRate, tail: (bounds.length - bounds.end) / decoded.sampleRate, full: decoded.duration };
      p.audio.src = p.objectUrl;
      const parts = [p.trim.lead >= 0.05 && `${p.trim.lead.toFixed(1)} s before`, p.trim.tail >= 0.05 && `${p.trim.tail.toFixed(1)} s after`].filter(Boolean);
      setNote(parts.length ? `Silence skipped: ${parts.join(', ')}` : 'Full recording, no silence to skip');
    }
  });
  p.release = () => {
    if (!p.objectUrl || p.loading) return;
    p.audio.pause();
    URL.revokeObjectURL(p.objectUrl);
    p.objectUrl = null;
    p.audio.removeAttribute('src'); p.audio.load();
    p.knownDuration = originalDuration;
    setNote(defaultNote);
    syncPlayer(p);
  };
  p.knownDuration = originalDuration;
  syncPlayer(p);
  return p;
}

/* ---------------------------------------------------------------------------
   Science charts
   ------------------------------------------------------------------------ */
const TABS = {
  rt: {
    title: 'Reverberation time',
    what: 'How long each space takes for a sound to fade away, estimated from the team’s handclaps. All 13 measured spaces are shown; your two selections are highlighted.',
    how: 'Longer bars mean more echo. Values average the 500 and 1000 Hz octave bands, where most speech energy sits.'
  },
  freq: {
    title: 'Decay by frequency',
    what: 'The same decay estimate split into six octave bands, from low bass (125 Hz) to high treble (4000 Hz).',
    how: 'Taller bars mean that pitch range lingers longer. Bands marked “no fit” had too little signal above the background noise for a reliable estimate.'
  },
  edc: {
    title: 'Schroeder decay curve',
    what: 'The energy left in the room after the clap, computed by integrating the recording backwards in time (the Schroeder method).',
    how: 'A steeper line means the room goes quiet faster. The shaded band from −5 to −25 dB is the range used to estimate T20. Each line stops where it reaches the background noise.'
  }
};

function chartCtx() {
  const canvas = $('#chart');
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const ctx = sizeCanvas(canvas, w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  return { canvas, ctx, w, h };
}
function niceStep(max, target) {
  const raw = max / target, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
}
function truncate(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function drawRT() {
  const canvas = $('#chart');
  const rows = state.measured.filter(r => isNum(r.t20_500_1000_s)).sort((a, b) => b.t20_500_1000_s - a.t20_500_1000_s);
  canvas.style.height = `${rows.length * 26 + 56}px`;
  const { ctx, w, h } = chartCtx();
  ctx.font = `12px ${FONT.sans}`;
  const labelW = Math.min(190, w * 0.38), m = { l: labelW + 12, r: 46, t: 6, b: 44 };
  const W = w - m.l - m.r, rowH = (h - m.t - m.b) / rows.length;
  const max = Math.ceil(rows[0].t20_500_1000_s * 2) / 2, step = niceStep(max, 5);
  ctx.font = `10px ${FONT.mono}`; ctx.textAlign = 'center';
  for (let v = 0; v <= max + 1e-9; v += step) {
    const x = m.l + (v / max) * W;
    ctx.fillStyle = v === 0 ? COLOR.line : COLOR.grid; ctx.fillRect(Math.round(x), m.t, 1, h - m.t - m.b);
    ctx.fillStyle = COLOR.mute; ctx.fillText(`${+v.toFixed(2)}`, x, h - m.b + 14);
  }
  ctx.font = `11px ${FONT.sans}`; ctx.fillStyle = COLOR.mute;
  ctx.fillText('Estimated decay time (seconds, T20 extrapolated to 60 dB)', m.l + W / 2, h - 10);
  rows.forEach((r, i) => {
    const y = m.t + i * rowH, cy = y + rowH / 2;
    const isA = r.location_id === state.A, isB = r.location_id === state.B;
    const color = isA ? COLOR.a : isB ? COLOR.b : COLOR.other;
    ctx.fillStyle = color; ctx.fillRect(m.l, cy - 6, (r.t20_500_1000_s / max) * W, 12);
    ctx.textAlign = 'right'; ctx.font = `${isA || isB ? 600 : 400} 12px ${FONT.sans}`;
    ctx.fillStyle = isA || isB ? COLOR.ink : COLOR.mute;
    ctx.fillText(truncate(ctx, r.location, labelW), labelW, cy);
    ctx.textAlign = 'left'; ctx.font = `11px ${FONT.mono}`; ctx.fillStyle = isA || isB ? COLOR.ink : COLOR.mute;
    ctx.fillText(r.t20_500_1000_s.toFixed(2), m.l + (r.t20_500_1000_s / max) * W + 6, cy);
  });
  return `Bar chart of estimated decay time for ${rows.length} measured spaces, from ${rows[0].location} (${rows[0].t20_500_1000_s.toFixed(2)} s) to ${rows[rows.length - 1].location} (${rows[rows.length - 1].t20_500_1000_s.toFixed(2)} s).`;
}

function bandT20(r, f) { const b = (r.bands || []).find(x => x.band_hz === f); return b && isNum(b.t20_s) ? b.t20_s : null; }

function drawFreq() {
  $('#chart').style.height = '';
  const { ctx, w, h } = chartCtx();
  const a = room('A'), b = room('B');
  const m = { l: 48, r: 8, t: 12, b: 50 }, W = w - m.l - m.r, H = h - m.t - m.b;
  const vals = BANDS.flatMap(f => [bandT20(a, f), bandT20(b, f)]).filter(isNum);
  const step = niceStep(Math.max(...vals, 0.5), 5), max = Math.ceil(Math.max(...vals, 0.5) * 1.1 / step) * step;
  ctx.font = `10px ${FONT.mono}`; ctx.textAlign = 'right';
  for (let v = 0; v <= max + 1e-9; v += step) {
    const y = m.t + H - (v / max) * H;
    ctx.fillStyle = v === 0 ? COLOR.line : COLOR.grid; ctx.fillRect(m.l, Math.round(y), W, 1);
    ctx.fillStyle = COLOR.mute; ctx.fillText(`${+v.toFixed(2)}`, m.l - 8, y);
  }
  ctx.save(); ctx.translate(12, m.t + H / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center';
  ctx.font = `11px ${FONT.sans}`; ctx.fillText('Decay time (s)', 0, 0); ctx.restore();
  const group = W / BANDS.length, barW = Math.min(34, group * 0.3);
  BANDS.forEach((f, j) => {
    const cx = m.l + group * (j + 0.5);
    [[bandT20(a, f), COLOR.a, -1], [bandT20(b, f), COLOR.b, 1]].forEach(([v, color, side]) => {
      const x = side < 0 ? cx - barW - 2 : cx + 2;
      if (isNum(v)) {
        const bh = (v / max) * H;
        ctx.fillStyle = color; ctx.fillRect(x, m.t + H - bh, barW, bh);
        ctx.fillStyle = COLOR.ink; ctx.font = `10px ${FONT.mono}`; ctx.textAlign = 'center';
        ctx.fillText(v.toFixed(2), x + barW / 2, m.t + H - bh - 9);
      } else {
        ctx.strokeStyle = color; ctx.setLineDash([3, 3]); ctx.strokeRect(x + 0.5, m.t + H - 18.5, barW - 1, 18);
        ctx.setLineDash([]); ctx.fillStyle = COLOR.mute; ctx.font = `9px ${FONT.mono}`; ctx.textAlign = 'center';
        ctx.fillText('no fit', x + barW / 2, m.t + H - 28);
      }
    });
    ctx.fillStyle = COLOR.ink; ctx.font = `11px ${FONT.mono}`; ctx.textAlign = 'center';
    ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), cx, m.t + H + 16);
  });
  ctx.fillStyle = COLOR.mute; ctx.font = `11px ${FONT.sans}`; ctx.textAlign = 'center';
  ctx.fillText('Octave band centre frequency (Hz)', m.l + W / 2, h - 10);
  return `Grouped bar chart of decay time per octave band for ${a.location} and ${b.location}.`;
}

function drawEDC() {
  $('#chart').style.height = '';
  const { ctx, w, h } = chartCtx();
  const a = room('A'), b = room('B');
  const ca = state.curves[a.location_id] || [], cb = state.curves[b.location_id] || [];
  const tMax = Math.max(0.5, Math.ceil(Math.max(...ca.map(p => p[0]), ...cb.map(p => p[0]), 0) * 2 + 0.2) / 2);
  const dbMin = -60;
  const m = { l: 52, r: 16, t: 12, b: 50 }, W = w - m.l - m.r, H = h - m.t - m.b;
  const X = (t) => m.l + (t / tMax) * W, Y = (db) => m.t + (Math.max(dbMin, Math.min(0, db)) / dbMin) * H;
  ctx.fillStyle = 'rgba(176,141,87,.12)'; ctx.fillRect(m.l, Y(-5), W, Y(-25) - Y(-5));
  ctx.fillStyle = COLOR.mute; ctx.font = `10px ${FONT.sans}`; ctx.textAlign = 'right';
  ctx.fillText('T20 fit range', m.l + W - 6, Y(-15));
  ctx.font = `10px ${FONT.mono}`;
  for (let db = 0; db >= dbMin; db -= 10) {
    ctx.fillStyle = db === 0 ? COLOR.line : COLOR.grid; ctx.fillRect(m.l, Math.round(Y(db)), W, 1);
    ctx.fillStyle = COLOR.mute; ctx.textAlign = 'right'; ctx.fillText(`${db}`, m.l - 8, Y(db));
  }
  const step = niceStep(tMax, 6);
  ctx.textAlign = 'center';
  for (let t = 0; t <= tMax + 1e-9; t += step) {
    ctx.fillStyle = COLOR.grid; ctx.fillRect(Math.round(X(t)), m.t, 1, H);
    ctx.fillStyle = COLOR.mute; ctx.fillText(`${+t.toFixed(2)}`, X(t), m.t + H + 16);
  }
  ctx.font = `11px ${FONT.sans}`;
  ctx.fillText('Time after the clap (seconds)', m.l + W / 2, h - 10);
  ctx.save(); ctx.translate(12, m.t + H / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('Remaining energy (dB)', 0, 0); ctx.restore();
  for (const [pts, color] of [[cb, COLOR.b], [ca, COLOR.a]]) {
    if (!pts.length) continue;
    ctx.strokeStyle = color; ctx.lineWidth = 2.25; ctx.lineJoin = 'round'; ctx.beginPath();
    pts.forEach(([t, db], i) => { i ? ctx.lineTo(X(t), Y(db)) : ctx.moveTo(X(t), Y(db)); });
    ctx.stroke();
    const [lt, ldb] = pts[pts.length - 1];
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(lt), Y(ldb), 3.5, 0, Math.PI * 2); ctx.fill();
  }
  return `Line chart of Schroeder energy decay for ${a.location} and ${b.location}.`;
}

function drawChart() {
  if (!state.measured.length) return;
  const tab = TABS[state.tab], a = room('A'), b = room('B');
  const label = state.tab === 'rt' ? drawRT() : state.tab === 'freq' ? drawFreq() : drawEDC();
  $('#chart').setAttribute('aria-label', label);
  $('#chartTitle').textContent = tab.title;
  $('#chartWhat').textContent = tab.what;
  $('#chartHow').textContent = tab.how;
  const sw = (c) => `<i style="background:${c}"></i>`;
  $('#chartLegend').innerHTML = state.tab === 'rt'
    ? `<span>${sw(COLOR.a)}A · ${esc(a.location)}</span><span>${sw(COLOR.b)}B · ${esc(b.location)}</span><span>${sw(COLOR.other)}Other measured spaces</span>`
    : `<span>${sw(COLOR.a)}A · ${esc(a.location)}</span><span>${sw(COLOR.b)}B · ${esc(b.location)}</span>`;
  const row = (chip, name, val) => `<div><dt><span class="chip chip--${chip}" aria-hidden="true">${chip.toUpperCase()}</span> ${esc(name)}</dt><dd></dd><dd>${val}</dd></div>`;
  let items;
  if (state.tab === 'rt') items = [row('a', a.location, `${fixed(a.t20_500_1000_s)} s`), row('b', b.location, `${fixed(b.t20_500_1000_s)} s`)];
  else if (state.tab === 'freq') {
    const rng = (r) => { const v = BANDS.map(f => bandT20(r, f)).filter(isNum); return v.length ? `${Math.min(...v).toFixed(2)}–${Math.max(...v).toFixed(2)} s` : '—'; };
    items = [row('a', a.location, rng(a)), row('b', b.location, rng(b))];
  } else items = [row('a', a.location, `EDT ${fixed(a.edt_broad_s)} s`), row('b', b.location, `EDT ${fixed(b.edt_broad_s)} s`)];
  $('#chartReadout').innerHTML = items.join('');
}

function selectTab(name, focus) {
  state.tab = name;
  $$('[role="tab"]').forEach(t => {
    const on = t.dataset.tab === name;
    t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
    if (on) { $('#vizPanel').setAttribute('aria-labelledby', t.id); if (focus) t.focus(); }
  });
  drawChart();
}

/* ---------------------------------------------------------------------------
   Navigation
   ------------------------------------------------------------------------ */
function watchSections() {
  const links = $$('[data-nav]');
  const sections = ['studio', 'explore', 'science', 'field-recordings', 'method'].map(id => document.getElementById(id));
  let queued = false;
  const update = () => {
    queued = false;
    const line = window.innerHeight * 0.35;
    let current = null;
    for (const s of sections) if (s.getBoundingClientRect().top <= line) current = s.id;
    links.forEach(a => {
      const on = a.dataset.nav === current;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
  };
  window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  update();
}

function sendToStudio(slot, id) {
  setRoom(slot, id);
  const field = $(`#field${slot}`);
  $('#studio').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  field.classList.add('is-flash');
  setTimeout(() => field.classList.remove('is-flash'), 900);
  $(`#room${slot}`).focus({ preventScroll: true });
}

/* ---------------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------------ */
function bindEvents() {
  $('#recordBtn').addEventListener('click', toggleRecording);
  $('#audioFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) { if (state.rec) stopRecording(); loadClip(f, f.name); }
  });
  const deck = $('#captureDeck');
  ['dragenter', 'dragover'].forEach(ev => deck.addEventListener(ev, (e) => { e.preventDefault(); deck.classList.add('is-dragover'); }));
  ['dragleave', 'drop'].forEach(ev => deck.addEventListener(ev, (e) => {
    if (ev === 'dragleave' && deck.contains(e.relatedTarget)) return;
    deck.classList.remove('is-dragover');
  }));
  deck.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (f && !state.rec) loadClip(f, f.name);
  });

  ['A', 'B'].forEach(slot => {
    $(`#room${slot}`).addEventListener('change', (e) => setRoom(slot, e.target.value));
    $(`#sci${slot}`).addEventListener('change', (e) => setRoom(slot, e.target.value));
    $(`#download${slot}`).addEventListener('click', () => download(slot));
  });
  $('#swapBtn').addEventListener('click', () => { [state.A, state.B] = [state.B, state.A]; syncRoomUI(); });
  const wet = $('#wetness');
  const onWet = () => {
    state.wet = Number(wet.value) / 100;
    $('#wetValue').textContent = `${wet.value}%`;
    wet.style.setProperty('--pct', `${wet.value}%`);
    updateTrackLabels();
  };
  wet.addEventListener('input', onWet); onWet();
  $('#renderBtn').addEventListener('click', render);

  $('#atlas').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-use]');
    if (btn) sendToStudio(btn.dataset.use, btn.dataset.id);
  });
  $$('[data-sort]').forEach(btn => btn.addEventListener('click', () => {
    state.sort = btn.dataset.sort;
    $$('[data-sort]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    renderAtlas();
  }));

  const tabs = $$('[role="tab"]');
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectTab(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      const n = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (n) { e.preventDefault(); selectTab(tabs[(i + n + tabs.length) % tabs.length].dataset.tab, true); }
      else if (e.key === 'Home') { e.preventDefault(); selectTab(tabs[0].dataset.tab, true); }
      else if (e.key === 'End') { e.preventDefault(); selectTab(tabs[tabs.length - 1].dataset.tab, true); }
    });
  });

  let pending = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      drawChart();
      if (!state.rec) redrawDry();
      for (const k of ['A', 'B']) {
        const wave = $('.wave', trackPlayers[k].root);
        drawWave(wave, wave._samples, wave._opts);
      }
      players.forEach(syncPlayer);
    });
  });

  if ('ResizeObserver' in window) {
    let lastHeight = 0, queued = 0;
    new ResizeObserver(([entry]) => {
      const h = Math.round(entry.contentRect.height);
      if (h === lastHeight) return;
      lastHeight = h;
      cancelAnimationFrame(queued);
      queued = requestAnimationFrame(() => { if (!state.rec) redrawDry(); });
    }).observe($('[data-player="dry"] .wave'));
  }
}

async function main() {
  dryPlayer = bindPlayer($('[data-player="dry"]'));
  trackPlayers = { A: bindPlayer($('[data-player="A"]')), B: bindPlayer($('[data-player="B"]')) };
  const problem = micProblem();
  if (problem) { $('#recordBtn').disabled = true; setCapture('error', problem); }
  bindEvents();
  watchSections();
  redrawDry();
  try {
    const [info, curves] = await Promise.all([
      fetch('data/locations.json').then(r => { if (!r.ok) throw new Error(`locations.json returned HTTP ${r.status}`); return r.json(); }),
      fetch('data/decay-curves.json').then(r => { if (!r.ok) throw new Error(`decay-curves.json returned HTTP ${r.status}`); return r.json(); })
    ]);
    state.locations = info.locations;
    state.measured = info.locations.filter(r => r.ir_filename).sort((a, b) => a.location.localeCompare(b.location));
    state.curves = curves;
    const pick = (name, fallback) => (state.measured.find(r => r.location === name) || state.measured[fallback]).location_id;
    state.A = pick('Zachry Stairwell', 0);
    state.B = pick('Zachry Collaboration Room', 1);

    const claps = state.measured.reduce((n, r) => n + (r.clap_count || 0), 0);
    const flutes = state.locations.filter(r => r.flute_available).length;
    const placeList = places();
    const fluteOnly = placeList.filter(r => !r.ir_filename).length;
    const shared = state.locations.filter(placeOf).map(r => `${placeOf(r).location} and ${r.location} are one place, recorded as a clap sample and a flute sample.`).join(' ');
    $('#heroFacts').textContent = `${state.measured.length} clap-measured spaces · ${claps} handclaps analysed · ${flutes} flute recordings`;
    $('#exploreLead').textContent = `${placeList.length} places recorded by our team on the Texas A&M campus. ${state.measured.length} were measured with handclaps and can be used in the Studio; ${fluteOnly} ${fluteOnly === 1 ? 'has' : 'have'} a flute recording only. ${shared}`.trim();

    fillSelects();
    renderFlutes();
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    syncRoomUI();
    updateRenderReadiness();
  } catch (err) {
    console.error(err);
    const msg = `Could not load the measurement data (${err.message}). Serve this folder over HTTP, for example with “py -m http.server 8000”, instead of opening index.html directly.`;
    $('#atlas').innerHTML = `<li class="atlas-loading">${esc(msg)}</li>`;
    setRenderStatus('error', msg);
    $('#renderBtn').disabled = true;
  }
}

document.addEventListener('DOMContentLoaded', main);
