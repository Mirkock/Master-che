// Lectura/escritura de WAV propia: no depende de decodeAudioData ni de lecturas del navegador.
export function parseWav(buf) {
  const v = new DataView(buf);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (buf.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('No es un WAV válido');
  let fmt = null, dataOff = -1, dataLen = 0, o = 12;
  while (o + 8 <= buf.byteLength) {
    const id = tag(o), len = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      fmt = { t: v.getUint16(o + 8, true), ch: v.getUint16(o + 10, true), sr: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
      if (fmt.t === 0xfffe && len >= 26) fmt.t = v.getUint16(o + 32, true); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === 'data') {
      dataOff = o + 8; dataLen = Math.min(len, buf.byteLength - dataOff); break;
    }
    o += 8 + len + (len & 1);
  }
  if (!fmt || dataOff < 0) throw new Error('WAV incompleto');
  const { t, ch, sr, bits } = fmt;
  if (!((t === 1 && [16, 24, 32].includes(bits)) || (t === 3 && [32, 64].includes(bits))))
    throw new Error(`Formato WAV no soportado (tipo ${t}, ${bits} bits)`);
  const bps = bits / 8, n = Math.floor(dataLen / (bps * ch));
  const data = Array.from({ length: ch }, () => new Float32Array(n));
  let p = dataOff;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++, p += bps) {
    let x;
    if (t === 3) x = bits === 32 ? v.getFloat32(p, true) : v.getFloat64(p, true);
    else if (bits === 16) x = v.getInt16(p, true) / 32768;
    else if (bits === 24) x = (v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16)) / 8388608;
    else x = v.getInt32(p, true) / 2147483648;
    data[c][i] = x;
  }
  return { sampleRate: sr, bits, isFloat: t === 3, channels: data };
}

// bits: 16, 24 (enteros) o 32 (float). dither: ruido TPDF de ±1 LSB, solo en 16 bits.
export function encodeWav(chs, sr, bits = 24, dither = false) {
  const ch = chs.length, n = chs[0].length, bps = bits / 8, size = n * ch * bps;
  const buf = new ArrayBuffer(44 + size), v = new DataView(buf);
  const s = (o, str) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  s(0, 'RIFF'); v.setUint32(4, 36 + size, true); s(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * bps, true); v.setUint16(32, ch * bps, true); v.setUint16(34, bits, true);
  s(36, 'data'); v.setUint32(40, size, true);
  let p = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++, p += bps) {
    const x = chs[c][i];
    if (bits === 32) { v.setFloat32(p, x, true); continue; }
    const m = bits === 16 ? 32768 : 8388608, d = dither && bits === 16 ? Math.random() - Math.random() : 0, q = Math.max(-m, Math.min(m - 1, Math.round(x * m + d)));
    if (bits === 16) v.setInt16(p, q, true);
    else { v.setUint8(p, q & 255); v.setUint8(p + 1, (q >> 8) & 255); v.setUint8(p + 2, (q >> 16) & 255); }
  }
  return buf;
}
