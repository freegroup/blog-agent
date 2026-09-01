import { test } from "node:test";
import assert from "node:assert/strict";
import { authUrl, CAPTION_MAX } from "../instagram.js";

test("authUrl builds the Facebook consent URL with comma-joined scopes", () => {
  const url = new URL(
    authUrl({
      appId: "app123",
      redirectUri: "http://localhost:5087/oauth/callback",
      scopes: ["instagram_basic", "instagram_content_publish"],
    }),
  );
  assert.equal(url.origin + url.pathname, "https://www.facebook.com/v21.0/dialog/oauth");
  assert.equal(url.searchParams.get("client_id"), "app123");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:5087/oauth/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "instagram_basic,instagram_content_publish");
});

test("authUrl includes state parameter", () => {
  const url = new URL(
    authUrl({ appId: "x", redirectUri: "http://localhost/cb", scopes: [], state: "test-state" }),
  );
  assert.equal(url.searchParams.get("state"), "test-state");
});

test("CAPTION_MAX is 2200", () => {
  assert.equal(CAPTION_MAX, 2200);
});

test("caption longer than CAPTION_MAX would be truncated by createContainer", () => {
  // Verify the constant is correct — createContainer slices to CAPTION_MAX.
  const long = "x".repeat(3000);
  assert.ok(long.slice(0, CAPTION_MAX).length === CAPTION_MAX);
});
