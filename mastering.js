import { master, DEFAULTS } from './dsp.js';
import { PRESETS } from './presets.js';
import { DEVICES, deviceStages } from './devices.js';
import { analyze, loudness } from './analyzer.js';
import { advise } from './advisor.js';
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
  ['Saturación', [
    ['satDrive', 'Cantidad', 0, 18, 0.5, 'dB', 'Redondea y densifica agregando armónicos; también baja los picos. 0 = apagada.'],
    ['satMix', 'Mezcla', 0, 100, 1, '%', 'Cuánto del sonido saturado se mezcla con el original.'],
  ]],
  ['Exciter', [
    ['excAmt', 'Cantidad', 0, 100, 1, '%', 'Agrega brillo y armónicos en los agudos. 0 = apagado.'],
    ['excF', 'Desde qué frecuencia', 2000, 12000, 50, 'Hz', 'Solo se excita lo que está por encima de esta frecuencia.'],
  ]],
  ['Estéreo', [
    ['width', 'Ancho', 0, 200, 1, '%', '100 = sin cambios. 0 = mono. Más de 100 ensancha, pero puede restar compatibilidad mono.'],
    ['bassMono', 'Graves en mono hasta', 0, 250, 5, 'Hz', 'Pasa a mono todo lo que está por debajo de esta frecuencia (0 = apagado). Ayuda en parlantes chicos.'],
  ]],
];
const RANGE = Object.fromEntries(GROUPS.flatMap(([, r]) => r.map(([k, , lo, hi]) => [k, [lo, hi]])));
const clean = (p) => { const o = {}; for (const k of Object.keys(DEFAULTS)) { const v = Number(p?.[k]); if (p?.[k] !== undefined && Number.isFinite(v)) o[k] = Math.min(RANGE[k][1], Math.max(RANGE[k][0], v)); } return o; };
const store = {
  load() { try { return JSON.parse(localStorage.getItem('masterche.presets')) || []; } catch { return []; } },
  save(a) { try { localStorage.setItem('masterche.presets', JSON.stringify(a)); return true; } catch { return false; } },
};
const find = (id) => (id.startsWith('u:') ? store.load().find((u) => 'u:' + u.name === id) : PRESETS.find((x) => 'b:' + x.name === id));

export const MAX_VERSIONS = 6;

export function initMastering(api) {
  const ctlRoot = document.getElementById('mastering'), cmpRoot = document.getElementById('compare'), P = { ...DEFAULTS };
  let sel = '', versions = [], counter = 0, cur = 'orig', matchOn = true, devId = 'ref', probe = { on: false, mode: 'boost', hz: 1000 }, devCache = {}, measuring = false;
  const mk = (tag, text, cls, parent = ctlRoot) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; parent.append(e); return e; };
  const f1 = (x) => (isFinite(x) ? x.toFixed(1) : '—');
  const mc = (tag, text, cls, parent = cmpRoot) => mk(tag, text, cls, parent);

  function presetBar() {
    mk('h3', 'Presets');
    const bar = mk('div', '', 'bar2'), pre = mk('select', '', '', bar), o0 = mk('option', '— Valores propios —', '', pre); o0.value = '';
    const mine = store.load();
    if (mine.length) { const g = mk('optgroup', '', '', pre); g.label = 'Mis presets'; for (const u of mine) mk('option', u.name, '', g).value = 'u:' + u.name; }
    for (const cat of [...new Set(PRESETS.map((x) => x.cat))]) { const g = mk('optgroup', '', '', pre); g.label = cat; for (const x of PRESETS.filter((y) => y.cat === cat)) mk('option', x.name, '', g).value = 'b:' + x.name; }
    pre.value = sel;
    pre.addEventListener('change', () => { sel = pre.value; if (sel) Object.assign(P, DEFAULTS, clean(find(sel).p)); build(); });
    const f = sel && find(sel); mk('small', f ? f.why || 'Preset propio.' : 'Ajustá los controles a gusto y guardalos como preset propio.', 'hint');
    const bar2 = mk('div', '', 'bar2'), isU = sel.startsWith('u:'), uname = sel.slice(2);
    const btn = (t, fn, on = true) => { const b = mk('button', t, 'sec', bar2); b.type = 'button'; b.disabled = !on; b.addEventListener('click', fn); };
    const put = (name, p, old) => { const a = store.load().filter((u) => u.name !== name && u.name !== old); a.push({ name, p }); return store.save(a); };
    const ask = (msg, def) => (prompt(msg, def) || '').trim();
    const taken = (n) => store.load().some((u) => u.name === n);
    const noStore = () => alert('El navegador no permite guardar presets (almacenamiento bloqueado). Probá con otro navegador o sin modo privado.');
    btn('Guardar como…', () => { const n = ask('Nombre del preset:', isU ? uname + ' copia' : ''); if (!n || (taken(n) && !confirm(`Ya existe "${n}". ¿Reemplazarlo?`))) return; if (put(n, clean(P))) { sel = 'u:' + n; build(); } else noStore(); });
    btn('Guardar cambios', () => { if (put(uname, clean(P))) build(); else noStore(); }, isU);
    btn('Renombrar', () => { const n = ask('Nuevo nombre:', uname); if (!n || n === uname || (taken(n) && !confirm(`Ya existe "${n}". ¿Reemplazarlo?`))) return; if (put(n, clean(find(sel).p), uname)) { sel = 'u:' + n; build(); } else noStore(); }, isU);
    btn('Eliminar', () => { if (confirm(`¿Eliminar el preset "${uname}"?`)) { store.save(store.load().filter((u) => u.name !== uname)); sel = ''; build(); } }, isU);
    btn('Exportar mis presets', () => {
      if (!store.load().length) return alert('Todavía no tenés presets propios.');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(store.load(), null, 1)], { type: 'application/json' })); a.download = 'MasterChe_presets.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 8000);
    });
    const imp = document.createElement('input'); imp.type = 'file'; imp.accept = '.json,application/json'; imp.hidden = true;
    imp.addEventListener('change', async () => {
      try {
        const arr = JSON.parse(await imp.files[0].text()); let n = 0, a = store.load();
        for (const u of Array.isArray(arr) ? arr : []) if (typeof u?.name === 'string' && u.name.trim() && typeof u.p === 'object') { a = a.filter((x) => x.name !== u.name.trim()); a.push({ name: u.name.trim().slice(0, 60), p: clean(u.p) }); n++; }
        if (!store.save(a)) return noStore();
        alert(`Se importaron ${n} preset(s).`); build();
      } catch { alert('El archivo no es válido.'); }
    });
    btn('Importar presets', () => imp.click()); bar2.append(imp);
  }

  function build() {
    ctlRoot.replaceChildren();
    mk('h2', 'Mastering');
    presetBar();
    mk('small', 'Con todo en su valor inicial la canción solo pasa por el limitador. Elegí un preset o ajustá a mano y apretá "Procesar". Cada vez que procesás se guarda una versión nueva para comparar (arriba, en "Escuchar y comparar").', 'hint');
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
    go.addEventListener('click', async () => {
      go.disabled = true; status.textContent = 'Procesando…'; await new Promise((r) => setTimeout(r, 30));
      try {
        const sr = api.getSr(), out = master(api.getChs(), sr, P), ana = analyze(out.chs, sr), f = sel && find(sel);
        const same = f && Object.keys(DEFAULTS).every((k) => ({ ...DEFAULTS, ...clean(f.p) })[k] === P[k]);
        const n = ++counter;
        versions.push({ id: 'v' + n, n, label: `V${n} · ${f ? f.name + (same ? '' : ' (modificado)') : 'valores propios'}`, chs: out.chs, ana, stats: out.stats, p: { ...P } });
        let dropped = '';
        if (versions.length > MAX_VERSIONS) dropped = ` Se descartó ${versions.shift().label.split(' ·')[0]} para no llenar la memoria.`;
        cur = 'v' + n; listen(); renderCompare();
        status.textContent = (out.ceilingUsed < P.ceiling - 0.05 ? `Listo (V${n}). El limitador trabajó con un techo interno de ${out.ceilingUsed.toFixed(1)} dB para no pasar el techo.` : `Listo (V${n}).`) + dropped;
        cmpRoot.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) { status.textContent = 'Error: ' + e.message; }
      go.disabled = false;
    });
    reset.addEventListener('click', () => { Object.assign(P, DEFAULTS); sel = ''; build(); });
  }

  // Mide cuánto cambia el volumen percibido en cada dispositivo simulado (renderiza la canción por cada perfil).
  async function measureDevices(chs, sr, base, onStep) {
    const rows = [];
    for (const d of DEVICES) {
      onStep(d.name);
      if (d.id === 'ref') { rows.push({ id: d.id, name: d.name, lufs: base }); continue; }
      await new Promise((r) => setTimeout(r, 20));
      const o = new OfflineAudioContext(2, chs[0].length, sr), b = o.createBuffer(chs.length, chs[0].length, sr);
      chs.forEach((x, c) => b.copyToChannel(x, c));
      const src = o.createBufferSource(); src.buffer = b; let last = src;
      for (const st of deviceStages(o, d)) { last.connect(st.in); last = st.out; }
      last.connect(o.destination); src.start();
      const r = await o.startRendering();
      rows.push({ id: d.id, name: d.name, lufs: loudness([r.getChannelData(0), r.getChannelData(1)], sr).integrated });
    }
    rows.forEach((x) => (x.delta = x.lufs - base));
    return rows;
  }

  // Selecciona qué se escucha (original o una versión) y a qué volumen se compara.
  function listen() {
    const o = api.getOrig(), v = versions.find((x) => x.id === cur);
    if (!v) cur = 'orig';
    let trim = 1;
    if (matchOn && o) {
      const tgt = Math.min(...[o.lufs, ...versions.map((x) => x.ana.lufs)].filter(isFinite)), mine = v ? v.ana.lufs : o.lufs;
      if (isFinite(tgt) && isFinite(mine)) trim = 10 ** ((tgt - mine) / 20);
    }
    api.use(cur, v ? v.chs : null, trim);
  }

  function renderCompare() {
    cmpRoot.replaceChildren();
    const o = api.getOrig(); if (!o) return;
    mc('h2', 'Escuchar y comparar');
    const vrow = mc('div', '', 'bar2');
    for (const [id, label] of [['orig', 'Original'], ...versions.map((v) => [v.id, v.label])]) {
      const b = mc('button', label, id === cur ? '' : 'sec', vrow); b.type = 'button';
      b.addEventListener('click', () => { cur = id; listen(); renderCompare(); });
    }
    if (cur !== 'orig') { const q = mc('button', 'Quitar esta versión', 'sec', vrow); q.type = 'button'; q.addEventListener('click', () => { versions = versions.filter((v) => v.id !== cur); cur = 'orig'; listen(); renderCompare(); }); }
    const lab = mc('label', '', 'chk', vrow), cb = mc('input', '', '', lab); cb.type = 'checkbox'; cb.checked = matchOn; lab.append(' Igualar volumen');
    cb.addEventListener('change', () => { matchOn = cb.checked; listen(); renderCompare(); });
    const lufsAll = [o.lufs, ...versions.map((v) => v.ana.lufs)].filter(isFinite);
    mc('small', versions.length
      ? (matchOn ? `Volumen igualado: todo se escucha al nivel de la versión más baja (${Math.min(...lufsAll).toFixed(1)} LUFS), así la más fuerte no parece mejor solo por sonar más.` : 'Volumen sin igualar: la versión más fuerte puede parecer mejor sin serlo.')
      : 'Todavía no procesaste nada: abajo elegí un preset y apretá "Procesar". Podés probar los dispositivos con el original.', 'hint');

    // ---- Recomendaciones sobre la versión que se está escuchando
    const curV = versions.find((x) => x.id === cur), curAna = curV ? curV.ana : o, curName = curV ? curV.label : 'el original';
    mc('h3', `Recomendaciones para ${curName}`);
    mc('small', 'Salen de mediciones de esta versión. Son orientativas: dependen de tu estilo y de tu gusto, y no hay ninguna que se aplique sola. Si algo no te suena mal, no hace falta tocarlo.', 'hint');
    const recs = advise({ ana: curAna, stats: curV?.stats, p: curV ? curV.p : { ...P }, isOrig: !curV, devices: devCache[cur] });
    if (!recs.length) mc('p', 'No se detectó nada llamativo con estas reglas. Eso no garantiza que suene bien: confiá también en tu oído.', 'rec info');
    for (const r of recs) {
      const d = mc('div', '', 'rec ' + r.sev);
      mc('b', (r.sev === 'warn' ? 'Atención: ' : 'Ojo: ') + r.title, '', d);
      for (const [k, v] of [['Qué se midió', r.found], ['Dónde se nota', r.where], ['Por qué pasa', r.why], ['Qué probar', r.fix]]) { const p = mc('p', '', '', d); mc('span', k + ': ', 'k', p); p.append(v); }
      if (r.apply) {
        const ap = mc('button', 'Aplicar en el estudio', 'sec', d); ap.type = 'button'; const msg = mc('small', '', 'hint', d);
        ap.addEventListener('click', () => { Object.assign(P, DEFAULTS, clean({ ...(curV ? curV.p : P), ...r.apply })); sel = ''; build(); msg.textContent = 'Listo: se ajustaron los controles (más abajo, en Mastering). Apretá "Procesar" para escuchar el resultado y compararlo.'; });
      }
    }
    const mrow = mc('div', '', 'bar2'), mb = mc('button', devCache[cur] ? 'Volver a medir en dispositivos' : 'Medir en todos los dispositivos', 'sec', mrow), mst = mc('small', '', 'hint', mrow); mb.type = 'button';
    mb.disabled = measuring;
    mb.addEventListener('click', async () => {
      measuring = true; mb.disabled = true;
      try { devCache[cur] = await measureDevices(curV ? curV.chs : api.getChs(), api.getSr(), curAna.lufs, (n) => (mst.textContent = `Midiendo: ${n}…`)); }
      catch (e) { mst.textContent = 'No se pudo medir: ' + e.message; measuring = false; mb.disabled = false; return; }
      measuring = false; renderCompare();
    });
    if (devCache[cur]) {
      const t = mc('table', '', 'cmp'), h = mc('tr', '', '', t);
      for (const x of ['Dispositivo', 'Volumen percibido', 'Cambio vs. directo']) mc('th', x, '', h);
      for (const x of devCache[cur]) { const r = mc('tr', '', '', t); mc('td', x.name, '', r); mc('td', f1(x.lufs) + ' LUFS', '', r); mc('td', x.id === 'ref' ? '—' : (x.delta > 0 ? '+' : '') + f1(x.delta) + ' dB', '', r); }
      mc('small', 'Mide cuánto del volumen percibido se conserva en cada perfil. Una caída grande en el celular o el Bluetooth indica que mucha energía está en graves que esos equipos no reproducen. Son perfiles aproximados.', 'hint');
    }
    const gd = mc('details', '', 'guide'); mc('summary', 'Guía: cuando algo suena mal, ¿qué toco?', '', gd);
    for (const [s1, s2] of [
      ['Suena turbio, tapado o "de cajón"', 'Zona 200–500 Hz. Bajá los medios-bajos 1,5 a 3 dB.'],
      ['La voz está lejos o enterrada', 'Zona 2–5 kHz. Subí los medios-altos 1 a 2 dB. Si sigue, probablemente el nivel de la voz se arregla en BandLab, no en el master.'],
      ['Áspero, molesto o con silbidos en las "s"', 'Zona 3–8 kHz. Bajá los medios-altos o los agudos 1 a 2 dB y bajá el exciter.'],
      ['Sin brillo, opaco', 'Más de 8 kHz. Subí los agudos 1 a 2 dB.'],
      ['Graves flojos', 'Zona 50–100 Hz. Subí los graves 1 a 2 dB (y probá en el simulador de celular: ahí casi no se oyen).'],
      ['Graves exagerados o borrosos', 'Zona 60–150 Hz. Bajá los graves 1 a 2 dB o la saturación.'],
      ['Aplastado, sin vida', 'Compresión y limitación de más. Bajá la ganancia de entrada al limitador y el ratio.'],
      ['Se oyen "olas": el volumen sube y baja con los golpes', 'Es el compresor o el limitador reaccionando a los graves fuertes (bombeo). Mirá en la tabla cuánta reducción hacen, bajá la ganancia de entrada al limitador, subí los release, subí el threshold del compresor o probá con ratio 1 para aislar al culpable.'],
      ['Sucio o distorsionado', 'Saturación o limitador forzados, o recorte que ya venía en el original. Bajá la saturación y la ganancia de entrada; revisá "Muestras en el tope" en el análisis.'],
      ['Se pierde algo en celular o en mono', 'Probá el dispositivo "Mono" y el de celular. Pasá los graves a mono y bajá el ancho estéreo.'],
    ]) { const p = mc('p', '', '', gd); mc('b', s1 + ': ', '', p); p.append(s2); }
    mc('small', 'Guía general basada en cómo suelen comportarse estas zonas de frecuencia: no es una medición de tu canción. Para ubicar la zona exacta, usá el Buscador de frecuencias.', 'hint', gd);

    mc('h3', 'Simular un dispositivo');
    const drow = mc('div', '', 'bar2'), ds = mc('select', '', '', drow);
    for (const d of DEVICES) mc('option', d.name, '', ds).value = d.id;
    ds.value = devId; const dn = mc('small', DEVICES.find((d) => d.id === devId).note, 'hint');
    ds.addEventListener('change', () => { devId = ds.value; api.setDevice(devId); dn.textContent = DEVICES.find((d) => d.id === devId).note; });
    mc('small', 'Son perfiles aproximados, no mediciones de modelos concretos. La simulación solo cambia lo que escuchás: no modifica el original ni lo que exportás. Podés cambiar de versión o de dispositivo mientras suena.', 'hint');

    mc('h3', 'Buscador de frecuencias (para encontrar qué suena mal)');
    mc('small', 'Con la canción sonando: activalo en "Realzar" y mové la frecuencia. Donde el sonido se vuelva más molesto (turbio, áspero, nasal) suele estar el problema. "Solo esta zona" te deja oír únicamente esa franja. Cuando la encuentres, usá el botón para cortarla en el ecualizador. Esto es solo para escuchar y no se exporta.', 'hint');
    const prow = mc('div', '', 'bar2'), pOn = mc('button', probe.on ? 'Desactivar' : 'Activar', probe.on ? '' : 'sec', prow), pm = mc('select', '', '', prow);
    pOn.type = 'button';
    for (const [v, t] of [['boost', 'Realzar (+9 dB)'], ['solo', 'Solo esta zona']]) mc('option', t, '', pm).value = v;
    pm.value = probe.mode;
    const sl = mc('input', '', '', prow), hzLab = mc('b', '', '', prow), cut = mc('button', '', 'sec', prow); cut.type = 'button';
    Object.assign(sl, { type: 'range', min: 0, max: 1000, step: 1 }); sl.style.minWidth = '14rem';
    const toHz = (x) => Math.round(40 * 400 ** (x / 1000)), toX = (f) => (1000 * Math.log(f / 40)) / Math.log(400);
    const band = () => { const f = probe.hz; return f < 100 ? ['lowF', 'lowG', 'Graves'] : f <= 1000 ? ['lmF', 'lmG', 'Medios-bajos'] : f <= 8000 ? ['hmF', 'hmG', 'Medios-altos'] : ['highF', 'highG', 'Agudos']; };
    const refresh = () => { hzLab.textContent = probe.hz >= 1000 ? (probe.hz / 1000).toFixed(2) + ' kHz' : probe.hz + ' Hz'; cut.textContent = `Cortar ${hzLab.textContent} (−3 dB) en "${band()[2]}"`; };
    const cutMsg = mc('small', '', 'hint'); sl.value = toX(probe.hz); refresh();
    pOn.addEventListener('click', () => { probe.on = !probe.on; api.setProbe({ on: probe.on, mode: probe.mode, f: probe.hz }); renderCompare(); });
    pm.addEventListener('change', () => { probe.mode = pm.value; api.setProbe({ mode: probe.mode }); });
    sl.addEventListener('input', () => { probe.hz = toHz(+sl.value); api.setProbe({ f: probe.hz }); refresh(); });
    cut.addEventListener('click', () => {
      const [fk, gk] = band(); P[fk] = Math.min(RANGE[fk][1], Math.max(RANGE[fk][0], probe.hz)); P[gk] = Math.min(P[gk], -3); sel = ''; build();
      cutMsg.textContent = `Listo: se ajustó "${band()[2]}" a ${probe.hz} Hz con −3 dB en el ecualizador (más abajo, en Mastering). Apretá "Procesar" para escuchar el resultado.`;
    });

    mc('h3', 'Antes y después');
    const wrap = mc('div', '', 'scroll'), t = mc('table', '', 'cmp', wrap), r0 = mc('tr', '', '', t);
    const cols = [['Original', o], ...versions.map((v) => ['V' + v.n, v.ana])];
    for (const h of ['', ...cols.map((c) => c[0])]) mc('th', h, '', r0);
    for (const [name, key, u, dd] of [['LUFS integrado', 'lufs', ' LUFS', 1], ['True peak', 'truePeakDb', ' dBTP', 2], ['Pico de muestra', 'samplePeakDb', ' dBFS', 2], ['RMS', 'rmsDb', ' dBFS', 1], ['Factor de cresta', 'crestDb', ' dB', 1], ['Rango de volumen (LRA)', 'lra', ' LU', 1]]) {
      const r = mc('tr', '', '', t); mc('td', name, '', r);
      for (const [, a] of cols) mc('td', isFinite(a[key]) ? a[key].toFixed(dd) + u : '—', '', r);
    }
    for (const [name, k] of [['Compresor: reducción media / máx.', 'comp'], ['Limitador: reducción media / máx.', 'lim']]) {
      const r = mc('tr', '', '', t); mc('td', name, '', r); mc('td', '—', '', r);
      for (const v of versions) mc('td', `${f1(v.stats[k].mean)} / ${f1(v.stats[k].max)} dB`, '', r);
    }
    if (versions.length) {
      mc('h3', 'Exportar');
      const ex = mc('div', '', 'bar2'), vs = mc('select', '', '', ex), fs = mc('select', '', '', ex);
      for (const v of versions) mc('option', v.label, '', vs).value = v.id;
      vs.value = cur !== 'orig' ? cur : versions[versions.length - 1].id;
      for (const [v, l] of [[24, 'WAV 24 bits'], [16, 'WAV 16 bits (con dither)'], [32, 'WAV 32 bits float']]) mc('option', l, '', fs).value = v;
      const dl = mc('button', 'Descargar', '', ex); dl.type = 'button';
      mc('small', 'Se exporta la versión elegida a la misma frecuencia de muestreo del original, sin simulación de dispositivo. Con 16 bits se agrega dither; si el techo está en 0 dB eso puede rozar el máximo, por eso conviene dejar −1 dB.', 'hint');
      dl.addEventListener('click', () => {
        const v = versions.find((x) => x.id === vs.value), bits = +fs.value, a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([encodeWav(v.chs, api.getSr(), bits, bits === 16)], { type: 'audio/wav' }));
        a.download = api.getName().replace(/\.[^.]+$/, '') + `_MasterChe_V${v.n}_${bits}${bits === 32 ? 'f' : ''}.wav`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 8000);
      });
    }
  }

  // Canción nueva: se descartan las versiones y se vuelve a los valores iniciales.
  function reset() { versions = []; devCache = {}; cur = 'orig'; counter = 0; devId = 'ref'; probe.on = false; sel = ''; Object.assign(P, DEFAULTS); build(); renderCompare(); }
  build();
  return { reset };
}
