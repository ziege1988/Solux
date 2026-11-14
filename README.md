# Solux

Sonnen-Widget für den Mac. Solux zeigt die aktuelle Sonne im Weißlicht oder Kalziumlicht mit den
aktiven Regionen, die Beobachtungsbedingungen am eigenen Standort und Meldungen zur Sonnenaktivität.
Im Fenster **Aufnahmen** werden eigene Sonnenbilder automatisch ausgerichtet (Norden oben, Osten links),
beschriftet und mit Legende und Textdatei gespeichert.

## Funktionen

**Reiter Sonne (Widget)**
- Aktuelles Sonnenbild, umschaltbar zwischen **Weißlicht** (SDO/HMI, Hauptansicht), **Kalzium** (SDO/AIA 1700 Å)
  und **H-Alpha** (NSO/GONG)
- **Flares** der letzten 24 h als Markierung im Bild (antippen für Details), Flares je Region im Erklärungsfenster
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
- Nach dem Laden fragt Solux in einem Dialog **Datum, Uhrzeit, Wellenlänge und Bildart** ab. Das Datum wird
  aus dem **Dateinamen** gelesen (z. B. `Sonne_23.04.2024_1042.jpg`, `2024-04-23-1042_…` von FireCapture);
  EXIF wird nicht verwendet, da es nach Stacking/Bearbeitung nicht die Aufnahmezeit enthält. Fehlt das Jahr,
  nimmt Solux das letzte passende an und weist darauf hin. „Uhrzeit unbekannt“ setzt 12:00 Ortszeit an, dazu optional den **Bildmaßstab** (Brennweite, Pixelgröße, Binning). Mit
  **Starten** oder **Abbrechen** geht es weiter.
- Drei Bildarten, automatisch erkannt oder fest gewählt:
  - **Ganze Sonne:** Abgleich über die ganze Scheibe
  - **Ausschnitt mit Sonnenrand:** Mittelpunkt aus dem sichtbaren Randbogen (mit Maßstab schon ab
    etwa 15° Bogen), Abgleich nur im sichtbaren Bereich
  - **Oberfläche ohne Rand** (z. B. Fleckengruppe): Solux sucht das Fleckenmuster auf der ganzen
    SDO-Sonne und bestimmt Lage, Drehung und Spiegelung. Dafür sind der Bildmaßstab und mindestens drei
    Flecken im Bild nötig. Die Ausgabe enthält heliografisches Gradnetz, Nordpfeil und Maßstabsbalken.
- Mitlaufendes Protokoll mit Animationen: Randerkennung, Ephemeriden, Referenzbild, Korrelationssuche
- **Automatische Ausrichtung** durch Abgleich mit dem SDO-Bild zur Aufnahmezeit, mit Drehung und Spiegelung
- Bei zu wenigen Merkmalen (eine oder keine Fleckengruppe) fragt Solux nach:
  **„Ausrichten nicht möglich – trotzdem fortfahren?“**. Dann stehen drei Wege offen:
  - letzte Ausrichtung übernehmen, um die Bildfeldrotation der azimutalen Montierung korrigiert
  - manuell ausrichten
  - ohne Ausrichtung weiter
- Beschriftung mit NOAA-Nummer und McIntosh-Klasse, optional mit heliografischem Gradnetz
- **Text neben dem Bild:** kein Text, **Liste** aller Regionen oder **Zusammenfassung** der aktivsten Regionen
  (Fazit, Größe in Erdscheiben, Lage, Fleckenzahl)
- **Entfernungsskala** (ganze Sonne):
  - Höhenringe 50.000 / 100.000 / 150.000 km
  - Kranz mit Strichen alle 5° und 30°
  - Höhenlineale Ost–West, wahlweise **außen** oder **durchgehend** über die Scheibe
  - Maßstab aus dem gemessenen Sonnenradius (≙ 696.000 km)
  - Reicht das Bild nicht aus, wird der Himmel mit passender Farbe und Körnung unauffällig erweitert.
- **Export-Dialog:** Text, Skala, Beschriftung, Gradnetz, Flares des Tages, Protuberanzen, **JPEG** (90/95/100) oder
  **TIFF** (verlustfrei), Textdatei ja oder nein. Vorschau von Dateiname, Größe und Ordner.
- **H-Alpha** (neu in 1.5): Abgleich mit dem GONG-H-Alpha-Bild zur Aufnahmezeit (Filamente und Plages).
  Die Wellenlänge erkennt Solux so:
  - am Dateinamen: `ha`, `halpha`, `h-alpha`, `656`
  - an der Bildfarbe, wenn blau oder violett: Kalzium
  - an einem negativ bearbeiteten, weißen Himmel: H-Alpha
  - bei orangen Bildern durch Abgleich mit beiden Referenzen (Weißlicht/H-Alpha)

  Die **Protuberanzen** werden automatisch gemessen. Pro Protuberanz gibt Solux an:
  - die Höhe über dem Rand in km (projiziert, also eine Mindesthöhe)
  - die Breite
  - den Positionswinkel von Sonnennord über Ost
  - die heliografische Breite

  Im Bild sind sie markiert, in Legende und Textdatei aufgeführt.
  **Flares** des Aufnahmetags (±12 h) sind bei H-Alpha standardmäßig markiert: je Region der stärkste, z. B. „M1.8 +36“.
  Dazu kommen ein Abschnitt in der Legende, ein Satz in der Zusammenfassung und eine vollständige Liste in der
  Textdatei. Flares der letzten 60 Tage hat Solux lokal. Für ältere Aufnahmen lädt es die Tagesliste aus dem
  NOAA-Ereignisarchiv (NCEI, lückenlos seit 1996) und speichert sie dauerhaft.
- **Bildschärfe:** Solux misst die Breite des Randabfalls in Bogensekunden. Bei Weißlicht kalibriert das automatisch das
  Seeing-Modell (siehe unten).
- **Beobachtungstagebuch** (Knopf „Tagebuch“): Jede ausgewertete Aufnahme wird automatisch mit diesen Angaben gespeichert:
  - Vorschau und ausgerichtete Fassung
  - Regionen und Protuberanzen
  - Bildschärfe
  - Notiz

  Filter nach Wellenlänge. **Region verfolgen** spielt die Entwicklung einer Gruppe über mehrere Tage als
  Animation ab, mit Tabelle aus Klasse, Fläche und Fleckenzahl. Ablage: `~/Library/Application Support/Solux/diary`.

## Solux mobil (iPhone)

Die Hauptseite „Sonne“ gibt es zusätzlich als Web-App fürs Handy, ohne Aufnahmen-Teil:
**https://ziege1988.github.io/Solux/**

- Gleicher Code wie das Mac-Widget (`src/shared`, `src/renderer/widget.*`), eigene Datenanbindung im
  Browser (`web/api-web.js`)
- Daten direkt von NOAA SWPC, Open-Meteo und Helioviewer, ohne eigenen Server
- Standort und Einstellungen bleiben auf dem Handy (lokaler Speicher)
- Wird bei jeder Änderung automatisch über GitHub Pages veröffentlicht
  (`.github/workflows/pages.yml`)

**Auf dem iPhone installieren:** Link in **Safari** öffnen → Teilen-Symbol → **Zum Home-Bildschirm**
→ „Als Web-App öffnen“ eingeschaltet lassen → Hinzufügen.

Lokal testen: `node scripts/build-web.js`, dann `dist-web/` mit einem beliebigen Webserver ausliefern.

## Push-Mitteilungen

Drei Stufen, am Mac und am iPhone unter Zahnrad → Mitteilungen:

- **Nur interessante Meldungen** (Standard):
  - X-Flares und M-Flares ab M5
  - besonders aktive oder große Fleckengruppen im Blickfeld (δ-Magnetfeld, über 300 MH, große E/F-Gruppen, M-Flare-Chance ab 40 % oder X-Flare-Chance ab 10 %)
  - Polarlicht-Chance am Standort
  - starke Stürme und Protonenereignisse
- **Alle neuen Meldungen:** zusätzlich jeder M-Flare, neue Regionen und geomagnetische Stürme
- **Aus**

Regeln:
- Mitteilungen kommen nur, solange die **Sonne am Standort über dem Horizont** steht.
- Jede Region bzw. Meldung kommt **höchstens einmal am Tag**. Neue Ereignisse, z. B. ein weiterer Flare, werden einzeln gemeldet.

**Mac:** Solux meldet sich direkt, solange die App läuft.

**iPhone:** Der Workflow `.github/workflows/push.yml` prüft und sendet Web-Push. Den 15-Minuten-Takt übernimmt
**cron-job.org**, weil GitHubs eigener Zeitplan unzuverlässig ist. Die Einrichtung steht in [docs/PUSH-TAKT.md](docs/PUSH-TAKT.md). Die Mitteilung kommt
auch, wenn Solux mobil geschlossen ist, denn die App muss dafür nicht laufen.

Einrichtung (einmalig):
1. Secret `VAPID_PRIVATE_KEY` anlegen (GitHub → Settings → Secrets and variables → Actions).
2. Solux mobil vom Home-Bildschirm öffnen → Zahnrad → Mitteilungen → Stufe wählen → **Mitteilungen aktivieren** →
   **Code kopieren**.
3. Secret `PUSH_SUBSCRIPTIONS` anlegen bzw. ersetzen und den Code einfügen. Nach einem Wechsel der Stufe den Code erneut
   kopieren und den alten Wert ersetzen. „Aus“ wirkt sofort, ohne GitHub.
4. Optional unter **Variables**: `PUSH_LAT` und `PUSH_LON` (Standort für Sonnenstand und Polarlicht, Standard
   50.28 / 9.80) sowie `PUSH_MODE=aus` zum Pausieren aller Geräte.
5. Test: GitHub → Reiter **Actions** → links **„Solux Push“** → rechts **„Run workflow“** → grüner Knopf
   **Run workflow**. Die Testmitteilung kommt nach etwa einer Minute.

Hinweis: GitHubs eigener Zeitplan läuft nur noch stündlich als Reserve. Er startet oft mit großer Verzögerung und
pausiert, wenn das Repository 60 Tage lang nicht verändert wurde. Der Takt über cron-job.org ist davon nicht betroffen.

## Datenquellen

| Daten | Quelle | Speicher |
|---|---|---|
| Sonnenbilder | NASA SDO über [Helioviewer.org](https://helioviewer.org) | jeder Zeitpunkt seit 2010 online abrufbar, nur Zwischenspeicher |
| Regionen, Klassen, Flare-Wahrscheinlichkeiten | NOAA SWPC `solar_regions.json` | online ca. 30 Tage, **lokal 60 Tage gesammelt** |
| Regionen älterer Tage | NOAA/NCEI-Archiv der Tagesberichte (SRS) | jeder Tag seit 1996, bei Bedarf geladen |
| Flares mit Region und Ort | NOAA SWPC `edited_events.json` | ca. 30 Tage, lokal 60 Tage |
| H-Alpha-Bild | NSO/GONG über Helioviewer | jeder Zeitpunkt |
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

Die Werte sind am Anfang eine **Tendenz**. Ab 1.5 kalibriert Solux sich **automatisch aus deinen Weißlicht-Aufnahmen**.
1. Solux misst die Randschärfe der Aufnahme.
2. Solux berechnet das Modell-Seeing zur Aufnahmezeit, mit den Open-Meteo-Stundenwerten des Tages (ältere Tage aus dem Vorhersage-Archiv).
3. Der Median aller Verhältnisse gemessen/Modell wird ab 2 Aufnahmen der Kalibrierfaktor (0,5–2).

Einschränkungen:
- Die Messung enthält auch die Optik und die Bildbearbeitung (Schärfung). Das Modell wird also auf die Schärfe
  *deiner* Bilder kalibriert, nicht auf das reine Seeing. Bei gleichbleibendem Arbeitsablauf ist das gewollt.
- Kalzium und H-Alpha zählen nicht mit: Ihr Rand ist von Natur aus weich (Chromosphäre).

Den Faktor zeigt Zahnrad → Über Solux an. Für das iPhone lässt er sich dort von Hand übernehmen.

## Installation

### Variante A: fertige App aus GitHub (empfohlen)
1. Im Repository unter **Actions → „Solux bauen“ → Run workflow** einen Build starten, oder einen
   Versions-Tag pushen (siehe „Neue Version veröffentlichen“).
2. Unter **Releases** (bzw. im Artefakt des Workflow-Laufs) die passende Datei laden:
   - Apple Silicon (M1/M2/M3/M4): `Solux-mac-arm64.dmg`
   - Intel-Mac: `Solux-mac-x64.dmg`
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
npm run dist         # App bauen -> dist/Solux-mac-arm64.dmg / Solux-mac-x64.dmg
```

## Erste Einrichtung

1. **Zahnrad → Standort:** Den Ort suchen (Open-Meteo-Geokodierung) oder die Koordinaten deines Hofs
   eintragen. Voreingestellt ist Unterleichtersbach mit 50,28° N / 9,80° E. Das ist nur ein Näherungswert,
   bitte prüfen.
2. **Montierung:** azimutal (voreingestellt), **Untergrund:** Pflaster (voreingestellt).
3. **Ausrüstung:** Montierung sowie je Wellenlänge (Weißlicht, Kalzium, H-Alpha) Brennweite inklusive Barlow,
   Pixelgröße und Binning. Dazu der Zielordner für Exporte, der sich auch beim ersten Export festlegen lässt.
4. Die **ersten Aufnahmen mit mindestens zwei Fleckengruppen** füllen das Setup-Profil. Solux lernt daraus:
   - ob das Bild gespiegelt ist
   - die Drehrichtung der Bildfeldrotation

   Danach klappt die Ausrichtung auch bei nur einer Fleckengruppe.

## Updates

- Solux prüft automatisch zweimal täglich, ob es ein neueres GitHub-Release gibt. Manuell geht das unter
  **Zahnrad → Über Solux → Nach Updates suchen**.
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
