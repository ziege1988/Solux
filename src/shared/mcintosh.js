/*
 * Solux – Klassifikation von Sonnenfleckengruppen
 * McIntosh (Zpc) und Mount-Wilson-Magnetklassen, mit deutschsprachigen Erklärungen.
 */
(function (root) {
  'use strict';
  const Z = {
    A: 'Einzelfleck oder unipolare Gruppe ohne Penumbra',
    B: 'Bipolare Gruppe ohne Penumbra',
    C: 'Bipolare Gruppe, Penumbra an einem Ende',
    D: 'Bipolare Gruppe, Penumbra an beiden Enden, Länge unter 10°',
    E: 'Bipolare Gruppe, Penumbra an beiden Enden, Länge 10–15°',
    F: 'Bipolare Gruppe, Penumbra an beiden Enden, Länge über 15°',
    H: 'Unipolare Gruppe mit Penumbra (meist alter Leitfleck)',
  };
  const P = {
    x: 'keine Penumbra',
    r: 'rudimentäre, unvollständige Penumbra',
    s: 'kleine, symmetrische Penumbra (≤ 2,5°)',
    a: 'kleine, asymmetrische Penumbra (≤ 2,5°)',
    h: 'große, symmetrische Penumbra (> 2,5°)',
    k: 'große, asymmetrische Penumbra (> 2,5°)',
  };
  const C = {
    x: 'Einzelfleck',
    o: 'offen – kaum Flecken zwischen Leit- und Folgefleck',
    i: 'mittel – einige Flecken zwischen den Hauptflecken',
    c: 'kompakt – viele Flecken dazwischen, mindestens einer mit Penumbra',
  };
  const MW = {
    A: ['α', 'Alpha', 'unipolar – nur eine magnetische Polarität'],
    B: ['β', 'Beta', 'bipolar mit einfacher, klarer Trennung der Polaritäten'],
    G: ['γ', 'Gamma', 'komplexe Polaritätsverteilung ohne klare Trennlinie'],
    D: ['δ', 'Delta', 'Umbren entgegengesetzter Polarität in einer gemeinsamen Penumbra'],
  };

  /** "BGD" -> "βγδ" */
  function magSymbol(mag) {
    if (!mag) return '';
    return String(mag).toUpperCase().split('').map((c) => (MW[c] ? MW[c][0] : '')).join('');
  }

  function decode(spotClass, magClass) {
    const out = { code: spotClass || '', parts: [], mag: [], risk: null };
    if (spotClass && spotClass.length === 3) {
      const [z, p, c] = spotClass;
      if (Z[z]) out.parts.push({ key: z, title: 'Zürich-Klasse', text: Z[z] });
      if (P[p]) out.parts.push({ key: p, title: 'Penumbra des größten Flecks', text: P[p] });
      if (C[c]) out.parts.push({ key: c, title: 'Fleckenverteilung', text: C[c] });
    }
    for (const ch of String(magClass || '').toUpperCase()) if (MW[ch]) out.mag.push({ key: MW[ch][0], title: `Magnetklasse ${MW[ch][1]}`, text: MW[ch][2] });
    out.risk = riskOf(spotClass, magClass);
    return out;
  }

  /** Grobe Einordnung des Flare-Potenzials (qualitativ). */
  function riskOf(spotClass, magClass, probs) {
    const mag = String(magClass || '').toUpperCase();
    const z = spotClass ? spotClass[0] : '';
    const c = spotClass ? spotClass[2] : '';
    let level = 0;
    if ('DEF'.includes(z) && z) level += 1;
    if (c === 'c' || c === 'i') level += 1;
    if (mag.includes('G')) level += 1;
    if (mag.includes('D')) level += 2;
    if (probs && probs.m >= 30) level += 1;
    if (probs && probs.x >= 10) level += 1;
    if (level >= 4) return { level: 'bad', label: 'Hoch', text: 'Komplexe Gruppe – M-Flares wahrscheinlich, X-Flares möglich.' };
    if (level >= 2) return { level: 'warn', label: 'Mittel', text: 'C-Flares häufig, einzelne M-Flares möglich.' };
    return { level: 'ok', label: 'Gering', text: 'Ruhige Gruppe – höchstens schwache Flares zu erwarten.' };
  }

  /** Kurzbeschreibung einer Region für die Textdatei. */
  function describe(r) {
    const d = decode(r.spot_class, r.mag_class);
    const bits = d.parts.map((p) => p.text);
    const mag = d.mag.map((m) => `${m.key} ${m.text}`);
    return [bits.join('; '), mag.join('; ')].filter(Boolean).join('. ');
  }

  /* ---------- Verständliche Erklärungen ---------- */
  const Z_PLAIN = {
    A: 'ein einzelner kleiner Fleck ohne Hof oder eine Ansammlung winziger Poren',
    B: 'eine kleine Gruppe aus zwei Teilen (Plus- und Minuspol), noch ganz ohne Hof',
    C: 'eine zweiteilige Gruppe, bei der nur ein Ende schon einen grauen Hof (Penumbra) hat',
    D: 'eine zweiteilige Gruppe mit Hof an beiden Enden, aber noch recht kurz',
    E: 'eine große, zweiteilige Gruppe mit Hof an beiden Enden',
    F: 'eine sehr große, lang gestreckte Gruppe mit Hof an beiden Enden',
    H: 'ein einzelner großer Fleck mit Hof – meist der Rest einer älteren Gruppe',
  };
  const Z_SIZE = { A: '', B: '', C: '', D: 'kürzer als etwa 10° (≈ 120.000 km)', E: '10° bis 15° lang (120.000–180.000 km)', F: 'länger als 15° (über 180.000 km)', H: '' };
  const P_PLAIN = {
    x: 'der größte Fleck hat keinen Hof',
    r: 'der Hof um den größten Fleck ist erst ansatzweise vorhanden',
    s: 'der größte Fleck hat einen kleinen, runden, gleichmäßigen Hof',
    a: 'der größte Fleck hat einen kleinen, unregelmäßig geformten Hof',
    h: 'der größte Fleck hat einen großen, runden Hof',
    k: 'der größte Fleck hat einen großen, unregelmäßigen Hof – oft mehrere Kerne darin',
  };
  const C_PLAIN = {
    x: 'es ist nur ein Fleck',
    o: 'zwischen den beiden Hauptflecken ist kaum etwas',
    i: 'zwischen den Hauptflecken liegen einige kleinere Flecken',
    c: 'die Gruppe ist dicht gepackt, mit vielen Flecken (teils mit Hof) zwischen den Hauptflecken',
  };
  const MW_PLAIN = {
    A: 'Das Magnetfeld hat nur eine Polarität – ruhig.',
    B: 'Plus- und Minuspol liegen sauber getrennt nebeneinander – der Normalfall.',
    G: 'Plus und Minus sind unordentlich durchmischt – das Magnetfeld ist verwickelt.',
    D: 'Gegensätzliche Pole liegen dicht beieinander im selben Hof – hier baut sich besonders viel Energie auf.',
  };

  /** Ein Satz in Alltagssprache für eine Gruppe. */
  function plainSummary(spotClass, magClass) {
    if (!spotClass || spotClass.length !== 3) return 'Ein aktives Gebiet ohne sichtbare Flecken: im Weißlicht unauffällig, im Kalziumlicht als helle Fläche (Plage) zu sehen.';
    const [z, p, c] = spotClass;
    let t = `Das ist ${Z_PLAIN[z] || 'eine Fleckengruppe'}${Z_SIZE[z] ? ', ' + Z_SIZE[z] : ''}. `;
    if (z !== 'A' && z !== 'B') t += `${(P_PLAIN[p] || '').replace(/^./, (m) => m.toUpperCase())}${C_PLAIN[c] ? ', ' + C_PLAIN[c] : ''}.`;
    else if (C_PLAIN[c]) t += `${C_PLAIN[c].replace(/^./, (m) => m.toUpperCase())}.`;
    const mag = String(magClass || '').toUpperCase();
    const last = mag.includes('D') ? 'D' : mag.includes('G') ? 'G' : mag[0];
    if (MW_PLAIN[last]) t += ' ' + MW_PLAIN[last];
    return t.trim();
  }

  /** Fläche in Millionstel Hemisphäre -> Vergleich mit der Erde (Erdscheibe ≈ 42 MH). */
  function areaPlain(msh) {
    if (!msh) return null;
    const earths = msh / 41.9, km2 = msh * 3.044e6;
    const e = earths < 0.95 ? `etwa ${Math.max(0.1, earths).toFixed(1).replace('.', ',')} Erdscheiben` : `etwa ${Math.round(earths)} Erdscheibe${Math.round(earths) === 1 ? '' : 'n'}`;
    return `${msh} MH ≈ ${(km2 / 1e6).toFixed(0)} Mio. km² – ${e}${msh >= 500 ? ', mit bloßem Auge (mit Filter!) sichtbar' : ''}`;
  }

  /** "S08W83" -> verständliche Lagebeschreibung inkl. Zeit bis zum Rand. */
  function positionPlain(loc) {
    const m = /^([NS])(\d+)([EW])(\d+)$/.exec(loc || '');
    if (!m) return null;
    const lat = +m[2], lon = +m[4], ns = m[1] === 'N' ? 'nördlich' : 'südlich', ew = m[3] === 'E' ? 'östlich (links)' : 'westlich (rechts)';
    let t = `${lat}° ${ns} des Sonnenäquators und ${lon}° ${ew} der Scheibenmitte.`;
    const days = (deg) => Math.max(0, deg / 13.2);
    if (m[3] === 'W') { const d = days(90 - lon); t += d < 1 ? ' Sie dreht in weniger als einem Tag über den Westrand aus dem Blick.' : ` Sie dreht in etwa ${Math.round(d)} Tagen über den Westrand aus dem Blick.`; }
    else { const d = days(90 - lon); t += ` Sie ist vor etwa ${Math.max(0, Math.round(d))} Tagen am Ostrand aufgetaucht und bleibt noch rund ${Math.round(days(90 + lon))} Tage sichtbar.`; }
    if (lon > 60) t += ' Nahe am Rand wirkt sie stark verkürzt.';
    return t;
  }

  /* ---------- Zusammenfassung einer Region „für Einsteiger“ ---------- */
  const deKm = (km) => Math.round(km).toLocaleString('de-DE');
  /**
   * r: Region (region, spotClass, magClass, area, numberSpots, extent, location, probs, flares, firstDate, type)
   * hist: Verlauf [{day, cls, area}], flares: [{cls, max}] der Region, kind: 'wl'|'ca'|'ha'
   * Liefert { fazit, sections: [{h, p}] }.
   */
  function regionStory(r, hist = [], flares = [], kind = 'wl') {
    const S = [];
    const spots = r.type === 'spots' && r.spotClass;
    S.push({ h: 'Was ist das?', p: `AR ${r.region} ist eine „aktive Region“ – ein Gebiet, in dem starke Magnetfelder aus dem Sonneninneren an die Oberfläche treten. Dort ist die Oberfläche kühler und erscheint im Weißlicht als dunkle Sonnenflecken. ${spots ? 'Im Kalzium- und H-Alpha-Licht leuchtet die Umgebung als helle Fackelfläche (Plage).' : 'Hier gibt es gerade keine Flecken – im Kalzium- und H-Alpha-Licht leuchtet das Gebiet aber hell (Plage).'}` });
    if (spots) {
      S.push({ h: 'Wie sieht sie aus?', p: `${plainSummary(r.spotClass, '')}${r.numberSpots ? ` Insgesamt zählt NOAA ${r.numberSpots} einzelne Flecken.` : ''}` });
      const size = [];
      if (r.area) { const earths = r.area / 41.9; size.push(`Die dunklen Flecken bedecken zusammen ${r.area} millionstel der sichtbaren Sonnenhälfte – das sind rund ${deKm(r.area * 3.044)} Millionen km², ${earths >= 1 ? `etwa ${Math.round(earths)}-mal` : `etwa ${earths.toFixed(1).replace('.', ',')}-mal`} die Fläche der Erdscheibe.`); }
      if (r.extent) { const km = r.extent * 12147; size.push(`Von einem Ende zum anderen ist die Gruppe etwa ${r.extent}° lang, also rund ${deKm(km)} km – ${Math.round(km / 12742)} Erden passen nebeneinander hinein.`); }
      if (r.area >= 500) size.push('Das ist eine sehr große Gruppe – mit Sonnenfilterbrille schon mit bloßem Auge erkennbar.');
      else if (r.area >= 200) size.push('Das ist eine große Gruppe, schon in kleinen Teleskopen eindrucksvoll.');
      else if (r.area >= 50) size.push('Eine mittelgroße Gruppe.');
      else if (r.area) size.push('Eine kleine Gruppe, im Teleskop als Grüppchen dunkler Punkte sichtbar.');
      if (size.length) S.push({ h: 'Wie groß ist sie?', p: size.join(' ') });
    }
    // Entwicklung
    if (hist && hist.length > 1) {
      const a = hist[0], b = hist[hist.length - 1], prev = hist[Math.max(0, hist.length - 3)];
      const trend = (b.area || 0) > (prev.area || 0) * 1.2 ? 'wächst gerade' : (b.area || 0) < (prev.area || 0) * 0.8 ? 'wird gerade kleiner' : 'bleibt in den letzten Tagen etwa gleich groß';
      const days = Math.round((Date.parse(b.day) - Date.parse(a.day)) / 86400000);
      S.push({ h: 'Wie entwickelt sie sich?', p: `Seit ${days} Tag${days === 1 ? '' : 'en'} beobachtet (Klasse damals ${a.cls}, heute ${b.cls}). Die Gruppe ${trend}${a.area && b.area ? ` (von ${a.area} auf ${b.area} MH)` : ''}.` });
    }
    // Aktivität
    const risk = riskOf(r.spotClass, r.magClass, r.probs);
    const word = (p) => (p == null ? null : p >= 60 ? 'wahrscheinlich' : p >= 30 ? 'gut möglich' : p >= 10 ? 'möglich, aber eher selten' : 'unwahrscheinlich');
    const act = [];
    if (r.magClass) act.push(MW_PLAIN[String(r.magClass).toUpperCase().includes('D') ? 'D' : String(r.magClass).toUpperCase().includes('G') ? 'G' : String(r.magClass).toUpperCase()[0]] || '');
    if (r.probs && r.probs.m != null) act.push(`Ein mittlerer Strahlungsausbruch (M-Flare) in den nächsten 24 Stunden ist ${word(r.probs.m)} (${r.probs.m} %), ein starker X-Flare ${word(r.probs.x)} (${r.probs.x ?? '–'} %).`);
    if (flares && flares.length) {
      const m = flares.filter((f) => /^[MX]/.test(f.cls)), c = flares.filter((f) => /^C/.test(f.cls));
      act.push(`In den letzten 7 Tagen: ${m.length ? `${m.length} M-/X-Flare${m.length > 1 ? 's' : ''} (stärkster ${m.sort((x, y) => (y.cls > x.cls ? 1 : -1))[0].cls})` : 'keine größeren Flares'}${c.length ? `, ${c.length} kleinere${c.length === 1 ? 'r C-Flare' : ' C-Flares'}` : ''}.`);
    }
    if (act.length) S.push({ h: 'Wie aktiv ist sie?', p: act.filter(Boolean).join(' ') });
    const pos = positionPlain(r.location);
    if (pos) S.push({ h: 'Wo liegt sie?', p: pos });
    // Beobachtungstipp
    const tip = [];
    if (!spots) tip.push('Im Weißlicht ist hier nichts zu sehen – schalte auf Kalzium oder H-Alpha um.');
    else {
      if (r.spotClass[1] === 'h' || r.spotClass[1] === 'k') tip.push('Achte im Weißlicht auf den grauen, faserigen Hof (Penumbra) um die dunklen Kerne – bei ruhiger Luft zeigt er feine Strukturen.');
      if (String(r.magClass).toUpperCase().includes('D')) tip.push('Wegen des δ-Magnetfelds lohnt sich ein Blick im H-Alpha-Licht: Hier können plötzlich helle Flares aufleuchten.');
      if (pos && /W[6-9]\d|E[6-9]\d/.test(r.location)) tip.push('Nahe am Rand sind die hellen Fackeln im Weißlicht besonders gut zu sehen.');
      if (!tip.length) tip.push('Gut geeignet, um die Entwicklung von Tag zu Tag zu fotografieren und zu vergleichen.');
    }
    S.push({ h: 'Beobachtungstipp', p: tip.join(' ') });
    // Fazit
    const sizeWord = !spots ? 'Ein fleckenfreies Fackelgebiet' : r.area >= 500 ? 'Eine sehr große' : r.area >= 200 ? 'Eine große' : r.area >= 50 ? 'Eine mittelgroße' : 'Eine kleine';
    const magWord = String(r.magClass).toUpperCase().includes('D') ? ', magnetisch sehr verwickelte' : String(r.magClass).toUpperCase().includes('G') ? ', magnetisch verwickelte' : '';
    const fazit = spots ? `${sizeWord}${magWord} Fleckengruppe – Flare-Risiko ${risk.label.toLowerCase()}.` : `${sizeWord} – nur im Kalzium- und H-Alpha-Licht sichtbar.`;
    return { fazit, sections: S, risk };
  }

  const GLOSSARY = [
    { k: 'AR 4566', t: 'Active Region (aktive Region)', d: 'Fortlaufende Nummer der US-Wetterbehörde NOAA für jedes Fleckengebiet. Kehrt eine Gruppe nach einer Sonnenumdrehung (≈ 27 Tage) zurück, bekommt sie eine neue Nummer.' },
    { k: 'Dsi, Ekc …', t: 'McIntosh-Klasse', d: 'Drei Buchstaben beschreiben das Aussehen einer Gruppe: 1. Buchstabe = Typ und Größe (A bis H), 2. = Hof des größten Flecks (x r s a h k), 3. = wie dicht die Flecken stehen (x o i c).' },
    { k: 'A B C D E F H', t: 'Gruppentyp (1. Buchstabe)', d: 'A einzelner Fleck ohne Hof · B zweiteilig ohne Hof · C Hof an einem Ende · D Hof an beiden Enden, kurz · E groß · F sehr groß · H einzelner Fleck mit Hof.' },
    { k: 'x r s a h k', t: 'Hof des größten Flecks (2. Buchstabe)', d: 'x kein Hof · r angedeutet · s klein und rund · a klein und unregelmäßig · h groß und rund · k groß und unregelmäßig.' },
    { k: 'x o i c', t: 'Verteilung (3. Buchstabe)', d: 'x Einzelfleck · o offen, kaum Flecken dazwischen · i einige Flecken dazwischen · c kompakt, dicht gepackt.' },
    { k: 'α β γ δ', t: 'Mount-Wilson-Klasse (Magnetfeld)', d: 'α eine Polarität · β Plus und Minus sauber getrennt · γ verwickelt · δ gegensätzliche Pole im selben Hof. Je weiter hinten im Alphabet, desto eher entstehen große Flares.' },
    { k: 'Umbra / Penumbra', t: 'Kernschatten / Hof', d: 'Der dunkle Kern eines Flecks (Umbra) und der graue, faserige Hof darum (Penumbra).' },
    { k: 'Plage', t: 'Helles Fackelgebiet', d: 'Gebiet mit starkem Magnetfeld, das im Kalziumlicht hell leuchtet – oft rund um Fleckengruppen, manchmal auch ohne Flecken.' },
    { k: 'MH', t: 'Millionstel Hemisphäre', d: 'Flächenmaß für Flecken: Anteil an der sichtbaren Sonnenhälfte. Eine Erdscheibe entspricht etwa 42 MH.' },
    { k: 'S08W83', t: 'Position auf der Sonne', d: 'Heliografische Breite (N/S vom Sonnenäquator) und Abstand zur Scheibenmitte (E = Osten/links, W = Westen/rechts) in Grad. Gruppen wandern täglich etwa 13° von Ost nach West.' },
    { k: 'C1 M2.4 X1', t: 'Flare-Klassen', d: 'Helligkeit eines Strahlungsausbruchs im Röntgenlicht, jede Stufe 10× stärker: A, B, C (klein), M (mittel), X (stark). Die Zahl dahinter feiner abgestuft.' },
    { k: 'R1 … R5', t: 'Funkausfall (Radio Blackout)', d: 'Folge von Flares auf der Tagseite der Erde: Kurzwellenfunk wird gestört. R1/R2 durch M-Flares, ab R3 durch X-Flares.' },
    { k: 'CME', t: 'Koronaler Massenauswurf', d: 'Eine ausgeschleuderte Wolke aus Sonnenplasma. Trifft sie nach 1–4 Tagen die Erde, kann sie Polarlichter auslösen.' },
    { k: 'Kp', t: 'Kp-Index', d: 'Maß für die Unruhe des Erdmagnetfelds von 0 (ruhig) bis 9 (extremer Sturm). In Mitteldeutschland sind Polarlichter meist ab Kp 6 bis 7 möglich.' },
    { k: 'G1 … G5', t: 'Geomagnetischer Sturm', d: 'Sturmstufen der NOAA: G1 = Kp 5 bis G5 = Kp 9.' },
    { k: 'S1 … S5', t: 'Strahlungssturm', d: 'Viele energiereiche Protonen von der Sonne – relevant für Satelliten und Raumfahrt, nicht für Beobachter am Boden.' },
    { k: 'SN', t: 'Sonnenfleckenrelativzahl', d: 'Zahl = 10 × Gruppen + Einzelflecken; das klassische Maß für die Sonnenaktivität.' },
    { k: 'F10.7', t: 'Radiofluss bei 10,7 cm', d: 'Radiostrahlung der Sonne als Aktivitätsmaß: ruhig um 70, sehr aktiv über 200.' },
    { k: 'P, B₀, L₀', t: 'Lage der Sonnenachse', d: 'P = Neigung der Sonnenachse gegen Himmelsnord · B₀ = welcher Breitengrad in der Mitte liegt · L₀ = Carrington-Länge der Scheibenmitte.' },
    { k: 'CR', t: 'Carrington-Rotation', d: 'Fortlaufend gezählte Sonnenumdrehungen seit 1853, je rund 27,3 Tage.' },
    { k: 'Seeing', t: 'Luftunruhe', d: 'Wie stark die Luft das Bild flimmern lässt, in Bogensekunden. Unter 2″ gut, über 3,5″ schlecht. Tagsüber vor allem durch aufgeheizten Boden.' },
  ];

  const api = { regionStory, Z, P, C, MW, magSymbol, decode, riskOf, describe, plainSummary, areaPlain, positionPlain, GLOSSARY, P_PLAIN, C_PLAIN, Z_PLAIN, MW_PLAIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SoluxMcIntosh = api;
})(typeof self !== 'undefined' ? self : this);
