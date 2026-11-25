// Recomendaciones basadas en reglas y umbrales sobre mediciones reales. No hay IA: cada recomendación muestra los números
// en los que se apoya. Los umbrales son orientativos (dependen del género y del gusto): no son verdades absolutas.
// Plataformas (verificado en nov. 2026): Spotify normaliza a −14 LUFS (modo Normal) y recomienda techo ≤ −2 dBTP si el master
// supera −14 LUFS; YouTube baja lo que supera ~−14 LUFS y no sube lo más bajo; la ayuda de SoundCloud dice que normaliza,
// pero no pude confirmar a qué nivel, por eso no se asume ninguno.
const f1 = (x) => (isFinite(x) ? x.toFixed(1) : '—');
const avg = (bands, lo, hi) => { const v = bands.filter((b) => b.fc >= lo && b.fc <= hi).map((b) => Math.max(b.db, -80)); return v.reduce((a, c) => a + c, 0) / v.length; };

// in: { ana, stats, p, isOrig, devices } -> lista de { id, sev, title, found, where, why, fix, apply }
export function advise({ ana: a, stats, p, isOrig, devices }) {
  const out = [], P = p || {}, add = (r) => out.push({ apply: null, ...r });
  const dist = a.spec?.dist, st = a.stereo, tpLimit = a.lufs > -14 ? -2 : -1;

  if (a.truePeakDb > tpLimit + 0.05)
    add({ id: 'tp', sev: 'warn', title: `Pico real por encima de ${tpLimit} dBTP`, found: `True peak de ${f1(a.truePeakDb)} dBTP (con ${f1(a.lufs)} LUFS).`,
      where: 'Al subirlo a YouTube, Spotify o SoundCloud: lo recodifican a un formato con pérdida (MP3, AAC u Ogg).',
      why: 'La recodificación puede generar picos más altos que los de la onda original y producir distorsión. Spotify recomienda dejar el techo en −2 dBTP si el tema supera −14 LUFS.',
      fix: `Poné el techo en ${tpLimit} dBTP${isOrig ? ' y procesá: el limitador lo respeta' : ''}.`, apply: { ceiling: tpLimit } });

  if (a.clip.runs > 0 && isOrig)
    add({ id: 'clip', sev: 'warn', title: 'Recorte (clipping) en el archivo original', found: `${a.clip.runs} tramo(s) con 3 o más muestras seguidas en el tope (${a.clip.samples} muestras en total).`,
      where: 'En cualquier equipo, sobre todo en volumen alto.', why: 'Suele pasar cuando la mezcla o la exportación de BandLab sale demasiado fuerte: la onda se "corta" y suena áspera. El mastering no puede devolver lo recortado.',
      fix: 'Bajá el volumen general en BandLab y volvé a exportar con más margen.' });

  const over = a.lufs - -14;
  if (over >= 2)
    add({ id: 'loud', sev: 'info', title: `Más fuerte que el nivel de las plataformas (${f1(a.lufs)} LUFS)`, found: `${f1(a.lufs)} LUFS integrado: unos ${f1(over)} dB sobre −14.`,
      where: 'Spotify (modo Normal) y YouTube lo van a bajar ~' + f1(over) + ' dB. No pasa en la web de Spotify ni en TVs o parlantes de terceros, que no normalizan.',
      why: 'Ese volumen extra no llega al oyente, y para lograrlo el limitador y el compresor quitan dinámica.',
      fix: isOrig ? 'Es una decisión estética: si querés que suene fuerte a propósito, está bien. Si no, dejá más margen al masterizar.' : 'Si no buscás ese volumen a propósito, bajá la ganancia de entrada al limitador.',
      apply: !isOrig && P.drive > 0 ? { drive: Math.max(0, P.drive - Math.min(3, over)) } : null });

  if (st && (st.monoLossDb < -1.5 || st.correlation < 0.2))
    add({ id: 'mono', sev: 'warn', title: 'Compatibilidad mono baja', found: `Pérdida al pasar a mono: ${f1(st.monoLossDb)} dB; correlación L/R: ${st.correlation.toFixed(2)}.`,
      where: 'Celular, parlantes Bluetooth, algunos televisores y salas con parlantes mono.', why: 'Lo que está en oposición de fase entre los canales se cancela al sumarlos; esos elementos bajan de volumen o desaparecen.',
      fix: 'Bajá el ancho estéreo a 100 % o menos y pasá los graves a mono. Probá también el dispositivo "Mono" para escuchar qué se pierde.', apply: { width: Math.min(P.width ?? 100, 100), bassMono: Math.max(P.bassMono || 0, 120) } });
  else if (st && st.monoLossDb < -0.7)
    add({ id: 'mono2', sev: 'info', title: 'Algo de pérdida al pasar a mono', found: `Pérdida al pasar a mono: ${f1(st.monoLossDb)} dB.`, where: 'Equipos mono (celular, Bluetooth).',
      why: 'Hay contenido estéreo que se atenúa al sumar los canales.', fix: 'Revisá el dispositivo "Mono": si no se pierde nada importante, no hace falta tocar.' });

  const phone = devices?.find((d) => d.id === 'phone'), sub = dist?.[0].pct;
  if (dist && (sub > 60 || (phone && phone.delta < -10)))
    add({ id: 'sub', sev: 'info', title: 'Mucha energía en subgraves', found: `${f1(sub)} % de la energía está entre 20 y 60 Hz.` + (phone ? ` En el simulador de celular el volumen cae ${f1(-phone.delta)} dB.` : ''),
      where: 'Celular, Bluetooth, televisor y auriculares chicos: casi no reproducen por debajo de ~100–300 Hz.', why: 'Lo que está por debajo de esos límites no se oye; el bajo solo se percibe si tiene armónicos (frecuencias más agudas que "dibujan" la nota).',
      fix: 'Agregá algo de saturación para generar armónicos y que el bajo se note en equipos chicos. Es habitual en trap; revisalo con el simulador de celular.', apply: { satDrive: Math.max(P.satDrive || 0, 5), satMix: Math.max(P.satMix || 0, 40) } });

  if (dist && dist[4].pct < 3 && !(isOrig === false && P.hmG >= 1.5))
    add({ id: 'pres', sev: 'info', title: 'Poca energía en la zona de presencia (2–6 kHz)', found: `${f1(dist[4].pct)} % de la energía está en esa zona.`,
      where: 'Parlantes chicos (celular, TV, Bluetooth), donde esa zona carga con gran parte de lo que se entiende.',
      why: 'Ahí viven la claridad de la voz y los ataques. Ojo: no puedo saber si la voz está baja, solo que esa franja tiene poca energía en toda la mezcla.',
      fix: 'Probá subir 1,5 dB los medios-altos (3 kHz).', apply: { hmF: 3000, hmG: Math.max(P.hmG || 0, 1.5) } });

  if (a.spec?.bands) {
    const b = a.spec.bands, A = avg(b, 100, 160), B = avg(b, 1000, 2000), M = avg(b, 200, 500), w = (Math.log(316) - Math.log(126)) / (Math.log(1500) - Math.log(126)), bump = M - (A + w * (B - A));
    if (bump > 2.5)
      add({ id: 'mud', sev: 'info', title: 'Acumulación en 200–500 Hz ("barro")', found: `Esa zona está ${f1(bump)} dB por encima de la tendencia entre los graves y los medios.`,
        where: 'Televisor y parlantes chicos, donde suena cajoso o tapado.', why: 'Se junta el cuerpo del bajo, la voz y los sintetizadores. Es una medición orientativa: en algunos estilos esa zona es parte del carácter.',
        fix: 'Probá −2 dB en los medios-bajos (300 Hz) y compará con el original.', apply: { lmF: 300, lmG: Math.min(P.lmG || 0, -2) } });
  }

  if (dist && dist[5].pct < 0.8)
    add({ id: 'air', sev: 'info', title: 'Poco "aire" en los agudos', found: `${f1(dist[5].pct)} % de la energía por encima de 6 kHz.`, where: 'Auriculares y parlantes de casa, que sí llegan a esas frecuencias.',
      why: 'Si la mezcla es apagada de origen, esa zona casi no tiene energía.', fix: 'Probá +2 dB de agudos (10 kHz).', apply: { highF: 10000, highG: Math.max(P.highG || 0, 2) } });

  const plr = a.truePeakDb - a.lufs;
  if (plr < 7)
    add({ id: 'plr', sev: 'warn', title: 'Muy poca dinámica', found: `Diferencia pico–volumen (PLR) de ${f1(plr)} dB; factor de cresta ${f1(a.crestDb)} dB.`,
      where: 'En cualquier equipo; cansa al oído y puede sonar "aplastado".', why: isOrig ? 'El archivo ya viene muy comprimido o limitado (por ejemplo, con el mastering automático de BandLab activado).' : 'Compresor y limitador están quitando mucha dinámica.',
      fix: isOrig ? 'Exportá de BandLab sin mastering automático y con más margen.' : 'Bajá la ganancia de entrada al limitador y el ratio del compresor.', apply: isOrig ? null : { drive: Math.max(0, (P.drive || 0) - 2), ratio: Math.max(1, (P.ratio || 1) - 1) } });

  if (stats) {
    const { comp: c, lim: l } = stats, wave = 'Se percibe como "olas": el volumen sube y baja al ritmo de los golpes fuertes (sobre todo el 808).';
    if (l.mean > 3 || l.max > 6 || (l.mean > 1.5 && l.std > 1.5))
      add({ id: 'limpump', sev: 'warn', title: 'El limitador trabaja demasiado (posible "bombeo")', found: `Reducción media ${f1(l.mean)} dB, máxima ${f1(l.max)} dB, variación ±${f1(l.std)} dB entre tramos de 50 ms.`,
        where: wave, why: 'Cada golpe grave hace bajar todo el volumen y luego vuelve a subir: el limitador responde al bajo y arrastra al resto de la mezcla.',
        fix: 'Bajá la ganancia de entrada al limitador, subí su release (150 ms o más) y, si sigue, bajá un poco los graves del ecualizador.', apply: { drive: Math.max(0, (P.drive || 0) - 2), limRelease: Math.max(P.limRelease || 0, 150) } });
    if (c.mean > 3 || c.max > 8 || (c.mean > 1.5 && c.std > 1.5))
      add({ id: 'comppump', sev: 'warn', title: 'El compresor trabaja demasiado (posible "bombeo")', found: `Reducción media ${f1(c.mean)} dB, máxima ${f1(c.max)} dB, variación ±${f1(c.std)} dB.`,
        where: wave, why: 'Con threshold bajo, ratio alto o release corto, el compresor baja y suelta el volumen con cada golpe.',
        fix: 'Subí el threshold, bajá el ratio y alargá el release (250 ms o más). Para comprobarlo, probá con ratio 1: si las olas desaparecen, era el compresor.', apply: { thr: Math.min(0, (P.thr ?? -18) + 3), ratio: Math.max(1, (P.ratio || 1) - 1), release: Math.max(P.release || 0, 250) } });
  }
  return out;
}
