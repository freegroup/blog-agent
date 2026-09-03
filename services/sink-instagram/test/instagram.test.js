import { test } from "node:test";
import assert from "node:assert/strict";
import { authUrl } from "../instagram.js";

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
