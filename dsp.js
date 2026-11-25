// Cadena de mastering offline: EQ -> compresor -> saturación -> exciter -> ancho estéreo -> ganancia -> limitador.
// Funciones puras: lo que escuchás y lo que exportás sale de este mismo código.
import { truePeak } from './analyzer.js';

export const DEFAULTS = { lowF: 80, lowG: 0, lmF: 300, lmG: 0, hmF: 3000, hmG: 0, highF: 10000, highG: 0,
  thr: -18, ratio: 1, attack: 30, release: 200, knee: 6, makeup: 0, drive: 0, ceiling: -1, limRelease: 100,
  satDrive: 0, satMix: 100, excAmt: 0, excF: 4000, width: 100, bassMono: 0 };

// Coeficientes de biquad (fórmulas RBJ). type: 'low' | 'high' (shelf), 'peak'.
export function biquad(type, fs, f, g, q) {
  const A = 10 ** (g / 40), w = (2 * Math.PI * Math.min(f, fs * 0.45)) / fs, c = Math.cos(w), al = Math.sin(w) / (2 * q), r = 2 * Math.sqrt(A) * al;
  let b0, b1, b2, a0, a1, a2;
  if (type === 'peak') { b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; }
  else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === 'low') { b0 = A * (A + 1 - (A - 1) * c + r); b1 = 2 * A * (A - 1 - (A + 1) * c); b2 = A * (A + 1 - (A - 1) * c - r); a0 = A + 1 + (A - 1) * c + r; a1 = -2 * (A - 1 + (A + 1) * c); a2 = A + 1 + (A - 1) * c - r; }
  else { b0 = A * (A + 1 + (A - 1) * c + r); b1 = -2 * A * (A - 1 + (A + 1) * c); b2 = A * (A + 1 + (A - 1) * c - r); a0 = A + 1 - (A - 1) * c + r; a1 = 2 * (A - 1 - (A + 1) * c); a2 = A + 1 - (A - 1) * c - r; }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function filt(d, [b0, b1, b2, a1, a2]) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < d.length; i++) { const x = d[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y; }
}

// Compresor estéreo enlazado, detector de pico, rodilla suave, suavizado de la reducción en dB.
function compress(chs, fs, p) {
  if (p.ratio <= 1.001 && !p.makeup) return;
  const n = chs[0].length, aA = Math.exp(-1 / ((fs * p.attack) / 1000)), aR = Math.exp(-1 / ((fs * p.release) / 1000)), mk = 10 ** (p.makeup / 20), k = 1 - 1 / p.ratio, W = p.knee;
  let gr = 0;
  for (let i = 0; i < n; i++) {
    let m = 0; for (const d of chs) { const a = Math.abs(d[i]); if (a > m) m = a; }
    const o = 20 * Math.log10(m + 1e-9) - p.thr;
    const y = W > 0 && 2 * Math.abs(o) <= W ? (k * (o + W / 2) ** 2) / (2 * W) : o > 0 ? k * o : 0;
    gr = y > gr ? aA * gr + (1 - aA) * y : aR * gr + (1 - aR) * y;
    const g = 10 ** (-gr / 20) * mk;
    for (const d of chs) d[i] *= g;
  }
}

// Limitador con anticipación de 5 ms: mínimo móvil + release + promedio móvil.
// Por construcción la ganancia nunca supera la necesaria para respetar el techo en cada muestra.
function limit(chs, fs, ceilDb, relMs) {
  const n = chs[0].length, L = Math.max(2, Math.round(fs * 0.005)), c = 10 ** (ceilDb / 20), rc = Math.exp(-1 / ((fs * relMs) / 1000));
  const g = new Float32Array(n), m = new Float32Array(n), q = new Int32Array(n);
  for (let i = 0; i < n; i++) { let mx = 0; for (const d of chs) { const a = Math.abs(d[i]); if (a > mx) mx = a; } g[i] = mx > c ? c / mx : 1; }
  let h = 0, t = 0;
  for (let i = n - 1; i >= 0; i--) { // mínimo de g en [i, i+L-1]
    while (t > h && g[q[t - 1]] >= g[i]) t--;
    q[t++] = i;
    while (q[h] > i + L - 1) h++;
    m[i] = g[q[h]];
  }
  let r = 1; const rr = m; // release (r <= m siempre), luego promedio móvil de largo L
  for (let i = 0; i < n; i++) { r = m[i] < r ? m[i] : r + (m[i] - r) * (1 - rc); rr[i] = r; }
  const s = new Float32Array(n); let acc = L * rr[0]; // antes del inicio se asume el primer valor (así vale la garantía desde la muestra 0)
  for (let i = 0; i < n; i++) { acc += rr[i] - (i >= L ? rr[i - L] : rr[0]); s[i] = acc / L; }
  for (const d of chs) for (let i = 0; i < n; i++) d[i] *= s[i];
}

// tanh(g·x) con anti-aliasing por antiderivada (ADAA de 1er orden): reduce el aliasing sin sobremuestrear.
const lcosh = (x) => { const a = Math.abs(x); return a > 20 ? a - Math.LN2 : Math.log(Math.cosh(a)); };
function tanhAdaa(d, g) {
  let u1 = 0, f1 = 0;
  for (let i = 0; i < d.length; i++) {
    const u = d[i] * g, f = lcosh(u), du = u - u1;
    d[i] = Math.abs(du) < 1e-5 ? Math.tanh((u + u1) / 2) : (f - f1) / du;
    u1 = u; f1 = f;
  }
}
// Saturación: curva tanh (armónicos impares), con mezcla paralela. A nivel bajo no cambia el volumen; baja los picos.
function saturate(chs, p) {
  if (p.satDrive < 0.05 || p.satMix < 0.5) return;
  const g = 10 ** (p.satDrive / 20), mx = p.satMix / 100;
  for (const d of chs) { const w = Float64Array.from(d); tanhAdaa(w, g); for (let i = 0; i < d.length; i++) d[i] = (1 - mx) * d[i] + (mx * w[i]) / g; }
}
// Exciter: filtra agudos, los satura y los suma. A nivel bajo se comporta como un realce de agudos; en los picos agrega armónicos.
function excite(chs, fs, p) {
  if (p.excAmt < 0.5) return;
  const co = biquad('hp', fs, p.excF, 0, 0.7071), a = (0.5 * p.excAmt) / 100, g = 8;
  for (const d of chs) { const e = Float64Array.from(d); filt(e, co); tanhAdaa(e, g); for (let i = 0; i < d.length; i++) d[i] += (a * e[i]) / g; }
}
// Ancho estéreo (mid/side) y graves en mono (quita el "lado" por debajo de bassMono Hz).
function widen(chs, fs, p) {
  if (chs.length < 2 || (p.width === 100 && !p.bassMono)) return;
  const [L, R] = chs, n = L.length, w = p.width / 100, s = new Float64Array(n);
  for (let i = 0; i < n; i++) s[i] = (L[i] - R[i]) / 2;
  if (p.bassMono > 0) { const co = biquad('hp', fs, p.bassMono, 0, 0.7071); filt(s, co); filt(s, co); } // filtro de 4.º orden (Linkwitz-Riley) sobre el lado
  for (let i = 0; i < n; i++) { const m = (L[i] + R[i]) / 2; L[i] = m + s[i] * w; R[i] = m - s[i] * w; }
}

// chs: array de Float32Array (no se modifica). Devuelve { chs, ceilingUsed }.
export function master(chs, fs, p = DEFAULTS) {
  const x = chs.map((d) => Float64Array.from(d));
  const bands = [['low', p.lowF, p.lowG, 0.7], ['peak', p.lmF, p.lmG, 1], ['peak', p.hmF, p.hmG, 1], ['high', p.highF, p.highG, 0.7]];
  for (const [t, f, g, q] of bands) if (Math.abs(g) > 0.01) { const co = biquad(t, fs, f, g, q); for (const d of x) filt(d, co); }
  compress(x, fs, p); saturate(x, p); excite(x, fs, p); widen(x, fs, p);
  const dr = 10 ** (p.drive / 20); if (dr !== 1) for (const d of x) for (let i = 0; i < d.length; i++) d[i] *= dr;
  let ceil = p.ceiling, out;
  for (let k = 0; k < 4; k++) { // el limitador respeta picos de muestra; se mide el true peak y se corrige si hace falta
    out = x.map((d) => Float32Array.from(d));
    limit(out, fs, ceil, p.limRelease);
    const tp = 20 * Math.log10(truePeak(out).truePeak);
    if (tp <= p.ceiling + 0.02) break;
    ceil -= tp - p.ceiling + 0.01;
  }
  return { chs: out, ceilingUsed: ceil };
}
