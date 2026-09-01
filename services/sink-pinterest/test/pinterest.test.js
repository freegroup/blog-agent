import { test } from "node:test";
import assert from "node:assert/strict";
import { authUrl, pinBody } from "../pinterest.js";

test("authUrl builds the consent URL with comma-joined scopes", () => {
  const url = new URL(
    authUrl({ appId: "app123", redirectUri: "http://localhost:5086/oauth/callback", scopes: ["pins:write", "boards:read"] }),
  );
  assert.equal(url.origin + url.pathname, "https://www.pinterest.com/oauth/");
  assert.equal(url.searchParams.get("client_id"), "app123");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:5086/oauth/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "pins:write,boards:read");
});

test("pinBody sends the image inline as base64 with board and link", () => {
  const body = pinBody({
    boardId: "board-7",
    title: "Titel",
    description: "Beschreibung",
    link: "https://camper-elektrik-planer.de/de/kabelquerschnitt-berechnen/",
    imageBase64: "AAAA",
  });
  assert.equal(body.board_id, "board-7");
  assert.equal(body.title, "Titel");
  assert.equal(body.description, "Beschreibung");
  assert.equal(body.link, "https://camper-elektrik-planer.de/de/kabelquerschnitt-berechnen/");
  assert.deepEqual(body.media_source, { source_type: "image_base64", content_type: "image/jpeg", data: "AAAA" });
});

test("pinBody omits an absent link and caps an overlong title", () => {
  const body = pinBody({ boardId: "b", title: "x".repeat(200), imageBase64: "AAAA" });
  assert.ok(!("link" in body));
  assert.equal(body.title.length, 100);
});

test("pinBody drops empty title/description rather than sending blanks", () => {
  const body = pinBody({ boardId: "b", title: "   ", description: "", imageBase64: "AAAA" });
  assert.ok(!("title" in body));
  assert.ok(!("description" in body));
});
