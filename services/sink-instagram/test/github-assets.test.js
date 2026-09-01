import { test } from "node:test";
import assert from "node:assert/strict";
import { rawUrl, DEFAULT_BRANCH } from "../github-assets.js";

test("DEFAULT_BRANCH is instagram-assets", () => {
  assert.equal(DEFAULT_BRANCH, "instagram-assets");
});

test("rawUrl builds the correct raw.githubusercontent.com URL", () => {
  const url = rawUrl("freegroup/CampingElectricCalculator", "instagram-assets", "camper-kabel-2024", "foto-1.jpg");
  assert.equal(
    url,
    "https://raw.githubusercontent.com/freegroup/CampingElectricCalculator/instagram-assets/camper-kabel-2024/foto-1.jpg",
  );
});

test("rawUrl uses the given branch, not a hardcoded default", () => {
  const url = rawUrl("owner/repo", "my-custom-branch", "my-post-slug", "image-2.jpg");
  assert.equal(url, "https://raw.githubusercontent.com/owner/repo/my-custom-branch/my-post-slug/image-2.jpg");
});
