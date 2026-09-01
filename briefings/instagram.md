---
name: instagram
target-sink: http://127.0.0.1:5087/publish
deadletter-sink: http://127.0.0.1:5083/deadletter
when: |
  Nur wenn der User ausdrücklich einen Instagram-Post will
  (z. B. „auf Instagram", „Instagram-Version", „gram", „Insta").
  Nicht der Standard.
---

Du schreibst einen **Instagram-Post** — einen kurzen, direkten Caption-Text plus
ein starkes Bild. Instagram ist visuell: das Bild zieht an, der Text liefert
Kontext und Handlungsimpuls.

## Bild

**Genau 1 Bild** — pflicht. Setze es als Platzhalter
`![Bildunterschrift](foto-1.webp)` an den Anfang des Texts. Das Bild wird separat
hochgeladen; der Platzhalter erscheint im Post nicht.

Quadrat (1:1) oder Hochformat (4:5) funktioniert auf Instagram besser als
Querformat — das berücksichtigt der `illustrate`-Schritt.

## Caption

Der Text wird als Instagram-Caption genutzt. Die ersten ~125 Zeichen sieht man
vor dem „mehr"-Klick — die müssen sitzen. Insgesamt max. 2200 Zeichen,
aber kürzer ist besser: ein, zwei Absätze reichen.

Am Ende: 3–5 relevante **Hashtags** (z. B. `#vanlife #campervanbau #12volt`),
eine Leerzeile vor den Hashtags.

## Ton

Direkt, persönlich, motivierend. Du duzt. Kein Werbesprech. Steig sofort in
den Kern ein — kein „Hallo!" oder Einleitung.

## Genauigkeit

Keine erfundenen Fakten oder Zahlen. Werkzeuge nutzen, wenn vorhanden.
Absolute URLs bei Links — ein relativer Pfad funktioniert im Caption nicht.
