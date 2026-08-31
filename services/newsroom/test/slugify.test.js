import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../pipeline/slugify.js";
import { oneLine } from "../pipeline/text.js";
import { _intern } from "@blogagent/sink-github/validate.js";

test("every slug satisfies the sink's rule", () => {
  const titles = [
    "Kabelquerschnitt im Wohnmobil: warum 2,5 mm² selten reichen",
    "40 A über 5 m — welcher Querschnitt?",
    "Sicherung falsch dimensioniert",
    "Größe, Öl & Übergänge",
    "Café-Ausbau à la carte",
  ];
  for (const title of titles) {
    const slug = slugify(title);
    assert.ok(_intern.SLUG.test(slug), `'${title}' → '${slug}' fails ${_intern.SLUG}`);
  }
});

test("German umlauts are spelled out, not stripped", () => {
  assert.equal(slugify("Größe Öl Übergang"), "groesse-oel-uebergang");
  assert.equal(slugify("Straße"), "strasse");
});

test("other diacritics fold to their base letter", () => {
  assert.equal(slugify("Café Ampère"), "cafe-ampere");
});

test("caps at 61 characters without leaving a trailing separator", () => {
  const slug = slugify("Ein sehr langer Titel ".repeat(10));
  assert.ok(slug.length <= 61);
  assert.ok(!slug.endsWith("-"));
  assert.ok(_intern.SLUG.test(slug));
});

test("returns empty rather than inventing one", () => {
  for (const title of ["", "!!!", "—", "  ", null, undefined, "ab"]) {
    assert.equal(slugify(title), "", `'${title}' should yield nothing`);
  }
});

// ------------------------------------------------------------------ oneLine

test("oneLine strips a label", () => {
  assert.equal(oneLine("Titel: Kabelquerschnitt"), "Kabelquerschnitt");
  assert.equal(oneLine("Description - Zu dünne Leitungen"), "Zu dünne Leitungen");
});

test("oneLine strips matching quotes", () => {
  assert.equal(oneLine('"Kabelquerschnitt"'), "Kabelquerschnitt");
  assert.equal(oneLine("„Kabelquerschnitt“"), "Kabelquerschnitt");
});

test("oneLine takes the answer from below a bare label", () => {
  assert.equal(oneLine("Titel:\nKabelquerschnitt im Wohnmobil"), "Kabelquerschnitt im Wohnmobil");
});

test("oneLine unwraps a fenced block", () => {
  assert.equal(oneLine("```\nKabelquerschnitt\n```"), "Kabelquerschnitt");
});

test("oneLine leaves a clean answer alone — including inner punctuation", () => {
  assert.equal(oneLine("Kabelquerschnitt: 2,5 mm² reichen selten"), "Kabelquerschnitt: 2,5 mm² reichen selten");
});
