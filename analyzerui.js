const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const f = (x, u = '', d = 1) => (x === Infinity || x === -Infinity || Number.isNaN(x) ? '—' : x.toFixed(d) + u);
const hz = (x) => (x >= 1000 ? +(x / 1000).toFixed(1) + ' k' : String(Math.round(x)));

export function renderAnalysis(a, root) {
  root.replaceChildren();
  const add = (tag, text, cls) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; root.append(e); return e; };
  const canvas = (h) => {
    const c = add('canvas'); c.style.cssText = `width:100%;height:${h}px;display:block;border-radius:4px;background:${css('--bg2')}`;
    const r = devicePixelRatio || 1; c.width = c.clientWidth * r; c.height = h * r;
    const g = c.getContext('2d'); g.scale(r, r); g.font = '12px system-ui'; return [g, c.clientWidth, h];
  };
  const st = a.stereo;
  const groups = [
    ['Volumen', [
      ['LUFS integrado', f(a.lufs, ' LUFS'), 'Volumen percibido promedio de toda la canción (norma ITU-R BS.1770). Lo que usan las plataformas para normalizar.'],
      ['LUFS corto plazo (máximo)', f(a.shortMaxDb, ' LUFS'), 'El tramo de 3 segundos más fuerte de la canción.'],
      ['Rango de volumen (LRA)', f(a.lra, ' LU'), 'Cuánto varía el volumen entre partes suaves y fuertes. Más bajo = más parejo.'],
    ]],
    ['Picos y dinámica', [
      ['Pico de muestra', f(a.samplePeakDb, ' dBFS', 2), 'La muestra digital más alta. 0 dBFS es el máximo posible.'],
      ['Pico real (true peak)', f(a.truePeakDb, ' dBTP', 2), 'El pico de la onda reconstruida, que puede superar al de las muestras. Si pasa de 0 dBTP puede distorsionar al convertir a MP3 o a analógico.'],
      ['RMS', f(a.rmsDb, ' dBFS', 2), 'Nivel medio de la señal, sin ponderar por cómo oye el oído.'],
      ['Factor de cresta', f(a.crestDb, ' dB'), 'Diferencia entre pico y RMS. Más bajo = más comprimida.'],
      ['PLR (pico real − LUFS)', f(a.plrDb, ' dB'), 'Diferencia entre el pico real y el volumen percibido. Otra forma de ver cuánta dinámica queda.'],
    ]],
    ['Clipping', [
      ['Muestras en el tope', String(a.clip.samples), 'Muestras que tocan el máximo digital.'],
      ['Tramos de clipping', String(a.clip.runs), 'Veces que hay 3 o más muestras seguidas en el tope: señal de recorte real.'],
    ]],
  ];
  if (st) groups.push(['Estéreo', [
    ['Correlación L/R', f(st.correlation, '', 2), '+1: ambos canales iguales (mono). 0: independientes. Negativa: tienden a cancelarse en mono.'],
    ['Pérdida al pasar a mono', f(st.monoLossDb, ' dB'), '0 dB: no se pierde nada. Valores muy negativos: hay contenido que se cancela al sumar los canales.'],
    ['Lado vs. centro', f(st.sideVsMidDb, ' dB'), 'Cuánta energía hay en lo "ancho" (lado) comparado con lo central. Más cerca de 0 = más ancho.'],
    ['Balance izquierda/derecha', f(st.balanceDb, ' dB'), 'Positivo: más fuerte a la izquierda. Negativo: a la derecha.'],
  ]]);
  add('h2', 'Análisis');
  for (const [title, rows] of groups) {
    add('h3', title);
    const dl = add('dl');
    for (const [k, v, hint] of rows) {
      const dt = document.createElement('dt'), dd = document.createElement('dd'), s = document.createElement('small');
      dt.textContent = k; dd.textContent = v + ' '; s.textContent = hint; s.className = 'hint'; dd.append(s); dl.append(dt, dd);
    }
  }

  // Volumen a lo largo del tiempo
  add('h3', 'Volumen de corto plazo a lo largo de la canción');
  if (a.shortTerm.length > 1) {
    const [g, W, H] = canvas(150), ys = a.shortTerm.filter(isFinite), lo = Math.floor(Math.min(...ys) / 5) * 5, hi = Math.ceil(Math.max(...ys) / 5) * 5 + 2;
    const X = (i) => (i / (a.shortTerm.length - 1)) * (W - 40) + 36, Y = (v) => H - 14 - ((Math.max(v, lo) - lo) / (hi - lo)) * (H - 24);
    g.fillStyle = css('--muted'); g.fillText(hi + '', 2, 12); g.fillText(lo + ' LUFS', 2, H - 2);
    if (isFinite(a.lufs)) { g.strokeStyle = css('--accent2'); g.setLineDash([4, 4]); g.beginPath(); g.moveTo(36, Y(a.lufs)); g.lineTo(W, Y(a.lufs)); g.stroke(); g.setLineDash([]); }
    g.strokeStyle = css('--accent'); g.beginPath(); a.shortTerm.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); g.stroke();
    add('small', 'Línea verde: volumen en ventanas de 3 s. Línea punteada: LUFS integrado.', 'hint');
  } else add('small', 'La canción es muy corta para calcular volumen de corto plazo.', 'hint');

  // Espectro
  if (a.spec) {
    add('h3', 'Espectro promedio (bandas de 1/3 de octava)');
    const [g, W, H] = canvas(170), b = a.spec.bands, bw = (W - 10) / b.length;
    b.forEach((x, i) => { const h = ((Math.max(x.db, -60) + 60) / 60) * (H - 22); g.fillStyle = css('--accent'); g.fillRect(5 + i * bw, H - 16 - h, bw - 2, h); });
    g.fillStyle = css('--muted');
    b.forEach((x, i) => { if (i % 4 === 1) g.fillText(hz(x.fc), 5 + i * bw, H - 3); });
    add('small', 'Niveles relativos a la banda más fuerte (0 dB arriba, −60 dB abajo). Mide la mezcla mono; con pocos bajos profundos las bandas más graves tienen menos resolución.', 'hint');
    add('h3', 'Distribución de energía');
    for (const d of a.spec.dist) {
      const row = add('div', '', 'bar'), lab = document.createElement('span'), fill = document.createElement('i'), val = document.createElement('b');
      lab.textContent = d.name; fill.style.width = Math.max(d.pct, 0.3) + '%'; val.textContent = f(d.pct, ' %');
      row.append(lab, fill, val);
    }
    add('small', 'Porcentaje de la energía total en cada zona. En casi toda la música, los graves concentran la mayor parte de la energía: esto no es bueno ni malo por sí solo, depende del género.', 'hint');
  } else add('small', 'La canción es muy corta para calcular el espectro.', 'hint');
}
