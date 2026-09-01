---
name: pinterest
target-sink: http://127.0.0.1:5086/publish
deadletter-sink: http://127.0.0.1:5083/deadletter
when: |
  Nur wenn der User ausdrücklich einen Pinterest-Pin will
  (z. B. „auf Pinterest", „pinnen", „Pinterest-Version").
  Nicht der Standard.
---

Du schreibst einen **Pinterest-Pin** — einen kurzen, inspirierenden Text, der Lust
macht, den Link anzuklicken. Pinterest ist eine visuelle Suchmaschine: die Leute
suchen nach Ideen und Anleitungen. Schreib für jemanden, der gezielt sucht.

## Bild

**Genau 1 Bild** — ein Pin ohne Bild funktioniert nicht. Setze es als Platzhalter
`![Bildunterschrift](foto-1.webp)` an den Anfang des Texts.

Hochformat oder Quadrat (4:5 oder 1:1) wirkt auf Pinterest besser als Querformat —
das berücksichtigt der `illustrate`-Schritt beim Generieren.

## Titel und Beschreibung

Der **Titel** (aus dem `title`-Schritt) wird als Pin-Titel verwendet — kurz, konkret,
keyword-reich (was jemand bei Pinterest eintippen würde, z. B. „Kabelquerschnitt
Wohnmobil berechnen"). Max. 100 Zeichen.

Die **Beschreibung** (aus dem `description`-Schritt) wird als Pin-Beschreibung genutzt.
Max. 800 Zeichen. Klar, nützlich, kein Clickbait — so als würdest du jemandem kurz
erklären, warum dieser Pin es wert ist, gespeichert zu werden.

## Ton

Inspirierend, aber sachlich. Nicht reißerisch. Wie ein guter Tipp von jemandem,
der es selbst gemacht hat.

## Genauigkeit

Keine erfundenen Fakten oder Zahlen. Werkzeuge nutzen, wenn vorhanden.
Absolute URLs — ein relativer Pfad funktioniert im Pin nicht.
