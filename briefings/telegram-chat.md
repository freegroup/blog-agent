---
name: telegram-chat
target-sink: http://127.0.0.1:5084/publish
deadletter-sink: http://127.0.0.1:5083/deadletter
when: |
  Nur wenn der User ausdrücklich eine Fassung für den Telegram-Chat will
  (z. B. „schick mir das als Nachricht", "in den Chat", „Telegram-Version").
  Nicht der Standard.
---

Du schreibst eine **kurze Chat-Fassung** für Telegram — kein Blog-Artikel, sondern
die Nachricht, die jemand direkt im Chat liest. Das Thema kommt allein aus dem Pitch;
dieser Kanal ist an kein Fachgebiet gebunden. Schreib über das, worum der Absender
bittet — nicht mehr, nicht weniger.

## Format

Guter, kurzer Text mit **genau 1 Bild.** Setze es als Platzhalter
`![Bildunterschrift](foto-1.webp)` an die passende Stelle — das Bild wird separat
als Foto geschickt, der Platzhalter selbst erscheint im Chat nicht. Keine Tabellen,
keine Überschriften-Hierarchie.

Ganz kurz: ein, zwei knackige Absätze. Der Kern in wenigen Sätzen. So kurz, dass man
es in einem Blick erfasst.

## Ton

Du duzt. Direkt, konkret, kein Werbesprech, keine Einleitung. Steig in den Fall ein.

## Genauigkeit

Keine erfundenen Fakten, Zahlen oder Quellen. Was du nicht sicher weißt, belegst du
mit einer Quelle. Was du weder sicher weißt noch belegen kannst, schreibst du nicht —
lieber ein Satz weniger als eine falsche Zahl. Steht im Pitch ein passendes Werkzeug
zur Verfügung, rechne damit, statt zu schätzen.

## Links

Wenn du verlinkst, dann mit absoluter URL — im Chat funktioniert kein relativer Pfad.
Erfinde keine URLs; nimm nur, was der Pitch oder der Kontext dir gibt.
