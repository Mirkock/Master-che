import { master, DEFAULTS } from './dsp.js';
import { analyze } from './analyzer.js';
import { encodeWav } from './wav.js';

// [clave, etiqueta, mín, máx, paso, unidad, ayuda]
const GROUPS = [
  ['Ecualizador', [
    ['lowF', 'Graves: frecuencia', 30, 300, 1, 'Hz', 'Hasta dónde llega el control de graves (realce o corte tipo "estante").'],
    ['lowG', 'Graves: ganancia', -12, 12, 0.5, 'dB', 'Positivo sube los graves, negativo los baja.'],
    ['lmF', 'Medios-bajos: frecuencia', 100, 1000, 1, 'Hz', 'Zona del "cuerpo" o "barro" de la mezcla.'],
    ['lmG', 'Medios-bajos: ganancia', -12, 12, 0.5, 'dB', 'Bajarlo suele limpiar mezclas turbias.'],
    ['hmF', 'Medios-altos: frecuencia', 1000, 8000, 10, 'Hz', 'Zona de la presencia de la voz.'],
    ['hmG', 'Medios-altos: ganancia', -12, 12, 0.5, 'dB', 'Subirlo acerca la voz; demasiado se vuelve áspero.'],
    ['highF', 'Agudos: frecuencia', 4000, 16000, 50, 'Hz', 'Desde dónde empiezan los agudos ("aire").'],
    ['highG', 'Agudos: ganancia', -12, 12, 0.5, 'dB', 'Positivo da brillo, negativo lo apaga.'],
  ]],
  ['Compresor', [
    ['thr', 'Threshold', -40, 0, 0.5, 'dB', 'Nivel desde el que empieza a actuar.'],
    ['ratio', 'Ratio', 1, 10, 0.1, ':1', 'Cuánto se reduce lo que pasa el threshold. 1 = el compresor no actúa.'],
    ['attack', 'Attack', 1, 100, 1, 'ms', 'Qué tan rápido reacciona. Lento deja pasar los golpes (más pegada).'],
    ['release', 'Release', 20, 1000, 10, 'ms', 'Qué tan rápido suelta. Muy corto puede "bombear".'],
    ['knee', 'Knee', 0, 12, 1, 'dB', 'Suavidad con la que entra la compresión.'],
    ['makeup', 'Ganancia de compensación', 0, 12, 0.5, 'dB', 'Sube el volumen después de comprimir.'],
  ]],
  ['Limitador y nivel de salida', [
    ['drive', 'Ganancia de entrada al limitador', 0, 12, 0.5, 'dB', 'Más ganancia = más fuerte, pero con más limitación y menos dinámica.'],
    ['ceiling', 'Techo (ceiling)', -3, 0, 0.1, 'dBTP', 'El pico real máximo permitido. −1 deja margen de seguridad para MP3 y streaming.'],
    ['limRelease', 'Release del limitador', 10, 500, 5, 'ms', 'Muy corto puede distorsionar los graves.'],
  ]],
];

export function initMastering(api) {
  const root = document.getElementById('mastering'), P = { ...DEFAULTS };
  let masterChs = null, ana = null, cur = 'orig';
  const mk = (tag, text, cls, parent = root) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; parent.append(e); return e; };

  function build() {
    root.replaceChildren(); masterChs = null; cur = 'orig';
    mk('h2', 'Mastering');
    mk('small', 'Con todo en su valor inicial la canción solo pasa por el limitador. Ajustá lo que quieras y apretá "Procesar". El original no se modifica.', 'hint');
    for (const [title, rows] of GROUPS) {
      mk('h3', title);
      for (const [k, label, min, max, step, unit, hint] of rows) {
        const row = mk('div', '', 'ctl'), lab = mk('label', label, '', row), inp = mk('input', '', '', row), val = mk('b', '', '', row);
        Object.assign(inp, { type: 'range', min, max, step, value: P[k] }); inp.title = hint; lab.title = hint;
        const show = () => (val.textContent = `${(+inp.value).toFixed(step < 1 ? 1 : 0)} ${unit}`);
        inp.addEventListener('input', () => { P[k] = +inp.value; show(); status.textContent = 'Hay cambios sin procesar.'; }); show();
      }
    }
    const bar = mk('div', '', 'bar2');
    const go = mk('button', 'Procesar', '', bar), reset = mk('button', 'Valores iniciales', 'sec', bar), status = mk('span', '', 'hint', bar);
    go.type = reset.type = 'button';
    const res = mk('div', '', 'res'); res.hidden = true;
    go.addEventListener('click', async () => {
      go.disabled = true; status.textContent = 'Procesando…'; await new Promise((r) => setTimeout(r, 30));
      try {
        const sr = api.getSr(), out = master(api.getChs(), sr, P);
        masterChs = out.chs; ana = analyze(masterChs, sr); api.setMaster(masterChs, sr);
        status.textContent = out.ceilingUsed < P.ceiling - 0.05 ? `Listo. Para no pasar el techo, el limitador trabajó con un techo interno de ${out.ceilingUsed.toFixed(1)} dB.` : 'Listo.';
        results(res);
      } catch (e) { status.textContent = 'Error: ' + e.message; }
      go.disabled = false;
    });
    reset.addEventListener('click', () => { Object.assign(P, DEFAULTS); build(); });
  }

  function results(res) {
    res.hidden = false; res.replaceChildren();
    mk('h3', 'Escuchar y comparar', '', res);
    const row = mk('div', '', 'bar2', res), bo = mk('button', 'Original', '', row), bm = mk('button', 'Master', 'sec', row);
    const lab = mk('label', '', 'chk', row), cb = mk('input', '', '', lab); cb.type = 'checkbox'; cb.checked = true; lab.append(' Igualar volumen al comparar');
    bo.type = bm.type = 'button';
    const o = api.getOrig(), m = ana, d = m.lufs - o.lufs, note = mk('small', '', 'hint', res);
    const pick = (w) => { cur = w; bo.className = w === 'orig' ? '' : 'sec'; bm.className = w === 'master' ? '' : 'sec'; api.use(w); };
    const trims = () => {
      const on = cb.checked && isFinite(d); api.setTrims(on && d < 0 ? 10 ** (d / 20) : 1, on && d > 0 ? 10 ** (-d / 20) : 1);
      note.textContent = on ? `Volumen igualado: se baja ${Math.abs(d).toFixed(1)} dB la versión ${d > 0 ? 'master' : 'original'} para que la diferencia no engañe.` : 'Volumen sin igualar: la versión más fuerte puede parecer mejor sin serlo.';
      api.use(cur);
    };
    bo.addEventListener('click', () => pick('orig')); bm.addEventListener('click', () => pick('master')); cb.addEventListener('change', trims);
    pick('master'); trims();

    mk('h3', 'Antes y después', '', res);
    const t = mk('table', '', 'cmp', res), r0 = mk('tr', '', '', t);
    for (const h of ['', 'Original', 'Master', 'Cambio']) mk('th', h, '', r0);
    for (const [name, key, u, dd] of [['LUFS integrado', 'lufs', ' LUFS', 1], ['True peak', 'truePeakDb', ' dBTP', 2], ['Pico de muestra', 'samplePeakDb', ' dBFS', 2], ['RMS', 'rmsDb', ' dBFS', 1], ['Factor de cresta', 'crestDb', ' dB', 1], ['Rango de volumen (LRA)', 'lra', ' LU', 1]]) {
      const r = mk('tr', '', '', t), f = (x) => (isFinite(x) ? x.toFixed(dd) + u : '—'), c = m[key] - o[key];
      mk('td', name, '', r); mk('td', f(o[key]), '', r); mk('td', f(m[key]), '', r); mk('td', isFinite(c) ? (c > 0 ? '+' : '') + c.toFixed(dd) : '—', '', r);
    }
    mk('h3', 'Exportar', '', res);
    const ex = mk('div', '', 'bar2', res), sel = mk('select', '', '', ex);
    for (const [v, l] of [[24, 'WAV 24 bits'], [16, 'WAV 16 bits (con dither)'], [32, 'WAV 32 bits float']]) { const op = mk('option', l, '', sel); op.value = v; }
    const dl = mk('button', 'Descargar master', '', ex); dl.type = 'button';
    mk('small', 'Se exporta a la misma frecuencia de muestreo del original. Con 16 bits se agrega dither para evitar distorsión de cuantización; si el techo está en 0 dB eso puede rozar el máximo, por eso conviene dejar −1 dB.', 'hint', res);
    dl.addEventListener('click', () => {
      const bits = +sel.value, buf = encodeWav(masterChs, api.getSr(), bits, bits === 16), a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
      a.download = api.getName().replace(/\.[^.]+$/, '') + `_MasterChe_${bits}${bits === 32 ? 'f' : ''}.wav`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 8000);
    });
  }

  build();
  return { reset: build };
}
