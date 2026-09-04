import { test } from "node:test";
import assert from "node:assert/strict";
import { authUrl, createContainer } from "../instagram.js";

/** Capture the one graph POST createContainer makes, returning a canned creation id. */
function captureFetch(json) {
  const seen = {};
  seen.fetch = async (url, init) => {
    seen.url = url;
    seen.body = JSON.parse(init.body);
    return { ok: true, json: async () => json };
  };
  return seen;
}

async function withFakeFetch(fake, fn) {
  const { fetch: real } = globalThis;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const IG = { apiUrl: "https://g.test", userId: "42", token: "T", captionMax: 2200 };

test("authUrl builds the Instagram Login consent URL with comma-joined scopes", () => {
  const url = new URL(
    authUrl({
      authorizeUrl: "https://www.instagram.com/oauth/authorize",
      appId: "app123",
      redirectUri: "http://localhost:5087/oauth/callback",
      scopes: ["instagram_business_basic", "instagram_business_content_publish"],
    }),
  );
  assert.equal(url.origin + url.pathname, "https://www.instagram.com/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "app123");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:5087/oauth/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "instagram_business_basic,instagram_business_content_publish");
});

test("authUrl includes state and uses the injected authorize host", () => {
  // The host is passed in, not baked into the module — a fake host proves it.
  const url = new URL(
    authUrl({ authorizeUrl: "https://example.test/authorize", appId: "x", redirectUri: "http://localhost/cb", scopes: [], state: "test-state" }),
  );
  assert.equal(url.origin + url.pathname, "https://example.test/authorize");
  assert.equal(url.searchParams.get("state"), "test-state");
});

test("createContainer builds a single-image container with caption", async () => {
  const seen = captureFetch({ id: "c1" });
  const id = await withFakeFetch(seen.fetch, () =>
    createContainer({ ...IG, imageUrl: "https://img/1.jpg", caption: "hello" }),
  );
  assert.equal(id, "c1");
  assert.match(seen.url, /\/42\/media\?access_token=T/);
  assert.equal(seen.body.image_url, "https://img/1.jpg");
  assert.equal(seen.body.caption, "hello");
  assert.ok(!("is_carousel_item" in seen.body));
  assert.ok(!("media_type" in seen.body));
});

test("createContainer builds a carousel ITEM — image flagged, caption withheld", async () => {
  const seen = captureFetch({ id: "item1" });
  await withFakeFetch(seen.fetch, () =>
    createContainer({ ...IG, imageUrl: "https://img/1.jpg", caption: "ignored", isCarouselItem: true }),
  );
  assert.equal(seen.body.image_url, "https://img/1.jpg");
  assert.equal(seen.body.is_carousel_item, true);
  assert.ok(!("caption" in seen.body), "the caption belongs on the parent, never on a slide");
});

test("createContainer builds the carousel PARENT from child ids, carrying the caption", async () => {
  const seen = captureFetch({ id: "parent1" });
  const id = await withFakeFetch(seen.fetch, () =>
    createContainer({ ...IG, caption: "the caption", children: ["item1", "item2"] }),
  );
  assert.equal(id, "parent1");
  assert.equal(seen.body.media_type, "CAROUSEL");
  assert.equal(seen.body.children, "item1,item2", "children go as a comma-joined list");
  assert.equal(seen.body.caption, "the caption");
  assert.ok(!("image_url" in seen.body));
});
