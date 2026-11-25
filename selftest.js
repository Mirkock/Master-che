import { parseWav, encodeWav } from './wav.js';
import { measure } from './meter.js';
import { loudness, truePeak, stereo } from './analyzer.js';
import { master, DEFAULTS } from './dsp.js';
import { PRESETS } from './presets.js';
import { DEVICES, deviceStages } from './devices.js';
import { advise } from './advisor.js';

const out = document.getElementById('out');
let fails = 0, warns = 0;
const row = (ok, name, detail) => {
  const li = document.createElement('li');
  li.className = ok === null ? 'warn' : ok ? 'ok' : 'bad';
  li.textContent = `${ok === null ? '⚠' : ok ? '✓' : '✗'} ${name}: ${detail}`;
  out.append(li);
  if (ok === false) fails++; if (ok === null) warns++;
};
const sine = (f, a, sr, n, ch = 2) => Array.from({ length: ch }, () => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / sr)));
const noise = (n) => Array.from({ length: 2 }, (_, c) => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((i + c * 7) * 12.9898) * 43758.5453 % 1));
const maxDiff = (A, B) => { let m = 0; A.forEach((d, c) => { for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i] - B[c][i])); }); return m; };
const run = async (name, fn) => { try { await fn(); } catch (e) { row(false, name, 'error inesperado: ' + e.message); } };

async function main() {
  out.replaceChildren(); fails = warns = 0;
  const N = 44100, SR = 44100;

  await run('Entorno', async () => {
    const brave = navigator.brave && (await navigator.brave.isBrave());
    row(true, 'Entorno', `${brave ? 'Brave' : 'navegador'} · ${location.protocol}//${location.host || '(archivo local)'}`);
    if (location.protocol === 'file:') row(null, 'Servidor', 'abriste la página como archivo local; los AudioWorklet suelen fallar así. Usá GitHub Pages o un servidor local.');
  });

  await run('WAV', async () => {
    const tol = { 16: 0.6 / 32768, 24: 0.6 / 8388608, 32: 0 };
    for (const bits of [16, 24, 32]) {
      const x = sine(441, 0.8, SR, N), w = parseWav(encodeWav(x, SR, bits));
      const d = maxDiff(x, w.channels);
      row(d <= tol[bits] && w.sampleRate === SR && w.channels.length === 2, `WAV ${bits} bits`, `escribir y volver a leer; error máximo ${d.toExponential(2)}`);
    }
  });

  await run('Medidor', async () => {
    const m = measure(sine(441, 0.5, SR, N, 1));
    row(Math.abs(m.peakDb + 6.0206) < 0.01, 'Pico', `seno de 0,5 de amplitud: esperado −6,02 dBFS, medido ${m.peakDb.toFixed(3)}`);
    row(Math.abs(m.rmsDb + 9.0309) < 0.02, 'RMS', `esperado −9,03 dBFS, medido ${m.rmsDb.toFixed(3)}`);
  });

  await run('Loudness', async () => {
    const a = 10 ** (-23 / 20), x = sine(1000, a, 48000, 48000 * 20), l = loudness(x, 48000).integrated;
    row(Math.abs(l + 23) < 0.1, 'LUFS', `seno de 1 kHz a −23 dBFS en ambos canales: esperado −23,0, medido ${l.toFixed(2)}`);
    const y = x.map((d) => { const o = new Float32Array(d.length * 2); o.set(d); return o; }), l2 = loudness(y, 48000).integrated;
    row(Math.abs(l2 + 23) < 0.1, 'LUFS con silencio', `mismo seno seguido de 20 s de silencio (la compuerta debe ignorarlo): medido ${l2.toFixed(2)}`);
    const p = truePeak(Array.from({ length: 2 }, () => Float32Array.from({ length: SR }, (_, i) => Math.sin((Math.PI * i) / 2 + Math.PI / 4))));
    row(Math.abs(20 * Math.log10(p.truePeak)) < 0.15 && p.samplePeak < 0.72, 'True peak', `onda cuyas muestras valen ±0,707 pero cuyo pico real es 0 dBTP: medido ${(20 * Math.log10(p.truePeak)).toFixed(2)} dBTP`);
    const s = stereo(sine(441, 0.5, SR, N)), t = stereo([sine(441, 0.5, SR, N, 1)[0], sine(441, 0.5, SR, N, 1)[0].map((v) => -v)]);
    row(Math.abs(s.correlation - 1) < 1e-6 && Math.abs(s.monoLossDb) < 1e-6 && Math.abs(t.correlation + 1) < 1e-6, 'Estéreo', `canales iguales: correlación ${s.correlation.toFixed(2)}, pérdida mono ${s.monoLossDb.toFixed(2)} dB; canales invertidos: correlación ${t.correlation.toFixed(2)}`);
  });

  await run('Mastering', async () => {
    const db = (v) => 20 * Math.log10(v), mid = (c) => { let s = 0; for (let i = N / 4; i < (3 * N) / 4; i++) s += c[0][i] ** 2; return Math.sqrt(s / (N / 2)); };
    const x = sine(440, 0.3, SR, N), same = master(x, SR).chs;
    row(maxDiff(x, same) === 0, 'Cadena en neutro', 'con todo en su valor inicial la señal no cambia');
    const y = sine(1000, 0.1, SR, N), e = master(y, SR, { ...DEFAULTS, lmF: 1000, lmG: 6 }).chs;
    row(Math.abs(db(mid(e) / mid(y)) - 6) < 0.1, 'Ecualizador', `+6 dB a 1 kHz: medido +${db(mid(e) / mid(y)).toFixed(2)} dB`);
    const sq = [0, 1].map(() => Float32Array.from({ length: N }, (_, i) => (Math.floor(i / 50) % 2 ? 0.5 : -0.5))), c = master(sq, SR, { ...DEFAULTS, thr: -20, ratio: 4, knee: 0, attack: 5, release: 100 }).chs;
    row(Math.abs(Math.abs(c[0][N >> 1]) - 0.149) < 0.005, 'Compresor', `onda cuadrada de 0,5, threshold −20 dB, ratio 4:1: esperado 0,149, medido ${Math.abs(c[0][N >> 1]).toFixed(3)}`);
    const loud = sine(60, 1.8, SR, N), r = master(loud, SR, { ...DEFAULTS, drive: 6, ceiling: -1 }), tp = truePeak(r.chs);
    row(db(tp.truePeak) <= -0.97, 'Limitador', `señal 15 dB por encima del máximo con techo −1: pico real medido ${db(tp.truePeak).toFixed(2)} dBTP`);
    const st = sine(1000, 0.5, SR, N, 1), sa = master(st, SR, { ...DEFAULTS, satDrive: 12, ceiling: 0 }).chs[0];
    let pk = 0; for (let i = N >> 2; i < (3 * N) >> 2; i++) pk = Math.max(pk, Math.abs(sa[i]));
    row(Math.abs(pk - Math.tanh(0.5 * 10 ** 0.6) / 10 ** 0.6) < 0.005, 'Saturación', `curva tanh a +12 dB: pico esperado 0,242, medido ${pk.toFixed(3)}`);
    const wv = [Float32Array.from({ length: N }, (_, i) => 0.4 * Math.sin(i * 0.05)), Float32Array.from({ length: N }, (_, i) => 0.4 * Math.sin(i * 0.07))], w0 = master(wv, SR, { ...DEFAULTS, width: 0 }).chs;
    row(maxDiff([w0[0]], [w0[1]]) < 1e-6, 'Ancho estéreo', 'con ancho 0 los dos canales quedan idénticos (mono)');
    const lo = sine(50, 0.3, SR, N, 1)[0], bm = master([lo, lo.map((v) => -v)], SR, { ...DEFAULTS, bassMono: 150 }).chs, side = (c) => { let s = 0; for (let i = N >> 2; i < (3 * N) >> 2; i++) s += ((c[0][i] - c[1][i]) / 2) ** 2; return Math.sqrt(s / (N / 2)); };
    const rem = side(bm) / side([lo, lo.map((v) => -v)]);
    row(rem < 0.05, 'Graves en mono', `onda de 50 Hz con canales opuestos, mono hasta 150 Hz: queda ${(rem * 100).toFixed(1)} % del lado (medido en la parte central, sin el arranque del filtro)`);
    const sig = sine(220, 0.9, SR, SR * 3); let bad = 0;
    for (const pr of PRESETS) { const r = master(sig, SR, { ...DEFAULTS, ...pr.p }); if (20 * Math.log10(truePeak(r.chs).truePeak) > DEFAULTS.ceiling + 0.05) bad++; }
    row(bad === 0, 'Presets', `${PRESETS.length} presets procesados: ${bad ? bad + ' pasan el techo' : 'todos respetan el techo de −1 dBTP'}`);
  });

  await run('Recomendaciones', async () => {
    const lim = master(sine(60, 1.8, SR, N), SR, { ...DEFAULTS, drive: 6, ceiling: -1 }).stats.lim, neutro = master(sine(440, 0.3, SR, N), SR).stats;
    row(lim.max > 3 && neutro.lim.max < 0.01 && neutro.comp.max === 0, 'Medidor de reducción', `limitador forzado: reducción máxima ${lim.max.toFixed(1)} dB; en neutro: ${neutro.lim.max.toFixed(2)} dB`);
    const ana = { lufs: -10, truePeakDb: 0.5, samplePeakDb: -0.1, crestDb: 9, clip: { runs: 0, samples: 0 }, spec: null, stereo: null };
    const ids = (o) => advise(o).map((r) => r.id).join(',');
    const a = ids({ ana, p: {}, isOrig: true }), b = ids({ ana, stats: { comp: { mean: 5, max: 10, std: 2 }, lim: { mean: 0, max: 0, std: 0 } }, p: {}, isOrig: false });
    row(a.includes('tp') && a.includes('loud') && !a.includes('comppump') && b.includes('comppump'), 'Reglas', `pico real alto y tema fuerte detectados (${a}); compresor trabajando de más detectado como bombeo (${b.includes('comppump') ? 'sí' : 'no'})`);
  });

  await run('Dispositivos', async () => {
    const lvl = async (id, chs) => {
      const o = new OfflineAudioContext(2, SR, SR), b = o.createBuffer(2, SR, SR); chs.forEach((d, c) => b.copyToChannel(d, c));
      const src = o.createBufferSource(); src.buffer = b; let last = src;
      for (const st of deviceStages(o, DEVICES.find((d) => d.id === id))) { last.connect(st.in); last = st.out; }
      last.connect(o.destination); src.start();
      const d = (await o.startRendering()).getChannelData(0); let s = 0; for (let i = SR >> 1; i < SR; i++) s += d[i] ** 2; return Math.sqrt(s / (SR >> 1));
    };
    const lo = await lvl('phone', sine(100, 0.3, SR, SR)), mid = await lvl('phone', sine(1000, 0.3, SR, SR)), r1 = 20 * Math.log10(lo / mid);
    row(r1 < -25, 'Celular', `un tono de 100 Hz sale ${r1.toFixed(1)} dB respecto de uno de 1 kHz (casi no hay graves)`);
    const s2 = sine(220, 0.3, SR, SR, 1)[0], mono = await lvl('mono', [s2, s2.map((v) => -v)]);
    row(mono < 1e-4, 'Mono', `canales en oposición de fase: nivel resultante ${mono.toExponential(1)} (se cancelan)`);
    const same = await lvl('ref', sine(440, 0.3, SR, SR)), orig = (() => { let s = 0; const d = sine(440, 0.3, SR, SR)[0]; for (let i = SR >> 1; i < SR; i++) s += d[i] ** 2; return Math.sqrt(s / (SR >> 1)); })();
    row(Math.abs(same / orig - 1) < 1e-4, 'Sin simulación', 'el perfil "sin simulación" no altera el nivel');
  });

  let readOk = true;
  await run('Lectura', async () => {
    const x = noise(N), o = new OfflineAudioContext(2, N, SR), b = o.createBuffer(2, N, SR);
    x.forEach((d, c) => b.copyToChannel(d, c));
    const d = maxDiff(x, [b.getChannelData(0), b.getChannelData(1)]);
    readOk = d === 0;
    row(readOk ? true : null, 'Lectura de audio', readOk ? 'el navegador devuelve las muestras sin cambios' : `las lecturas difieren (${d.toExponential(2)}). Brave puede agregar ruido mínimo para evitar rastreo ("farbling"). Probá con Shields desactivado para este sitio.`);

    const o2 = new OfflineAudioContext(2, N, SR), b2 = o2.createBuffer(2, N, SR);
    x.forEach((d, c) => b2.copyToChannel(d, c));
    const s = o2.createBufferSource(); s.buffer = b2; s.connect(o2.destination); s.start();
    const r = await o2.startRendering();
    const d2 = maxDiff(x, [r.getChannelData(0), r.getChannelData(1)]);
    row(d2 === 0 ? true : readOk ? false : null, 'Render sin procesar', d2 === 0 ? 'salida idéntica a la entrada' : `diferencia ${d2.toExponential(2)}` + (readOk ? ' (el grafo de audio está alterando la señal)' : ' (consistente con el punto anterior)'));
  });

  await run('Frecuencias', async () => {
    for (const sr of [44100, 48000, 96000]) {
      let c = null;
      try { c = new AudioContext({ sampleRate: sr }); row(c.sampleRate === sr, `Frecuencia ${sr} Hz`, `el navegador usa ${c.sampleRate} Hz`); }
      catch (e) { row(false, `Frecuencia ${sr} Hz`, 'no soportada: ' + e.message); }
      finally { if (c) c.close(); }
    }
  });

  await run('AudioWorklet', async () => {
    const x = noise(N), o = new OfflineAudioContext(2, N, SR);
    await o.audioWorklet.addModule('passthrough.js');
    const b = o.createBuffer(2, N, SR); x.forEach((d, c) => b.copyToChannel(d, c));
    const s = o.createBufferSource(); s.buffer = b;
    const n = new AudioWorkletNode(o, 'passthrough', { outputChannelCount: [2] });
    s.connect(n).connect(o.destination); s.start();
    const r = await o.startRendering(), d = maxDiff(x, [r.getChannelData(0), r.getChannelData(1)]);
    row(d === 0 ? true : readOk ? false : null, 'AudioWorklet', d === 0 ? 'carga y pasa el audio sin cambios (será la base del motor de mastering)' : `diferencia ${d.toExponential(2)}`);
  });

  const r = document.createElement('li');
  r.textContent = fails ? `Resultado: ${fails} prueba(s) fallaron. Pasame esta pantalla.` : warns ? `Resultado: sin fallas, con ${warns} aviso(s). Leelos.` : 'Resultado: todo correcto.';
  out.append(r);
}

document.getElementById('run').addEventListener('click', main);
main();
