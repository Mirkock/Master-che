// Exportación a MP3 con lamejs. Requiere el archivo lame.min.js en el mismo repositorio (se carga solo al exportar MP3).
const RATES = [32000, 44100, 48000];
function loadLame() {
  if (window.lamejs) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'lame.min.js';
    s.onload = () => (window.lamejs ? res() : rej(new Error('No se pudo iniciar lame.min.js.')));
    s.onerror = () => rej(new Error('Falta el archivo lame.min.js en tu repositorio. Descargalo de https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js y subilo junto a los demás archivos (en la página de Tips están los pasos).'));
    document.head.append(s);
  });
}
const i16 = (f) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const x = Math.max(-1, Math.min(1, f[i])); o[i] = x < 0 ? x * 32768 : x * 32767; } return o; };
const copy = (b) => { const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b[i] & 255; return u; };

// chs: canales Float32; kbps: 128, 192 o 320. Devuelve un Blob audio/mpeg.
export async function encodeMp3(chs, sr, kbps, onProgress = () => {}) {
  if (!RATES.includes(sr)) throw new Error(`MP3 solo admite 32, 44,1 y 48 kHz (este archivo es de ${sr} Hz). Exportá en WAV.`);
  await loadLame();
  const ch = Math.min(2, chs.length), enc = new window.lamejs.Mp3Encoder(ch, sr, kbps), parts = [], N = chs[0].length, B = 1152 * 20;
  for (let i = 0; i < N; i += B) {
    const l = i16(chs[0].subarray(i, i + B)), r = ch === 2 ? i16(chs[1].subarray(i, i + B)) : null;
    for (let j = 0; j < l.length; j += 1152) {
      const buf = ch === 2 ? enc.encodeBuffer(l.subarray(j, j + 1152), r.subarray(j, j + 1152)) : enc.encodeBuffer(l.subarray(j, j + 1152));
      if (buf.length) parts.push(copy(buf));
    }
    onProgress(i / N); await new Promise((x) => setTimeout(x)); // cede el control para que la página no se congele
  }
  const end = enc.flush(); if (end.length) parts.push(copy(end));
  return new Blob(parts, { type: 'audio/mpeg' });
}
