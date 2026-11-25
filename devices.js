// Perfiles APROXIMADOS de dispositivos. No son mediciones de modelos concretos: sirven para detectar problemas de
// traducción de la mezcla (graves que desaparecen, voz que se pierde, cancelaciones en mono), no para predecir
// cómo suena un aparato en particular. Cada filtro: [tipo, frecuencia Hz, ganancia dB, Q].
// En pasa-altos y pasa-bajos de Web Audio la Q va en dB: -3,01 equivale a Butterworth (sin resonancia).
const HP = (f) => ['highpass', f, 0, -3.01], LP = (f) => ['lowpass', f, 0, -3.01];

export const DEVICES = [
  { id: 'ref', name: 'Sin simulación', note: 'Sonido directo, sin ningún perfil de dispositivo.', f: [] },
  { id: 'phone', name: 'Celular (altavoz)', mono: true, drive: 2.5,
    note: 'Altavoz mono diminuto: casi no reproduce por debajo de ~300 Hz, realza 1–4 kHz y distorsiona un poco con graves fuertes. Si la voz y el ritmo siguen claros acá, se traducen bien.',
    f: [HP(320), HP(320), ['peaking', 1800, 4, 1], ['peaking', 3500, 3, 1.2], LP(9000)] },
  { id: 'tv', name: 'Televisor', width: 0.5, drive: 1,
    note: 'Parlantes chicos: poco bajo por debajo de ~110 Hz, medios algo huecos y estéreo más angosto.',
    f: [HP(110), HP(110), ['peaking', 400, -3, 1], ['peaking', 2500, 2, 1], LP(12000)] },
  { id: 'car', name: 'Auto',
    note: 'Cabina con graves y agudos realzados y medios algo hundidos. Aproximación genérica: cada auto es distinto y el ruido de ruta no está simulado.',
    f: [['lowshelf', 80, 5, 0.7], ['peaking', 600, -3, 0.8], ['highshelf', 6000, 3, 0.7], LP(15000)] },
  { id: 'buds', name: 'Auriculares económicos',
    note: 'Auriculares baratos típicos: graves realzados, pico en 3–4 kHz y agudos recortados.',
    f: [['lowshelf', 120, 4, 0.7], ['peaking', 3500, 3, 1.5], ['highshelf', 9000, -4, 0.7]] },
  { id: 'home', name: 'Parlantes de casa',
    note: 'Estéreo convencional: graves hasta ~50 Hz y agudos apenas suavizados, como monitores de escritorio chicos.',
    f: [HP(50), HP(50), ['highshelf', 10000, -2, 0.7]] },
  { id: 'bt', name: 'Parlante Bluetooth', width: 0.3, drive: 2,
    note: 'Parlante portátil: graves limitados por debajo de ~90 Hz con un realce cerca de 150 Hz, estéreo casi mono y algo de compresión/distorsión.',
    f: [HP(90), HP(90), ['peaking', 150, 3, 1.5], LP(12000)] },
  { id: 'mono', name: 'Mono (suma L+R)', mono: true,
    note: 'Suma los dos canales. Si algo se apaga o desaparece, hay cancelación de fase y ese elemento se perdería en equipos mono.', f: [] },
];

// Devuelve etapas en serie: [{ in, out, all }]. ctx puede ser AudioContext u OfflineAudioContext.
export function deviceStages(ctx, d) {
  const st = [], one = (n) => st.push({ in: n, out: n, all: [n] });
  if (d.mono) { const g = ctx.createGain(); g.channelCount = 1; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers'; one(g); }
  if (d.width !== undefined && d.width < 1) {
    const sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2), a = (1 + d.width) / 2, b = (1 - d.width) / 2, all = [sp, mg];
    for (const [i, o, v] of [[0, 0, a], [1, 0, b], [1, 1, a], [0, 1, b]]) { const g = ctx.createGain(); g.gain.value = v; sp.connect(g, i); g.connect(mg, 0, o); all.push(g); }
    st.push({ in: sp, out: mg, all });
  }
  for (const [type, f, gain, q] of d.f) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.gain.value = gain; b.Q.value = q; one(b); }
  if (d.drive) {
    const w = ctx.createWaveShaper(), c = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) c[i] = Math.tanh((d.drive * (i / 1023.5 - 1))) / d.drive;
    w.curve = c; w.oversample = '2x'; one(w);
  }
  return st;
}
