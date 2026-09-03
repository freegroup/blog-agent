# BlogAgent — Architektur & Stand

Aus einem Impuls (Telegram-Text, -Foto oder -Sprachnachricht) entsteht ein Markdown-Artikel,
der als GitHub-PR eingereicht wird. Wohin er geht und in welcher Stimme, weiß nur das Briefing.

Ziel-Blog: [camper-elektrik-planer.de](https://camper-elektrik-planer.de) als PR gegen
`freegroup/CampingElectricCalculator`.

Arbeitsdokument. Stand 31.08.2026 (an die Implementierung angeglichen).

---

## 1. Architektur

**Vorwärts** · Impuls → Artikel → PR

```
   Telegram  ─►  source-telegram  ─►  research  ─┐   (research reichert den Envelope um `context` an)
                                                  ▼
   PR-Komm.  ─►  source-github  ──────────────►  newsroom  ─►  sink-github  ─►  PR ─►[ Merge ]─► Blog
              (Revision: überspringt research)    (Pipeline)       │              (Zielsystem baut/deployt)
                                                      │            └─ auch: sink-file (Debug), sink-deadletter (Fehler)
                                                      └─ nutzt: mcp-calc · tools/{llm, image, stt}
```

Sources und Filter reden dasselbe REST (`POST /pitches` rein, `POST` an ihr `out` raus),
darum sind sie verkettbar: `source-telegram` schickt an `research`, `research` an den `newsroom`.
`source-github` (Revision) überspringt `research` und postet direkt in den Newsroom — die Fakten
stehen schon im `blogagent.yaml`. Jedes `out` steht in `settings.yaml`.

**Rückwärts** · Rückmeldung an den User

```
   sink-github      ──►  „PR bereit"
   sink-deadletter  ──►  „aufgegeben (Fehler)"     ── jede Meldung läuft auch in den chat-Hub (SSE) ──
   watch-rss        ──►  „Blog ist live"              (erkennt den Deploy über den RSS-Feed)   ──►  Telegram
   source-github    ──►  Owner-Kommentar am PR  →  Revision desselben PR
```

Support-Ebene (nicht im Bild): `mcp-telegram` hält den Telegram-Token (Gateway rein/raus),
`chat` protokolliert die ganze Konversation und broadcastet sie per SSE an Subscriber.

- **Sources** erzeugen Envelopes, **Sinks** nehmen fertige Artikel entgegen — beide unabhängig
  austauschbar. Die Redaktion (`newsroom`) kennt weder Telegram noch GitHub.
- **Der Merge ist das Imprimatur.** Jeder Kanal geht über einen PR. BlogAgent erzeugt PRs;
  was daraus wird (HTML rendern, Deploy), macht das Zielsystem (GitHub Action auf `push`).
- **Der Agent ist fachfremd.** Thema, Tonfall, Regeln, verlinkbare Ziele und Bildvorgaben
  kommen aus dem Briefing (§6). Im Code liegt kein Fachwissen; Rechnen macht `mcp-calc`.
- **Sources liefern ab und vergessen** (`202 { id }`). Die Redaktion organisiert Reihenfolge,
  Wiederholung und Ablage selbst. Ergebnis/Fehler meldet der **Sink** zurück (Telegram), nicht
  die Redaktion.
- **Sprache:** Node (ESM), Monorepo mit npm-Workspaces (`services/*`, `shared/*`, `tools/*`).
- **Betrieb:** pm2 — `ecosystem.config.cjs` (prod) und `ecosystem.local.config.cjs` (lokal,
  zusätzlich `sink-file` als Debug-Spiegel).

### Prozesse

| Prozess | Port | Rolle |
|---|---|---|
| `newsroom` | 5080 | Nimmt Pitches an, fährt die Pipeline, liefert an die Sinks. Hält die Queue. |
| `research` | 5085 | Filter vor dem Newsroom: reichert den Envelope um `context` an, reicht an `out` weiter. |
| `sink-github` | 5081 | Legt PRs an (Verzeichnis-Bundle je Artikel). Hält Repo + Token. **Validiert nicht — liefert nur aus.** |
| `sink-file` | 5082 | Debug-Spiegel (`logging-sink`): schreibt `var/sink/<slug>/`. Keine Secrets. |
| `sink-deadletter` | 5083 | Endgültig gescheiterte Pitches → Telegram + Datei `var/deadletter/<id>.yaml`. |
| `chat` | 5090 | Chat-Hub: einziges Protokoll der Konversation + SSE-Broadcast. |
| `source-telegram` | — | Long-Polling (via `mcp-telegram`), Sprach-Transkription (STT), pitcht; speist den Hub. |
| `source-github` | — | Pollt gelabelte PRs, macht Owner-Kommentare zu Revise-Pitches. |
| `watch-rss` | — | Pollt den Blog-RSS-Feed, meldet neue **live** Beiträge auf Telegram + Hub. |
| `mcp-calc` | — | MCP-Kindprozess: `wire_cross_section` (Kabelquerschnitt). Fachtool. |
| `mcp-telegram` | — | MCP-Gateway: `read_messages`/`load_file`/`send_message`. Einzige Stelle mit dem Telegram-Token. |

MCP-Server (`mcp-calc`, `mcp-telegram`) sind **nicht** in pm2 — sie werden per stdio als Kind
der Services gestartet, die sie brauchen. Zwei `mcp-telegram`-Poller mit demselben Token gäben
sonst 409 (deshalb pollt nur `source-telegram`).

### Workspaces

```
shared/   config · envelope · http (fetchWithRetry+Timeout) · mcp · chat (Hub-Client)
tools/    llm · image · stt · tts        (Adapter zu externen APIs, provider-gewählt)
services/ (siehe Tabelle oben)
```

### Dienst-Aufbau (Konvention)

Ein Grundsatz löst die „läuft-als-Prozess-oder-importiert?"-Frage: **`index.js` wird von
niemandem importiert und ist reines Bootstrap** — Config lesen, Server/Loop starten, Signale.
Alles Testbare liegt daneben, in eigenen Modulen. Kein Run-as-main-Guard nötig.

Zwei Ausprägungen derselben Regel:

```
REST-Dienst (empfängt Calls)          Poller (holt sich Arbeit)
─────────────────────────────         ─────────────────────────────
index.js    Bootstrap, nie importiert  index.js    Bootstrap, nie importiert
handler.js  parst Request, delegiert   poll.js     "verarbeite ein Item" + reine Logik
<logik>.js  reine Fachlogik/Utils       <logik>.js  reine Helfer
test/                                   test/
```

Handler und Poll-Callback sind dasselbe Muster: Eingabe entpacken → an reine Logik delegieren;
nur die Quelle der Eingabe (Request vs. gepolltes Item) unterscheidet sich. Beispiele:
`research` (`handler.js` + `context.js`), `source-github` (`poll.js`), `newsroom`
(`dispatch.js`/`queue.js`/`pipeline/`), `sink-instagram` (`instagram.js`).

---


## 2. Envelope — der Eingang

Die einzige Form, in der ein Impuls die Redaktion erreicht. Jede Source normalisiert darauf.

```json
{
  "id": "01J…",
  "source": "telegram",
  "source_ref": "chat:1234/msg:5678",
  "received_at": "2026-08-31T09:00:00Z",
  "text": "…",
  "media": [{ "kind": "image", "mime": "image/jpeg", "data": "<base64>" }],
  "revises": null,
  "doc": null,
  "review": [],
  "context": null
}
```

- `media`: base64 inline (kein URL-Transport). Darf leer sein.
- `revises`: `github:<owner>/<repo>#<nr>` oder `null`. **Ableitbar, nicht opak** — eine Source
  baut ihn selbst. Pipeline-Feld, wird unverändert an den Sink durchgereicht; das Modell sieht
  ihn nicht.
- `doc` / `review` (**nur bei Revision**): `doc` ist das zurückgelesene `blogagent.yaml` (die
  Wahrheit des Artikels), `review` der Kommentarverlauf. Jede Pipeline-Stufe sieht beides und
  entscheidet auf ihren eigenen Feldern, ob sie durchreicht, anpasst oder neu macht (§4).
- `context`: die geteilten Fakten, die der `research`-Filter einmal pro Pitch anreichert
  (Ziel-URL & Referenzen, §8). `null`, wenn eine Source direkt in den Newsroom postet. Fließt in
  jeden Job-Doc und damit ins `blogagent.yaml`.
- Kein `trust`-Feld (im Ur-Entwurf vorgesehen, nicht umgesetzt — siehe §9).

### Redaktions-API

```
POST /pitches       → 202 { id }
GET  /pitches/{id}  → { state: pending|done|failed, … }
```

Die Redaktion meldet nichts von sich aus. Ergebnis-Meldung an den User macht der Sink über
Telegram; das „ist online"-Signal kommt später von `watch-rss` (§7).

---

## 3. Die Pipeline

Der Kern des `newsroom`. Ein Dokument (`doc`) fließt durch eine Liste von Stufen; jede liest
die Felder ihrer Vorgängerinnen und schreibt **ihre eigenen**. Kein geteilter Zustand, kein
Merge im Hintergrund. Reihenfolge, LLM-Profil und Werkzeuge stehen in `settings.yaml`.

```
newsroom.pipeline: [plot, article, illustrate, description, title, slug]
```

| Stufe | liest | schreibt | Modell |
|---|---|---|---|
| `plot` | text, media | plot (Drehbuch) | default + tools |
| `article` | plot, text, media | markdown (**platziert** `![](foto-N.webp)`) | default + tools |
| `illustrate` | markdown, images | images (erfüllt die Platzhalter) | default |
| `description` | plot, markdown | description | quick |
| `title` | plot, markdown | title | quick |
| `slug` | title | slug (`slugify`) | quick* |

\* `slug` rechnet frisch **modellfrei** (`slugify(title)`); nur bei einer Revision fragt es das
Modell, ob der Review eine Umbenennung verlangt.

**Bilder entstehen NACH dem Text.** `article` setzt Bild-Platzhalter dorthin, wo sie in den
Absatz gehören, und prüft nichts. `illustrate` scannt das Markdown, behält vorhandene Bilder
(beiliegend/aus Revision), **erzeugt die fehlenden** mit dem umgebenden Absatz als Kontext und
verwirft unreferenzierte Beilagen. Es fasst das Markdown **nie** an — ein Platzhalter, den es
nicht füllen kann, bleibt als toter Link stehen (bewusst). Nur pfadsichere Namen (`foto-N.webp`)
werden geliefert.

**Revision:** `article` editiert minimal statt neu zu schreiben; `illustrate` behält Bilder,
außer der Review verlangt Änderung; `slug` bleibt Identität, außer der Review verlangt Umbenennung.

**Retry & Timeout:** Job-Level-Retry mit Backoff (`max_attempts`). Jeder externe API-Call läuft
über `fetchWithRetry` (Retry auf transiente Fehler **und** Per-Versuch-Timeout, damit ein
hängender Upstream keine Stufe einfriert).

### Der Doc = `blogagent.yaml`

Die persistierte Form des Docs (`persistable(doc)`): `text, plot, markdown, title, description,
slug, image_names, toolLog, created, updated`. Sie wird **im Repo neben dem Artikel** abgelegt
(§5) und ist damit die Wahrheit, die eine Revision zurückliest. Dieselbe Serialisierung liegt
auch in der Queue-Datei je Job. `review`/`revise` sind Laufzeit-only und werden nicht persistiert.

---

## 4. Sinks — der Ausgang

**Multi-Sink je Kanal.** Ein Briefing nennt bis zu drei Rollen; die Redaktion liefert an alle:

| Rolle | Pflicht | Verhalten |
|---|---|---|
| `target-sink` | ja | die echte Veröffentlichung. Scheitert sie → Retry, am Ende Dead-Letter. |
| `logging-sink` | nein | Debug-Kopie (z. B. File-Sink). Wird zuerst geschrieben, darf scheitern. |
| `deadletter-sink` | nein | wohin ein endgültig gescheiterter Pitch gemeldet wird. |

Alle Sinks erfüllen `POST /publish`. Payload: `{ slug, title, description, markdown, images[],
debug_images[], revises, meta, rename_from }` (`meta` = der Doc fürs `blogagent.yaml`).

**Der Sink validiert nicht — er liefert nur aus.** Pfad-Sicherheit ist **upstream** garantiert:
der Slug kommt aus `slugify`, Bildnamen sind `foto-N.webp` (`illustrate` liefert nur pfadsichere
Namen). Tote Bild-Referenzen sind erlaubt (kaputter Link statt Publish-Abbruch).

### `sink-github`

Kennt als einziger Prozess Repo, Pfade und Token. Ein Artikel = **ein selbsttragendes
Verzeichnis** (wie ein Hugo/Astro „page bundle"):

```
content/blog/<slug>/
├── index.md          Frontmatter (title, description, date, lastmod) + Prosa, Bilder als ![](foto-1.webp)
├── foto-1.webp       Bilder daneben (relativ referenziert)
└── blogagent.yaml    der Doc (Maschinen-Wahrheit für Revisionen)
```

- **Ohne `revises`:** freien Slug bestimmen (Kollision → `-01`, `-02` …), Branch `blog/<slug>`,
  Commit, PR mit Label `blogagent`, Bilder auf 1600 px/WebP heruntergerechnet.
- **Mit `revises`:** Commit auf den bestehenden PR-Branch. Ändert der Review den Slug
  (`rename_from`), werden die alten Dateien im selben Commit gelöscht (echtes Umbenennen).
- Antwort: `publication_ref` = `github:<owner>/<repo>#<pr>`. Kein Merge, kein Push auf `master`.
- Token: fine-grained PAT, **Contents: RW** + **Pull requests: RW**.

### `sink-deadletter`

Meldet auf Telegram **und** schreibt eine Datei `var/deadletter/<id>.yaml` — im **Queue-Format**,
sodass man sie zurück in die Queue kopieren kann.

---

## 5. Queue

In-Memory, mit dem Verzeichnis `var/queue/` als Spiegel — eine Datei je Impuls, Zustand im File.

```
POST /pitches → Datei schreiben → in Memory einreihen → 202   (erst schreiben, dann einreihen)
Start         → Ordner lesen     → Memory-Queue aufbauen
```

Ein Pitch wird zu N Jobs (heute: einer je Briefing, siehe §6). Lebenszyklus je Job:
`pending → done` (voll publiziert → Datei **sofort gelöscht**) oder `→ failed` (nach
`max_attempts`; **bleibt liegen**, damit der Hinweis auf den Fehler nicht verschwindet).

---

## 6. Briefings — die Kanäle

Die Redaktion hat kein Fachwissen; sie bekommt es als Markdown aus `briefings/`. **Jede Datei
ist ein Kanal (Ressort).** Frontmatter = Ziele, Body = Systemprompt. **Hot-Reload:** Änderungen
und neue Briefings greifen ohne Neustart.

```yaml
---
name: camper-blog
target-sink: http://127.0.0.1:5081/publish
logging-sink: http://127.0.0.1:5082/publish
deadletter-sink: http://127.0.0.1:5083/deadletter
---
```

Inhalt des Bodys: Rolle & Zielgruppe, Ton, Artikeltypen (Fehlerbild / Bauteil / Rechenfrage),
harte Regeln (jedes Kapitel endet in einer Tool-Funktion; keine Zahl ohne Rechnung/Beleg),
**verlinkbare Ziele mit Kontext** (immer absolute URLs), Bildvorgaben (Anzahl/Spanne, Stil).

**Heute: jeder Pitch geht an jedes Briefing** (`briefings.map(...)`). Das ist die nächste
Baustelle → §8 (CvD).

---

## 7. Chat-Hub & Feedback (`chat` + `watch-rss`)

Neu: ein Fundament für „ist online?"-Rückmeldung und konversationsbezogene Referenzen.

- **`chat` (:5090)** — der einzige Datensatz der Konversation und ihr Live-Broadcaster.
  `POST /messages` (Producer schieben rein), `GET /messages` (Historie), **`GET /events` (SSE)**.
  Persistenz: `var/chat/history.jsonl`. Client: `@blogagent/chat` (`postMessage`, `history`,
  `subscribe` mit Auto-Reconnect). Der Hub ist dumm über Telegram — er sendet/empfängt dort nicht.
- **`watch-rss`** — pollt den Blog-RSS-Feed und vergleicht die `guid`s (Permalinks) gegen eine
  persistente „schon gesehen"-Menge (`var/watch-rss-seen.json`). Erster Start = stiller Baseline
  (alle aktuellen `guid`s übernehmen, **nichts** melden); danach meldet jeder Eintrag mit **neuer**
  `guid` — auf Telegram **und** in den Hub (`meta.kind="blog-live"`, url/slug/title). Das ist das
  „ist online"-Signal, das PR-Merge + Deploy sonst nicht liefern.
- **`source-telegram`** speist eingehende User-Nachrichten (+ Acks) in den Hub.

Der Observer-Wunsch wird prozessübergreifend über SSE realisiert: „registrieren" = `/events`
öffnen; der Hub broadcastet an alle und weiß nicht, wer dranhängt.

*Offen:* Sink-Meldungen (PR-ready, Deadletter) laufen noch nicht in den Hub; SSE hat noch keinen
Subscriber (kommt mit der Referenz-Auflösung / Pinterest).

---

## 8. Als Nächstes

1. **CvD / Dispatch (Routing):** Jedes Briefing deklariert eine einzeilige `when`-Zuständigkeit;
   ein dünner Dispatch-Schritt (`quick`-Modell) wählt aus Pitch + allen `{name, when}` die
   passenden Ressorts. Der Newsroom legt Jobs nur für diese an (statt für alle). Offen: Verhalten
   bei Kein-Match; Revisionen umgehen den Dispatch (Ressort im `blogagent.yaml` festhalten).
2. **Zweiter Kanal Pinterest:** `pinterest-*.md` (Briefing) + `sink-pinterest`. Getriggert vom
   `watch-rss`/Chat-Hub, wenn ein live gegangener Blog auf Pinterest soll — mit der echten
   Blog-URL. Pinterest will eine eigene, kürzere Pipeline (vertikales Bild, Pin-Titel/-Text, Link)
   → per-Ressort-Pipeline.

---

## 9. Offene Punkte / Abweichungen vom Ur-Entwurf

- **`trust`** (owner/public) ist nicht implementiert. Der Bind auf `127.0.0.1` schützt den
  Eingang; eine Trust-Unterscheidung fehlt.
- **`focus`/Multi-Format-Crop** (Pinterest 2:3, Instagram 4:5 …) ist nicht gebaut; Sinks rechnen
  aktuell nur auf Blog-Breite herunter.
- **Sink-Validierung** wurde bewusst entfernt (der Sink liefert nur aus); Pfad-Sicherheit liegt
  jetzt upstream.
- **Modelle:** `default` = gemini-3.5-flash, `quick` = gemini-3.5-flash-lite, Bild =
  gemini-3.1-flash-image, STT = Gemini nativ (`generateContent`, OGG inline). Alles über den
  `GEMINI_API_KEY`.
