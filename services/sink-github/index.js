#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import sharp from "sharp";
import { stringify } from "yaml";
import { loadSettings, section, secret } from "@blogagent/config";
import { formatRef, parseRef } from "@blogagent/envelope";
import { connectOne } from "@blogagent/mcp";
import { GitHub, commitFiles } from "./github.js";

/**
 * Accepts finished articles and files them as a PR. Stateless:
 * POST in, PR out, no polling, no background process.
 *
 * The only process that knows the repo, paths, and token. It never merges —
 * a human gives the imprimatur.
 */
const cfg = section(loadSettings(), "sink-github");
const PORT = cfg.num("port", 5081);
const REPO = cfg.str("repo");
const BASE_BRANCH = cfg.str("base_branch", "main");
const CONTENT_PATH = cfg.str("content_path");
const ASSET_PATH = cfg.str("asset_path");
// The machine-readable document beside the article (blogagent.yaml). Written on
// every publish so a later revision can read the article's own truth back.
const META_PATH = cfg.str("meta_path", "");
const LABEL = cfg.str("label", "blogagent");

/** Blog format. Target knowledge — the newsroom delivers 2048 px and knows nothing of this. */
const BLOG_WIDTH = 1600;
const BLOG_QUALITY = 82;

// Reporting is sink work: the newsroom never sends, it only posts here.
const telegram = cfg.str("mcp", "") ? await connectOne(cfg.str("mcp"), "sink-github") : null;

async function notify(text) {
  if (!telegram) return;
  await telegram.call("send_message", { text }).catch((err) =>
    console.error(`[sink-github] notification failed: ${err.message}`),
  );
}

const gh = new GitHub({ apiUrl: cfg.str("api_url", "https://api.github.com"), repo: REPO, token: secret("GITHUB_TOKEN") });
const [OWNER, NAME] = REPO.split("/");

async function publish(payload) {
  // The sink does not validate — it delivers. The pipeline guarantees what matters
  // for safe file writes: the slug is slugify()d and image names are foto-N.webp
  // (illustrate only delivers path-safe names). Dead image links are accepted.
  const { slug: rawSlug, title, description, markdown, images = [], revises = null, meta = null, rename_from = null } = payload;

  // A fresh article gets a free slug — on collision just append -01, -02, …
  // A revision keeps its slug: it targets an article that already exists.
  const slug = revises ? rawSlug : await freeSlug(rawSlug);
  const branch = `blog/${slug}`;

  // Frontmatter is blog form, not payload — the sink sets it. The dates come
  // from the document (meta): `date` is the article's creation, preserved across
  // revisions; `lastmod` is the last edit.
  const content =
    `---\n` +
    `title: ${JSON.stringify(title)}\n` +
    `description: ${JSON.stringify(description)}\n` +
    (meta?.created ? `date: ${JSON.stringify(meta.created)}\n` : "") +
    (meta?.updated ? `lastmod: ${JSON.stringify(meta.updated)}\n` : "") +
    `---\n\n${markdown.trim()}\n`;

  const files = [
    { path: CONTENT_PATH.replace("{slug}", slug), contentBase64: Buffer.from(content, "utf8").toString("base64") },
  ];

  for (const img of images) {
    const resized = await sharp(Buffer.from(img.data, "base64"))
      .resize({ width: BLOG_WIDTH, withoutEnlargement: true })
      .webp({ quality: BLOG_QUALITY })
      .toBuffer();
    files.push({
      path: ASSET_PATH.replace("{name}", img.name).replace("{slug}", slug),
      contentBase64: resized.toString("base64"),
    });
  }

  // The document itself, next to the article — the source of truth a revision reads.
  if (META_PATH && meta) {
    files.push({
      path: META_PATH.replace("{slug}", slug),
      // Patch the slug so blogagent.yaml names the directory it actually lives in.
      contentBase64: Buffer.from(stringify({ ...meta, slug }, { lineWidth: 80 }), "utf8").toString("base64"),
    });
  }

  if (revises) {
    const ref = parseRef(revises);
    if (!ref) return { status: 400, body: { errors: ["revises is not a valid publication_ref"] } };

    const pull = await gh.getPull(ref.number);
    if (pull.state !== "open") {
      return { status: 409, body: { errors: [`PR #${ref.number} is ${pull.state}`] } };
    }

    // The reviewer asked for a new slug: the article moves to a new directory, so
    // the old one has to go in the same commit — otherwise the PR carries both.
    const remove = rename_from && rename_from !== slug ? await oldArticleFiles(rename_from, pull.head.ref) : [];

    const sha = await commitFiles(gh, {
      branch: pull.head.ref,
      files,
      remove,
      message: `Revised: ${title}`,
      neu: false,
    });
    await notify(`✏️ überarbeitet: ${title}\n${pull.html_url}`);
    return { status: 200, body: { publication_ref: revises, url: pull.html_url, commit_sha: sha } };
  }

  // freeSlug() already guaranteed this branch is free.
  await commitFiles(gh, { branch, baseBranch: BASE_BRANCH, files, message: title, neu: true });

  const pull = await gh.createPull({
    title,
    head: branch,
    base: BASE_BRANCH,
    body: `${description}\n`,
  });
  await gh.addLabels(pull.number, [LABEL]);

  await notify(`📄 PR #${pull.number} ready: ${title}\n${pull.html_url}`);
  return {
    status: 201,
    body: { publication_ref: formatRef(OWNER, NAME, pull.number), url: pull.html_url },
  };
}

/** Taken means: a PR branch already holds this slug, or it is already merged to base. */
async function slugTaken(slug) {
  try {
    await gh.refSha(`blog/${slug}`);
    return true; // an open (or stale) PR branch holds it
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  try {
    await gh.getContent(CONTENT_PATH.replace("{slug}", slug), BASE_BRANCH);
    return true; // already published on the base branch
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  return false;
}

/** The slug, or its first free `<slug>-NN` variant (01, 02, …). */
async function freeSlug(base) {
  if (!(await slugTaken(base))) return base;
  for (let n = 1; n < 100; n++) {
    const candidate = `${base}-${String(n).padStart(2, "0")}`;
    if (!(await slugTaken(candidate))) return candidate;
  }
  // 99 collisions is not a real scenario — stay deterministic rather than throw.
  return `${base}-${Date.now()}`;
}

/** Every file under an article's old directory on the branch — deleted on a slug rename. */
async function oldArticleFiles(oldSlug, ref) {
  const dir = path.posix.dirname(CONTENT_PATH.replace("{slug}", oldSlug));
  const entries = await gh.listDir(dir, ref).catch(() => []);
  return (Array.isArray(entries) ? entries : []).filter((e) => e.type === "file").map((e) => e.path);
}

const server = http.createServer(async (req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method !== "POST" || req.url !== "/publish") return reply(404, { errors: ["POST /publish"] });

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const { status, body } = await publish(payload);
    reply(status, body);
  } catch (err) {
    console.error("[sink-github]", err);
    reply(500, { errors: [err.message] });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[sink-github] :${PORT} → ${REPO}@${BASE_BRANCH}`);
});
