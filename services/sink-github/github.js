/**
 * Thin GitHub REST client. Only the calls the sink needs.
 *
 * `apiUrl` is configurable because the target may be an Enterprise instance —
 * where the base is e.g. https://github.example.com/api/v3.
 */
import { fetchWithRetry } from "@blogagent/http";

export class GitHub {
  constructor({ apiUrl, repo, token }) {
    this.base = `${apiUrl.replace(/\/$/, "")}/repos/${repo}`;
    this.token = token;
  }

  async call(method, path, body) {
    // Retries dropped connections and GitHub's transient 5xx/429; a real 4xx
    // (bad request, 404, 422) is returned straight through and thrown below.
    const response = await fetchWithRetry(
      `${this.base}${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      { label: `GitHub ${method} ${path}` },
    );

    if (!response.ok) {
      throw Object.assign(new Error(`GitHub ${method} ${path} → ${response.status}: ${await response.text()}`), {
        status: response.status,
      });
    }
    return response.status === 204 ? null : response.json();
  }

  refSha(branch) {
    return this.call("GET", `/git/ref/heads/${encodeURIComponent(branch)}`).then((r) => r.object.sha);
  }

  commitTree(sha) {
    return this.call("GET", `/git/commits/${sha}`).then((c) => c.tree.sha);
  }

  blob(contentBase64) {
    return this.call("POST", "/git/blobs", { content: contentBase64, encoding: "base64" }).then((b) => b.sha);
  }

  /**
   * @param {{path:string, sha:string}[]} files  blobs to add or overwrite
   * @param {string[]} [remove]                  paths to delete (sha: null removes from base_tree)
   */
  tree(baseTree, files, remove = []) {
    return this.call("POST", "/git/trees", {
      base_tree: baseTree,
      tree: [
        ...files.map((f) => ({ path: f.path, mode: "100644", type: "blob", sha: f.sha })),
        ...remove.map((p) => ({ path: p, mode: "100644", type: "blob", sha: null })),
      ],
    }).then((t) => t.sha);
  }

  commit(message, treeSha, parentSha) {
    return this.call("POST", "/git/commits", {
      message,
      tree: treeSha,
      parents: [parentSha],
    }).then((c) => c.sha);
  }

  createBranch(branch, sha) {
    return this.call("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha });
  }

  updateBranch(branch, sha) {
    return this.call("PATCH", `/git/refs/heads/${encodeURIComponent(branch)}`, { sha });
  }

  createPull({ title, head, base, body }) {
    return this.call("POST", "/pulls", { title, head, base, body });
  }

  getPull(number) {
    return this.call("GET", `/pulls/${number}`);
  }

  addLabels(number, labels) {
    return this.call("POST", `/issues/${number}/labels`, { labels });
  }

  listPullsByLabel() {
    return this.call("GET", "/pulls?state=open&per_page=100");
  }

  listComments(number) {
    return this.call("GET", `/issues/${number}/comments?per_page=100`);
  }

  addComment(number, body) {
    return this.call("POST", `/issues/${number}/comments`, { body });
  }

  listCommits(number) {
    return this.call("GET", `/pulls/${number}/commits?per_page=100`);
  }

  /** The files a PR touches — used to find an article's directory without guessing. */
  listPullFiles(number) {
    return this.call("GET", `/pulls/${number}/files?per_page=100`);
  }

  /** Directory listing on a ref: an array of `{path, sha, type}` entries. */
  listDir(path, ref) {
    return this.call("GET", `/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
  }

  /**
   * One file's content on a given ref. Returns the raw bytes (Buffer); the caller
   * decides whether that is UTF-8 (blogagent.yaml, index.md) or a binary image.
   */
  async getContent(path, ref) {
    const res = await this.call("GET", `/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
    return Buffer.from(res.content ?? "", res.encoding === "base64" ? "base64" : "utf8");
  }
}

/** Encode each path segment but keep the slashes the contents API expects. */
function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * Commits multiple files in a single commit.
 * New branch: create it. Existing branch: commit onto it.
 */
export async function commitFiles(gh, { branch, baseBranch, files, remove = [], message, neu }) {
  const parent = neu ? await gh.refSha(baseBranch) : await gh.refSha(branch);
  const baseTree = await gh.commitTree(parent);

  const withSha = [];
  for (const file of files) {
    withSha.push({ path: file.path, sha: await gh.blob(file.contentBase64) });
  }

  const treeSha = await gh.tree(baseTree, withSha, remove);
  const commitSha = await gh.commit(message, treeSha, parent);

  if (neu) await gh.createBranch(branch, commitSha);
  else await gh.updateBranch(branch, commitSha);

  return commitSha;
}
