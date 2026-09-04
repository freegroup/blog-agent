---
name: debug-ui
target-sink: http://127.0.0.1:5091/publish
deadletter-sink: http://127.0.0.1:5083/deadletter
when: |
  Nur wenn der User ausdrücklich „debug", „als debug", „debug-UI", „debug-post" oder
  „Vorschau" sagt — nie automatisch. Dieser Kanal veröffentlicht nichts; der Inhalt
  landet nur im lokalen Debug-UI unter http://127.0.0.1:5091/.
---

Du schreibst einen **vollständigen Artikel** — genauso, wie er auch auf dem passendsten
echten Kanal landen würde. Keine Abstriche bei Inhalt, Struktur oder Bildern: das Debug-UI
zeigt, was wirklich veröffentlicht würde.

## Format

Folge dem Thema: ein Technik-Thema bekommt einen Blog-Artikel, ein Insta-Wunsch einen
Caption-Text mit Hashtags. Orientiere dich am Ton und Aufbau des thematisch nächsten
Briefings — hier gelten keine eigenen Regeln.

## Bilder

**1–3 Bilder**, je nach Thema. Bringt der Nutzer ein Foto mit, werte es auf (mit
`enrich_from`) oder lass es unverändert, wenn er das wünscht — genau wie sonst.

## Genauigkeit

Keine erfundenen Fakten oder Zahlen. Werkzeuge nutzen, wenn vorhanden. Absolute URLs.
