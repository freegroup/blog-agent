/**
 * pm2 configuration.
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 logs
 *   pm2 stop all
 *
 * Five processes. The MCP servers (mcp-calc, mcp-telegram) are deliberately
 * NOT listed here: they are started and stopped as child processes via stdio
 * by the services that need them. Starting them additionally via pm2 would
 * create two instances — for mcp-telegram that is fatal because two pollers
 * with the same token get a 409 from Telegram.
 *
 * `cwd` is the repo root everywhere: settings.yaml, briefings/, and var/queue/
 * are resolved relative to it.
 */
const shared = {
  cwd: __dirname,
  autorestart: true,
  max_restarts: 10,
  restart_delay: 5000,
  time: true,
  merge_logs: true,
  out_file: "var/log/out.log",
  error_file: "var/log/err.log",
};

module.exports = {
  apps: [
    {
      // The conversation record + live broadcaster (SSE). Producers POST into it.
      name: "chat-history",
      script: "services/chat-history/index.js",
      ...shared,
    },
    {
      // Accepts pitches, writes articles, submits to the sink. Holds the queue.
      name: "newsroom",
      script: "services/newsroom/index.js",
      ...shared,
    },
    {
      // step-dialog: the reception desk in front of step-research. Decides per
      // request whether to forward, ask the user something first, answer a read-only
      // request, or repost a past posting. SENDS on Telegram (reuses mcp-telegram for
      // the token), so it needs the Telegram secrets — but it never polls.
      name: "step-dialog",
      script: "services/step-dialog/index.js",
      ...shared,
    },
    {
      // step-research: a transforming hop that enriches each fresh pitch with
      // `context`, forwards to the newsroom (its `out`). Started after the newsroom.
      // No secrets.
      name: "step-research",
      script: "services/step-research/index.js",
      ...shared,
    },
    {
      // Creates PRs. Holds the GitHub PAT.
      name: "sink-github",
      script: "services/sink-github/index.js",
      ...shared,
    },
    {
      // Reports whatever has permanently failed. Without it a failure is silent.
      name: "sink-deadletter",
      script: "services/sink-deadletter/index.js",
      ...shared,
    },
    {
      // Delivers a finished article as a Telegram chat message plus its images.
      // Reuses mcp-telegram for the token, so needs the Telegram secrets.
      name: "sink-telegram",
      script: "services/sink-telegram/index.js",
      ...shared,
    },
    {
      // Publishes a finished article to Instagram as a photo post. Uploads images to
      // the `instagram-assets` branch of the GitHub repo (public URL needed by Instagram),
      // then uses the Meta Graph API. Holds INSTAGRAM_APP_ID/APP_SECRET and GITHUB_TOKEN.
      // Single fork process — it writes .env, so no second instance should race it.
      name: "sink-instagram",
      script: "services/sink-instagram/index.js",
      exec_mode: "fork",
      ...shared,
    },
    {
      // Publishes a finished article to Pinterest as a Pin. Holds its own Pinterest
      // app credentials (PINTEREST_APP_ID/APP_SECRET) and manages the OAuth refresh
      // token in .env itself. Single fork process — it writes .env, so no second
      // instance should race it.
      name: "sink-pinterest",
      script: "services/sink-pinterest/index.js",
      exec_mode: "fork",
      ...shared,
    },
    {
      // Long-polling on Telegram. fork mode, one process — see above. `instances`
      // would switch pm2 to cluster mode, which is for port-sharing HTTP servers.
      name: "source-telegram",
      script: "services/source-telegram/index.js",
      exec_mode: "fork",
      ...shared,
    },
    {
      // Return channel: PR comments become revision pitches.
      name: "source-github",
      script: "services/source-github/index.js",
      ...shared,
    },
    {
      // Watches the blog RSS feed; reports newly live posts to Telegram + chat hub.
      name: "watch-rss",
      script: "services/watch-rss/index.js",
      exec_mode: "fork",
      ...shared,
    },
  ],
};
