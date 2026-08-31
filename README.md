# BlogAgent

Aus einem Impuls — Foto, Text oder Sprachnachricht — entsteht ein Artikel, der als
GitHub-PR zur Freigabe vorliegt. Der Merge ist das Imprimatur.

Wie das aufgebaut ist und warum: [PLAN.md](PLAN.md). Dieses README reicht zum
Einrichten und Starten.

## Einrichten

```bash
npm install
cp .env.example .env    # Secrets — nur diese Datei bleibt lokal
```

`settings.yaml` liegt im Repo: Ports, Intervalle und Modellwahl sind keine
Geheimnisse und sollen versioniert sein. Secrets stehen ausschließlich in `.env`.

### Telegram

1. In Telegram **@BotFather** → `/newbot` → Token in `.env` als `TELEGRAM_BOT_TOKEN`
2. Chat-ID herausfinden:
   ```bash
   TELEGRAM_BOT_TOKEN=... node services/mcp-telegram/chat-id.js
   ```
   Dem Bot eine Nachricht schreiben — die ID erscheint und gehört als
   `TELEGRAM_CHAT_ID` in die `.env`. Nur aus diesem Chat werden Pitches angenommen.

### GitHub

Fine-grained PAT, nur auf das Ziel-Repo:

| Dienst | Rechte |
|---|---|
| `sink-github` | Contents **RW**, Pull requests **RW** |
| `source-github` | Pull requests **RW** (schreibend nur für die Quittung) |

**Branch-Protection auf dem Base-Branch ist Voraussetzung.** `Contents: RW` erlaubt
technisch einen Direkt-Push; nur die Protection verhindert ihn.

### Modell

`settings.yaml`, Abschnitt `llm-profiles` — benannte Profile, jede Stufe wählt
eines. Das Modell muss Werkzeuge können, sonst rät der Newsroom, statt zu rechnen.

```yaml
llm-profiles:
  default:
    provider: gemini            # braucht GEMINI_API_KEY
    model: gemini-3.5-flash
    # anthropic direkt: provider: anthropic + model: claude-opus-5 (braucht ANTHROPIC_API_KEY)
    # lokal: provider: openai-compatible + base_url: http://localhost:11434/v1
    #   (Ollama, liteLLM, vLLM, LM Studio sprechen dasselbe Protokoll)
```

Der `gemini`-Provider spricht Googles OpenAI-kompatiblen Endpoint und nutzt
denselben `GEMINI_API_KEY` wie die Bildgenerierung (siehe unten).

### Sprachnachrichten

`stt` in `settings.yaml`. Vorgabe ist **Google Gemini** (`provider: google`): das
Audio geht als `input_audio` in einen chat/completions-Aufruf am OpenAI-kompatiblen
Endpoint — derselbe `GEMINI_API_KEY` wie die `gemini`-LLM-Profile, kein eigener Dienst.

Alternativ lokal ein Whisper-Server (`provider: whisper-http`, spricht
`/v1/audio/transcriptions`: whisper.cpp, faster-whisper, OpenAI, liteLLM). Per Docker
(hört auf `:8000`):

```bash
docker run -d --name speaches -p 8000:8000 \
  -v hf-hub-cache:/home/ubuntu/.cache/huggingface/hub \
  ghcr.io/speaches-ai/speaches:latest-cpu
```

Ohne erreichbaren Dienst werden Sprachnachrichten übersprungen und protokolliert —
Fotos und Text laufen weiter.

### Titelbild (optional)

Kommt ein Pitch ohne Bild, kann der `illustrate`-Schritt eines erzeugen — aber nur,
wenn das Briefing das für seinen Kanal wünscht (als Anweisung im Briefing-Text).
Das Bild landet dann ganz normal im Artikel, als hätte es der Absender mitgeschickt.

Konfiguriert im Abschnitt `image` von `settings.yaml` (Provider, Endpoint, Modell);
der Key ist `GEMINI_API_KEY` in `.env` — derselbe wie für die `gemini`-LLM-Profile.
Fehlt der Abschnitt oder der Key, ist der Schritt schlicht ein No-op — Artikel ohne
erzeugtes Bild laufen weiter.

## Starten

Jeder Dienst ist ein eigener Prozess:

```bash
node services/sink-github/index.js
node services/sink-deadletter/index.js
node services/newsroom/index.js
node services/source-telegram/index.js
node services/source-github/index.js
```

`mcp-calc` und `mcp-telegram` werden als Kindprozesse gestartet, nicht von Hand.

## Testen

```bash
npm test
```

Ohne Netz und ohne Secrets. Der Kern lässt sich auch per `curl` fahren:

```bash
curl -X POST http://127.0.0.1:5080/pitches -H 'content-type: application/json' -d '{
  "id":"test-1","source":"cli","source_ref":"manuell","received_at":"2026-08-30T10:00:00Z",
  "text":"5 Meter, 40 Ampere, 12 Volt — welcher Querschnitt?",
  "media":[],"revises":null}'

curl http://127.0.0.1:5080/pitches/test-1
```
