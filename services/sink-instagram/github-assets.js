import { fetchWithRetry } from "@blogagent/http";

/**
 * Upload a JPEG image to a GitHub branch, creating it from the default branch if
 * it does not exist yet. Both repo and branch come from the caller (settings.yaml)
 * so they are fully configurable without code changes.
 *
 * Returns the raw.githubusercontent.com URL, which Instagram can fetch directly
 * (works for public repos — the repo must be public for Instagram to reach it).
 */

export const DEFAULT_BRANCH = "instagram-assets";

/**
 * Construct the raw GitHub URL for a file at `{slug}/{filename}` on a given branch.
 * Pure — no I/O, testable in isolation.
 */
export function rawUrl(repo, branch, slug, filename) {
  return `https://raw.githubusercontent.com/${repo}/${branch}/${slug}/${filename}`;
}

/**
 * Ensure the target branch exists, creating it from the repo's default branch if
 * needed. Idempotent — safe to call before every upload.
 *
 * @param {{apiUrl:string, repo:string, token:string, branch:string}} arg
 */
async function ensureBranch({ apiUrl, repo, token, branch }) {
  const headers = { authorization: `token ${token}`, accept: "application/vnd.github.v3+json" };
  const branchRes = await fetch(`${apiUrl}/repos/${repo}/git/ref/heads/${branch}`, { headers });
  if (branchRes.ok) return; // already exists

  // Resolve the default branch's HEAD SHA.
  const repoRes = await fetch(`${apiUrl}/repos/${repo}`, { headers });
  const repoJson = await repoRes.json().catch(() => ({}));
  const defaultBranch = repoJson.default_branch ?? "master";

  const headRes = await fetch(`${apiUrl}/repos/${repo}/git/ref/heads/${defaultBranch}`, { headers });
  const headJson = await headRes.json().catch(() => ({}));
  const sha = headJson.object?.sha;
  if (!sha) throw new Error(`[github-assets] could not resolve SHA for ${defaultBranch}`);

  const createRes = await fetch(`${apiUrl}/repos/${repo}/git/refs`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
  if (!createRes.ok && createRes.status !== 422) {
    const body = await createRes.text().catch(() => "");
    throw new Error(`[github-assets] could not create branch ${branch}: ${createRes.status} ${body}`);
  }
}

/**
 * Upload a JPEG buffer to `{slug}/{filename}` on the configured branch.
 * Upserts — if the file already exists at that path it is replaced (requires the
 * existing sha, which this function fetches automatically).
 *
 * @param {{apiUrl:string, repo:string, token:string, branch:string,
 *          slug:string, filename:string, jpegBuffer:Buffer}} arg
 * @returns {string} the raw.githubusercontent.com URL Instagram can fetch
 */
export async function uploadAsset({ apiUrl, repo, token, branch, slug, filename, jpegBuffer }) {
  await ensureBranch({ apiUrl, repo, token, branch });

  const headers = { authorization: `token ${token}`, accept: "application/vnd.github.v3+json" };
  const path = `${slug}/${filename}`;
  const contentsUrl = `${apiUrl}/repos/${repo}/contents/${path}`;

  // Check for an existing file to obtain its sha (required by GitHub for updates).
  let sha;
  const checkRes = await fetch(`${contentsUrl}?ref=${branch}`, { headers });
  if (checkRes.ok) {
    const existing = await checkRes.json().catch(() => ({}));
    sha = existing.sha;
  }

  const commitBody = {
    message: `add instagram asset: ${path}`,
    content: jpegBuffer.toString("base64"),
    branch,
  };
  if (sha) commitBody.sha = sha;

  const res = await fetchWithRetry(
    contentsUrl,
    {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(commitBody),
    },
    { label: "GitHub contents upload" },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GitHub contents ${res.status}: ${JSON.stringify(json)}`);

  return rawUrl(repo, branch, slug, filename);
}
