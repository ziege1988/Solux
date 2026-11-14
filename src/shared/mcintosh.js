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

  const api = { Z, P, C, MW, magSymbol, decode, riskOf, describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SoluxMcIntosh = api;
})(typeof self !== 'undefined' ? self : this);
