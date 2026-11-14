# Solux

Sonnen-Widget für den Mac. Solux zeigt die aktuelle Sonne im Weißlicht oder Kalziumlicht mit den
aktiven Regionen, die Beobachtungsbedingungen am eigenen Standort und Meldungen zur Sonnenaktivität.
Im Fenster **Aufnahmen** werden eigene Sonnenbilder automatisch ausgerichtet (Norden oben, Osten links),
beschriftet und mit Legende und Textdatei gespeichert.

## Funktionen

**Reiter Sonne (Widget)**
- Aktuelles SDO-Bild, umschaltbar zwischen **Weißlicht** (HMI-Kontinuum) und **Kalzium** (AIA 1700 Å)
- Fleckengruppen mit NOAA-Nummer, McIntosh- und Mt.-Wilson-Klasse; Klick öffnet die Erklärung mit
  Flare-Potenzial und Flächenverlauf
- P, B₀, L₀ und Carrington-Rotation
- Sonnenhöhe des Tages am Standort, mit Sommer- und Winterkurve, Auf- und Untergang und Jahreszeit
- Ampeln für **Wetter**, **Seeing** und **Wind**; ein Klick zeigt Details und eine Stundenprognose
- Newsroom: Flares, Kp-Prognose, Polarlicht-Chance für den Standort, SWPC-Warnungen, neue Regionen
- Einstellungen über das Zahnrad, Beenden über das ×, verschiebbar am Rand und an der Titelzeile
- Startbild (H-Alpha-Sonne mit Schriftzug) nach manuellem Start und nach Updates
- Sonnensymbol in der Menüleiste: Widget ein- und ausblenden, Aufnahmen, Einstellungen, Beenden

**Aufnahmen**
- JPEG, TIFF (auch 16 Bit) oder PNG per Drag & Drop
- Aufnahmezeit aus den EXIF-Daten; ohne EXIF wird das Dateidatum genutzt, die Zeit ist von Hand änderbar
- Mitlaufendes Protokoll mit Animationen: Randerkennung, Ephemeriden, Referenzbild, Korrelationssuche
- **Automatische Ausrichtung** durch Abgleich mit dem SDO-Bild zur Aufnahmezeit, mit Drehung und Spiegelung
- Bei zu wenigen Merkmalen (eine oder keine Fleckengruppe) fragt Solux nach:
  **„Ausrichten nicht möglich – trotzdem fortfahren?“**. Dann stehen drei Wege offen:
  - letzte Ausrichtung übernehmen, um die Bildfeldrotation der azimutalen Montierung korrigiert
  - manuell ausrichten
  - ohne Ausrichtung weiter
- Beschriftung mit NOAA-Nummer und McIntosh-Klasse, optional mit heliografischem Gradnetz
- **Speichern**: JPEG in einstellbarer Qualität (Standard 95 %) plus Textdatei. Die Legende am rechten
  Bildrand lässt sich per Haken an- oder abwählen.

## Datenquellen

| Daten | Quelle | Speicher |
|---|---|---|
| Sonnenbilder | NASA SDO über [Helioviewer.org](https://helioviewer.org) | jeder Zeitpunkt seit 2010 online abrufbar, nur Zwischenspeicher |
| Regionen, Klassen, Flare-Wahrscheinlichkeiten | NOAA SWPC `solar_regions.json` | online ca. 30 Tage, **lokal 60 Tage gesammelt** |
| Flares (GOES), Kp, Warnungen | NOAA SWPC | online 3 bis 7 Tage, **lokal 60 Tage gesammelt** |
| Wetter, Wind, Wolken, Höhenwind | [Open-Meteo](https://open-meteo.com) | nicht gespeichert |

Die lokalen Daten liegen unter `~/Library/Application Support/Solux/cache`.

## Seeing-Modell

Für Tages-Seeing gibt es keinen offenen Dienst. Solux schätzt es deshalb aus Open-Meteo-Daten für deinen Standort:
- **Bodenschicht:** Sonneneinstrahlung, Boden- minus Lufttemperatur, Wind und Böen, gewichtet mit dem
  Untergrund (Pflaster heizt stark auf)
- **Freie Atmosphäre:** Windscherung zwischen 850 und 500 hPa
- **Jetstream:** Wind auf 250 und 200 hPa
- **Lichtweg:** Luftmasse aus der Sonnenhöhe

Die Beiträge werden physikalisch korrekt kombiniert: ε = (Σ εᵢ^5/3)^3/5 · (sec z)^3/5.

Die Werte sind am Anfang eine **Tendenz**. Mit der Bewertung 1 bis 5 im Seeing-Fenster lernt Solux einen
Kalibrierfaktor für deinen Hof.

## Installation

### Variante A: fertige App aus GitHub (empfohlen)
1. Im Repository unter **Actions → „Solux bauen“ → Run workflow** einen Build starten, oder einen
   Versions-Tag pushen (siehe „Neue Version veröffentlichen“).
2. Unter **Releases** (bzw. im Artefakt des Workflow-Laufs) die passende Datei laden:
   - Apple Silicon (M1/M2/M3/M4): `Solux-<version>-mac-arm64.dmg`
   - Intel-Mac: `Solux-<version>-mac-x64.dmg`
3. DMG öffnen und Solux in den Ordner **Programme** ziehen.
4. **Erster Start:** Solux ist nicht von Apple notarisiert, weil es nur für dich gedacht ist. macOS meldet
   deshalb, dass die App nicht geprüft werden kann. Einmalig freigeben:
   - **Systemeinstellungen → Datenschutz & Sicherheit → „Dennoch öffnen“**, oder
   - im Terminal: `xattr -cr /Applications/Solux.app`

### Variante B: selbst bauen auf dem Mac
```bash
# einmalig: Node.js 20 installieren (https://nodejs.org)
git clone https://github.com/ziege1988/Solux.git
cd Solux
npm install
npm start            # direkt starten (Entwicklungsmodus)
npm run dist         # App bauen -> dist/Solux-…-mac-arm64.dmg / -x64.dmg
```

## Erste Einrichtung

1. **Zahnrad → Standort:** Den Ort suchen (Open-Meteo-Geokodierung) oder die Koordinaten deines Hofs
   eintragen. Voreingestellt ist Unterleichtersbach mit 50,28° N / 9,80° E. Das ist nur ein Näherungswert,
   bitte prüfen.
2. **Montierung:** azimutal (voreingestellt), **Untergrund:** Pflaster (voreingestellt).
3. **Aufnahmen:**
   - Kamerazeit wählen (Ortszeit oder UTC)
   - Zielordner festlegen, das geht auch beim ersten Speichern
4. Die **ersten Aufnahmen mit mindestens zwei Fleckengruppen** füllen das Setup-Profil. Solux lernt daraus:
   - ob das Bild gespiegelt ist
   - die Drehrichtung der Bildfeldrotation

   Danach klappt die Ausrichtung auch bei nur einer Fleckengruppe.

## Updates

- Solux prüft automatisch zweimal täglich, ob es ein neueres GitHub-Release gibt. Manuell geht das unter
  **Zahnrad → Updates → Nach Updates suchen**.
- **Installieren und neu starten** lädt das passende Paket und beendet Solux. Danach wird die App ersetzt und
  mit Startbild neu geöffnet.

### Neue Version veröffentlichen
```bash
git tag v1.0.1
git push origin v1.0.1
```
Der Workflow `.github/workflows/release.yml` baut die Pakete auf einem Mac-Runner (Apple Silicon und Intel)
und veröffentlicht das Release. Die Versionsnummer wird aus dem Tag übernommen.

## Entwicklung

```
src/shared/astro.js      Sonnenstand, P/B0/L0, parallaktischer Winkel, heliografische Koordinaten (Meeus)
src/shared/seeing.js     Seeing-Modell und Kalibrierung
src/shared/align.js      Randerkennung, Polar-Korrelation, Fleckenerkennung, Zuordnung
src/shared/mcintosh.js   McIntosh- und Mt.-Wilson-Klassen mit Erklärungen
src/main/                Electron-Hauptprozess: Fenster, Menüleiste, Daten, Updater
src/renderer/            Oberflächen: Widget, Aufnahmen, Startbild
test/                    Tests (npm test)
docs/mockup/             ursprünglicher Klick-Prototyp
```

`npm test` prüft unter anderem:
- die Ephemeriden gegen das Meeus-Referenzbeispiel
- die Regionspositionen gegen den NOAA-Bericht
- das Seeing-Modell und den Updater

## Grenzen

- **Ausrichtung:** braucht im Weißlicht mindestens etwa zwei Fleckengruppen. Im Kalziumlicht reichen meist
  die Plages. Die Genauigkeit liegt bei etwa 0,5° (Weißlicht) bzw. 0,1° (Kalzium).
- **Bildfeldrotation:** „Letzte Ausrichtung übernehmen“ setzt voraus, dass die Kamera seitdem nicht gedreht
  wurde.
- **NOAA-Klassifikation:** stammt aus dem Bericht von 00 UT. Die Positionen werden auf die Aufnahmezeit
  umgerechnet, die Klassen nicht.
- **Seeing:** bleibt eine Modellschätzung, siehe oben.
- **Fenster:** Solux ist ein normales, randloses Fenster. Ein Fenster direkt auf Desktop-Ebene könnte unter
  macOS keine Klicks annehmen. Mit „Immer im Vordergrund“ bleibt es sichtbar, sonst liegt es wie andere
  Fenster im Stapel.
