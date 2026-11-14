# Push-Takt zuverlässig machen (cron-job.org)

**Warum?** GitHub soll die Push-Prüfung alle 15 Minuten von selbst starten, verzögert oder überspringt
solche Zeitpläne aber oft um Stunden. Deshalb übernimmt ein externer, kostenloser Dienst den Takt:
**cron-job.org** ruft alle 15 Minuten eine GitHub-Adresse auf und startet damit den Workflow „Solux Push“.
Der GitHub-eigene Zeitplan bleibt als stündliche Reserve bestehen. Doppelte Mitteilungen verhindert
Solux selbst, weil jede Meldung höchstens einmal am Tag kommt.

Kosten: keine. Dein Repository ist öffentlich, dafür sind GitHub Actions kostenlos.
Zeitaufwand: etwa 10 Minuten.

---

## Teil A – Zugangsschlüssel bei GitHub erstellen (Fine-grained Token)

Der Schlüssel darf **nur** Workflows im Repository *Solux* starten, sonst nichts.

1. Auf github.com oben rechts auf dein **Profilbild** → **Settings**.
2. Links ganz unten **Developer settings** → **Personal access tokens** → **Fine-grained tokens**.
3. **Generate new token**.
4. Ausfüllen:
   | Feld | Eintrag |
   |---|---|
   | Token name | `Solux Push-Takt` |
   | Description | `cron-job.org startet den Workflow Solux Push` |
   | Resource owner | `ziege1988` |
   | Expiration | **366 days** (oder „Custom“ → ein Jahr; GitHub erinnert dich per Mail vor Ablauf) |
   | Repository access | **Only select repositories** → **ziege1988/Solux** |
5. Unter **Permissions** → **Repository permissions** → **Actions** auf **Read and write** stellen.
   *Metadata: Read-only* setzt GitHub automatisch dazu. **Alles andere bleibt auf „No access“.**
6. **Generate token** → den Schlüssel (beginnt mit `github_pat_…`) **sofort kopieren**.
   GitHub zeigt ihn nur dieses eine Mal an. Schick ihn niemandem und füge ihn nirgends sonst ein.

> Was kann jemand mit diesem Schlüssel anfangen? Nur Workflows in *Solux* starten oder abbrechen.
> Er kann keinen Code ändern, keine Secrets lesen und keine anderen Repositorys sehen.
> Wird er doch einmal bekannt: unter *Fine-grained tokens* auf **Revoke** klicken, neu erstellen.

---

## Teil B – Cronjob bei cron-job.org anlegen

1. Auf **https://cron-job.org** ein kostenloses Konto anlegen (Sign up) und die E-Mail bestätigen.
2. In der Konsole: **Cronjobs** → **Create cronjob**.

### Reiter „Common“ (Allgemein)
| Feld | Eintrag |
|---|---|
| Title | `Solux Push` |
| URL | `https://api.github.com/repos/ziege1988/Solux/actions/workflows/push.yml/dispatches` |
| Enable job | an |
| Save responses in job history | an (hilft bei der Fehlersuche) |
| Execution schedule | **Every 15 minutes** |

*Optional, spart Läufe in der Nacht:* „Custom“ wählen → Stunden **5 bis 21** anhaken, Minuten **0, 15, 30, 45**.
Solux schickt ohnehin nur, wenn die Sonne über dem Horizont steht.

### Reiter „Advanced“ (Erweitert)
| Feld | Eintrag |
|---|---|
| Time zone | `Europe/Berlin` |
| Request method | **POST** |
| Timeout | 30 Sekunden |

**Headers** – drei Einträge mit „Add header“ (Name → Wert):

| Name | Wert |
|---|---|
| `Authorization` | `Bearer github_pat_…` ← *dein Schlüssel aus Teil A, mit „Bearer “ und Leerzeichen davor* |
| `Accept` | `application/vnd.github+json` |
| `X-GitHub-Api-Version` | `2022-11-28` |

**Request body** (genau so, eine Zeile):

```json
{"ref":"claude/solux-mac-sun-widget-f63z9q","inputs":{"test":"false"}}
```

> `ref` ist der Zweig, auf dem Solux liegt. Ändert sich der Hauptzweig einmal, muss er hier angepasst werden.

### Reiter „Notifications“ (optional, empfohlen)
- **Notify me when execution of the cronjob fails** → an, damit du ein abgelaufenes Token sofort merkst.

3. Unten **Test run** → **Start test run**.
   **Erwartet:** Status **204 No Content** (manchmal 200). Das ist der Erfolg, die Antwort ist absichtlich leer.
4. **Create** bzw. **Save**.

---

## Teil C – Prüfen

1. Auf GitHub im Repository → **Actions** → links **Solux Push**.
2. Nach dem Testlauf erscheint ein neuer Lauf mit dem Auslöser **workflow_dispatch**.
3. Lauf öffnen → Schritt **Prüfen und senden**. Dort steht z. B.
   `Gerät a1b2c3 (interessant): 0 Mitteilung(en)`. Das ist normal, solange nichts Interessantes passiert.
4. Ab jetzt erscheint alle 15 Minuten ein neuer Lauf.

**Testmitteilung ans iPhone:** auf GitHub → Actions → Solux Push → **Run workflow** →
Haken „Testmitteilung senden“ setzen → **Run workflow**. Ohne Haken (also auch bei cron-job.org) wird nie ein Test geschickt.

---

## Fehler und Lösungen

| Meldung bei cron-job.org | Ursache | Lösung |
|---|---|---|
| **401 Unauthorized** | Schlüssel falsch, abgelaufen oder „Bearer “ fehlt | Header prüfen bzw. neues Token erstellen (Teil A) |
| **403 Forbidden** | Token hat keine Actions-Berechtigung oder nicht für *Solux* | Token bearbeiten: Repository *Solux*, Actions = Read and write |
| **404 Not Found** | URL vertippt oder Token sieht das Repository nicht | URL exakt kopieren, Repository-Zugriff des Tokens prüfen |
| **422 Unprocessable Entity** | `ref` falsch oder Body kein gültiges JSON | Body exakt wie oben einfügen |
| 204, aber kein Lauf bei GitHub | Actions im Repository deaktiviert | Repository → Settings → Actions → General → „Allow all actions“ |

**Einmal im Jahr:** GitHub schickt eine Mail, bevor das Token abläuft. Dann unter *Fine-grained tokens*
→ Token öffnen → **Regenerate token** → neuen Schlüssel bei cron-job.org im Header `Authorization` ersetzen.
