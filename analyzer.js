// Análisis sobre las muestras reales. Sin DOM: se puede probar en Node y en el autotest.
import { measure } from './meter.js';

const db10 = (x) => (x > 0 ? 10 * Math.log10(x) : -Infinity);
const db20 = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const lk = (z) => -0.691 + db10(z);
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

// Filtro K de ITU-R BS.1770-4 (coeficientes calculados para cualquier frecuencia de muestreo).
function kCoefs(fs) {
  let f0 = 1681.974450955533, Q = 0.7071752369554196, K = Math.tan((Math.PI * f0) / fs);
  const Vh = 10 ** (3.999843853973347 / 20), Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const s1 = { b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan((Math.PI * f0) / fs); a0 = 1 + K / Q + K * K;
  return [s1, { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] }];
}

// Energía media (con filtro K) de cada bloque de 100 ms, sumada entre canales.
function hopEnergies(chs, fs) {
  const hop = Math.round(fs * 0.1), H = Math.floor(chs[0].length / hop), e = new Float64Array(H);
  const [s1, s2] = kCoefs(fs), [p0, p1, p2] = s1.b, [q1, q2] = s1.a, [r1, r2] = s2.a;
  for (const d of chs) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, v1 = 0, v2 = 0;
    for (let h = 0; h < H; h++) {
      let s = 0;
      for (let i = h * hop, end = i + hop; i < end; i++) {
        const x = d[i], y = p0 * x + p1 * x1 + p2 * x2 - q1 * y1 - q2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        const v = y - 2 * u1 + u2 - r1 * v1 - r2 * v2;
        u2 = u1; u1 = y; v2 = v1; v1 = v;
        s += v * v;
      }
      e[h] += s / hop;
    }
  }
  return e;
}
const blocks = (e, n) => { const o = []; for (let i = 0; i + n <= e.length; i++) { let s = 0; for (let j = 0; j < n; j++) s += e[i + j]; o.push(s / n); } return o; };
const gate = (a, rel) => { const g = a.filter((z) => lk(z) > -70); if (!g.length) return []; const t = lk(mean(g)) + rel; return g.filter((z) => lk(z) > t); };

export function loudness(chs, fs) {
  const e = hopEnergies(chs, fs), g = gate(blocks(e, 4), -10), st = blocks(e, 30).map(lk);
  const lra = gate(blocks(e, 30), -20).map(lk).sort((a, b) => a - b);
  const pct = (p) => lra[Math.round(p * (lra.length - 1))];
  return { integrated: g.length ? lk(mean(g)) : -Infinity, shortTerm: st, shortMax: st.length ? Math.max(...st) : -Infinity, lra: lra.length ? pct(0.95) - pct(0.1) : 0 };
}

// True peak: sobremuestreo 4x con interpolación sinc (12 puntos, ventana Hann).
export function truePeak(chs) {
  const T = 12, taps = [1, 2, 3].map((p) => {
    const k = Array.from({ length: T }, (_, j) => { const t = j - 5 - p / 4; return (Math.sin(Math.PI * t) / (Math.PI * t)) * (0.5 + 0.5 * Math.cos((Math.PI * t) / 6)); });
    const s = k.reduce((a, b) => a + b, 0); return k.map((v) => v / s);
  });
  let peak = 0;
  for (const d of chs) for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  let tp = peak; const thr = 0.5 * peak;
  for (const d of chs) for (let i = 5; i < d.length - 6; i++) {
    if (Math.abs(d[i]) < thr && Math.abs(d[i + 1]) < thr) continue; // solo donde puede haber picos altos
    for (const k of taps) { let s = 0; for (let j = 0; j < T; j++) s += k[j] * d[i - 5 + j]; if (Math.abs(s) > tp) tp = Math.abs(s); }
  }
  return { samplePeak: peak, truePeak: tp };
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), hl = len / 2;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < hl; k++) {
        const a = i + k, b = a + hl, vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// Espectro promedio de toda la canción (mezcla mono), en bandas de 1/3 de octava y en 6 zonas amplias.
export function spectrum(chs, fs) {
  const N = 16384, hop = 8192, n = chs[0].length;
  const w = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const pw = new Float64Array(N / 2 + 1), re = new Float64Array(N), im = new Float64Array(N);
  let frames = 0;
  for (let s = 0; s + N <= n; s += hop) {
    for (let i = 0; i < N; i++) { let m = 0; for (const d of chs) m += d[s + i]; re[i] = (m / chs.length) * w[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k <= N / 2; k++) pw[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  if (!frames) return null;
  const bin = fs / N, sum = (lo, hi) => { let s = 0; for (let k = Math.max(1, Math.ceil(lo / bin)); k <= N / 2 && k * bin < hi; k++) s += pw[k]; return s; };
  const bands = []; for (let k = -15; k <= 13; k++) { const fc = 1000 * 2 ** (k / 3); bands.push({ fc, p: sum(fc / 2 ** (1 / 6), fc * 2 ** (1 / 6)) }); }
  const mx = Math.max(...bands.map((b) => b.p)); bands.forEach((b) => (b.db = db10(b.p / mx)));
  const ed = [20, 60, 250, 500, 2000, 6000, 20000], nm = ['Subgraves (20–60 Hz)', 'Graves (60–250 Hz)', 'Medios-bajos (250–500 Hz)', 'Medios (0,5–2 kHz)', 'Presencia (2–6 kHz)', 'Agudos (6–20 kHz)'];
  const e = nm.map((_, i) => sum(ed[i], ed[i + 1])), tot = e.reduce((a, b) => a + b, 0);
  return { bands, dist: nm.map((name, i) => ({ name, pct: (100 * e[i]) / tot })) };
}

export function stereo(chs) {
  if (chs.length < 2) return null;
  const [L, R] = chs; let ll = 0, rr = 0, lr = 0, mm = 0, ss = 0;
  for (let i = 0; i < L.length; i++) { const l = L[i], r = R[i], m = (l + r) / 2, s = (l - r) / 2; ll += l * l; rr += r * r; lr += l * r; mm += m * m; ss += s * s; }
  return { correlation: ll && rr ? lr / Math.sqrt(ll * rr) : 0, sideVsMidDb: db10(ss / mm), monoLossDb: db10(mm / ((ll + rr) / 2)), balanceDb: db10(ll / rr) };
}

export function clipping(chs) {
  let samples = 0, runs = 0;
  for (const d of chs) { let run = 0; for (let i = 0; i < d.length; i++) { if (Math.abs(d[i]) >= 0.9999) { samples++; if (++run === 3) runs++; } else run = 0; } }
  return { samples, runs };
}

export function analyze(chs, fs) {
  const m = measure(chs), tp = truePeak(chs), lo = loudness(chs, fs), sp = db20(tp.samplePeak);
  return { fs, duration: chs[0].length / fs, samplePeakDb: sp, truePeakDb: db20(tp.truePeak), rmsDb: m.rmsDb, crestDb: sp - m.rmsDb,
    lufs: lo.integrated, shortTerm: lo.shortTerm, shortMaxDb: lo.shortMax, lra: lo.lra, plrDb: db20(tp.truePeak) - lo.integrated,
    spec: spectrum(chs, fs), stereo: stereo(chs), clip: clipping(chs) };
}
