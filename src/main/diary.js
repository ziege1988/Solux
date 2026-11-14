/*
 * Solux – Beobachtungstagebuch
 *
 * Jede ausgewertete Aufnahme wird mit Vorschaubild (≈ 360 px) und einer ausgerichteten Fassung (Norden oben,
 * ≈ 1000 px) gespeichert. Die ausgerichtete Fassung dient dem Regionsvergleich: Für jede Region sind die
 * Scheibenkoordinaten gespeichert, so lässt sich der Ausschnitt über mehrere Tage zur Animation zusammensetzen.
 * Ablage: ~/Library/Application Support/Solux/diary (index.json + JPEGs).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Diary {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'index.json');
  }
  load() {
    if (this.entries) return this.entries;
    try { this.entries = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.entries = []; }
    return this.entries;
  }
  save() {
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.entries));
    fs.renameSync(this.file + '.tmp', this.file);
  }
  img(id, kind) { return path.join(this.dir, `${id}_${kind}.jpg`); }

  /** Eintrag anlegen oder ersetzen (gleiche Datei + gleiche Aufnahmezeit = derselbe Eintrag). */
  add(entry, thumb, aligned) {
    const list = this.load();
    const id = crypto.createHash('sha1').update(`${entry.file}|${entry.time}|${entry.mode}`).digest('hex').slice(0, 12);
    const i = list.findIndex((e) => e.id === id);
    const e = { ...entry, id, added: new Date().toISOString() };
    if (thumb) fs.writeFileSync(this.img(id, 't'), Buffer.from(thumb));
    if (aligned) fs.writeFileSync(this.img(id, 'a'), Buffer.from(aligned));
    if (i >= 0) list[i] = { ...list[i], ...e, note: list[i].note || e.note }; else list.push(e);
    list.sort((a, b) => new Date(b.time) - new Date(a.time));
    this.save();
    return id;
  }
  /** Liste mit eingebetteten Vorschaubildern (data-URL). */
  list() {
    return this.load().map((e) => {
      let thumb = null;
      try { thumb = 'data:image/jpeg;base64,' + fs.readFileSync(this.img(e.id, 't')).toString('base64'); } catch { /* fehlt */ }
      return { ...e, thumb };
    });
  }
  image(id) {
    try { return 'data:image/jpeg;base64,' + fs.readFileSync(this.img(id, 'a')).toString('base64'); } catch { return null; }
  }
  remove(id) {
    this.entries = this.load().filter((e) => e.id !== id);
    for (const k of ['t', 'a']) fs.rmSync(this.img(id, k), { force: true });
    this.save();
    return true;
  }
  note(id, text) {
    const e = this.load().find((x) => x.id === id);
    if (e) { e.note = String(text || '').slice(0, 2000); this.save(); }
    return !!e;
  }
  info() {
    const list = this.load();
    let bytes = 0; try { for (const f of fs.readdirSync(this.dir)) bytes += fs.statSync(path.join(this.dir, f)).size; } catch { /* leer */ }
    return { count: list.length, bytes, dir: this.dir };
  }
}

module.exports = { Diary };
