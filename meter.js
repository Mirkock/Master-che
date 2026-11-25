export const toDb = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

// chs: array de Float32Array (uno por canal). No modifica los datos.
export function measure(chs) {
  let peak = 0, sum = 0, clipped = 0;
  for (const d of chs) for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]);
    if (a > peak) peak = a;
    if (a >= 0.9999) clipped++;
    sum += d[i] * d[i];
  }
  const n = chs.length * chs[0].length;
  return { peakDb: toDb(peak), rmsDb: toDb(Math.sqrt(sum / n)), clipped };
}
