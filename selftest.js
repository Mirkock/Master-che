import { parseWav, encodeWav } from './wav.js';
import { measure } from './meter.js';

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
    await o.audioWorklet.addModule('js/worklets/passthrough.js');
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
