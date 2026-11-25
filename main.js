import { parseWav } from './wav.js';
import { measure } from './meter.js';
import { analyze } from './analyzer.js';
import { renderAnalysis } from './analyzerui.js';
import { initMastering } from './mastering.js';

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const db = (x) => (isFinite(x) ? x.toFixed(2) + ' dBFS' : '−∞ dBFS');

let ctx = null, buffer = null, chs = null, src = null;
let playing = false, startedAt = 0, offset = 0;
let bufs = { orig: null, master: null }, which = 'orig', trims = { orig: 1, master: 1 }, lastA = null, songName = '', mast = null;

function setCtx(sr) {
  if (ctx && (!sr || ctx.sampleRate === sr)) return;
  stop();
  if (ctx) ctx.close();
  ctx = sr ? new AudioContext({ sampleRate: sr }) : new AudioContext();
}

const now = () => (playing ? ctx.currentTime - startedAt : offset);

function play() {
  if (!buffer) return;
  ctx.resume();
  if (offset >= buffer.duration - 0.01) offset = 0;
  src = ctx.createBufferSource();
  src.buffer = buffer;
  const gn = ctx.createGain(); gn.gain.value = trims[which];
  src.connect(gn).connect(ctx.destination);
  src.onended = () => { if (playing) { playing = false; offset = 0; ui(); } };
  startedAt = ctx.currentTime - offset;
  src.start(0, offset);
  playing = true;
  ui();
}
function stop() {
  if (src) { src.onended = null; try { src.stop(); } catch {} src.disconnect(); src = null; }
  playing = false;
}
function pause() { offset = now(); stop(); ui(); }
function seek(t) {
  const was = playing;
  if (was) stop();
  offset = Math.max(0, Math.min(buffer.duration - 0.01, t));
  if (was) play(); else ui();
}

function use(w) {
  if (!bufs[w]) return;
  const was = playing, t = now(); stop();
  which = w; buffer = bufs[w]; offset = Math.min(t, buffer.duration - 0.01);
  if (was) play(); else ui();
}
const api = {
  getChs: () => chs, getSr: () => bufs.orig.sampleRate, getName: () => songName, getOrig: () => lastA, use,
  setTrims: (o, m) => { trims = { orig: o, master: m }; },
  setMaster: (mchs, sr) => { const b = ctx.createBuffer(mchs.length, mchs[0].length, sr); mchs.forEach((d, c) => b.copyToChannel(d, c)); bufs.master = b; },
};
function ui() {
  if (!buffer) return;
  $('play').textContent = playing ? 'Pausar' : 'Reproducir';
  const t = now();
  $('time').textContent = `${fmt(t)} / ${fmt(buffer.duration)}`;
  $('head').style.left = (t / buffer.duration) * 100 + '%';
}
(function tick() { if (playing) ui(); requestAnimationFrame(tick); })();

function drawWave() {
  const cv = $('wave'), r = devicePixelRatio || 1;
  const w = (cv.width = cv.clientWidth * r), h = (cv.height = cv.clientHeight * r);
  const g = cv.getContext('2d'), step = chs[0].length / w;
  g.fillStyle = css('--bg2'); g.fillRect(0, 0, w, h);
  g.fillStyle = css('--accent');
  for (let x = 0; x < w; x++) {
    let mn = 0, mx = 0;
    const a = Math.floor(x * step), b = Math.max(a + 1, Math.floor((x + 1) * step));
    for (const d of chs) for (let i = a; i < b; i++) { const s = d[i]; if (s < mn) mn = s; if (s > mx) mx = s; }
    g.fillRect(x, h / 2 - (mx * h) / 2, 1, Math.max(1, ((mx - mn) * h) / 2));
  }
}

function showInfo(file, kind) {
  const m = measure(chs), n = chs.length;
  const rows = [
    ['Archivo', file.name],
    ['Formato', kind],
    ['Frecuencia de muestreo', `${buffer.sampleRate} Hz` + (ctx.sampleRate !== buffer.sampleRate ? ` (el navegador reproduce a ${ctx.sampleRate} Hz)` : '')],
    ['Canales', n === 1 ? 'Mono' : n === 2 ? 'Estéreo' : String(n)],
    ['Duración', fmt(buffer.duration)],
    ['Pico', db(m.peakDb)],
    ['RMS', db(m.rmsDb)],
    ['Muestras en el tope', String(m.clipped)],
  ];
  const dl = $('info'); dl.replaceChildren();
  for (const [k, v] of rows) {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = k; dd.textContent = v; dl.append(dt, dd);
  }
}

async function load(file) {
  stop(); offset = 0;
  let kind;
  try {
    const ab = await file.arrayBuffer();
    if (/\.wav$/i.test(file.name) || /wav/.test(file.type)) {
      const w = parseWav(ab);                       // lectura propia, sin pasar por el navegador
      setCtx(w.sampleRate);
      buffer = ctx.createBuffer(w.channels.length, w.channels[0].length, w.sampleRate);
      w.channels.forEach((d, c) => buffer.copyToChannel(d, c));
      chs = w.channels;
      kind = `WAV, ${w.bits} bits${w.isFloat ? ' (float)' : ''}`;
    } else {
      setCtx();                                     // MP3: lo decodifica el navegador (puede remuestrear)
      buffer = await ctx.decodeAudioData(ab);
      chs = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
      kind = 'MP3 (decodificado por el navegador)';
    }
  } catch (e) { alert('No se pudo cargar el archivo: ' + e.message); return; }
  bufs = { orig: buffer, master: null }; which = 'orig'; trims = { orig: 1, master: 1 }; songName = file.name; lastA = null;
  $('mastering').hidden = true;
  $('name').textContent = file.name;
  $('player').hidden = false;
  drawWave(); showInfo(file, kind); ui();
  const a = $('analysis'); a.textContent = 'Analizando…';
  await new Promise((r) => setTimeout(r, 30));
  lastA = analyze(chs, buffer.sampleRate);
  renderAnalysis(lastA, a);
  mast = mast || initMastering(api); mast.reset(); $('mastering').hidden = false;
}

$('file').addEventListener('change', (e) => e.target.files[0] && load(e.target.files[0]));
$('play').addEventListener('click', () => (playing ? pause() : play()));
$('wavebox').addEventListener('click', (e) => buffer && seek((e.offsetX / e.currentTarget.clientWidth) * buffer.duration));
addEventListener('keydown', (e) => { if (e.code === 'Space' && buffer && e.target.tagName !== 'INPUT') { e.preventDefault(); playing ? pause() : play(); } });
addEventListener('resize', () => { if (chs) drawWave(); });
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); });
