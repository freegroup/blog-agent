/**
 * pm2 configuration for local testing.
 *
 *   pm2 start ecosystem.local.config.cjs
 *   pm2 logs
 *   pm2 delete ecosystem.local.config.cjs
 *
 * The `.config.cjs` in the name is load-bearing: pm2 only treats a file as a
 * config if the filename contains .json, .yml, .yaml, .config.js, .config.cjs
 * or .config.mjs. Named ecosystem.local.cjs it would silently be started as a
 * plain script instead, yielding one useless process and no services.
 *
 * The full setup lives in ecosystem.config.cjs. This one adds the file sink as a
 * local debug mirror ALONGSIDE the real GitHub sink:
 *
 *   - sink-github (the real publication) AND sink-file (a debug copy) both run.
 *     A briefing points `target-sink` at http://127.0.0.1:5081/publish (GitHub)
 *     and `logging-sink` at http://127.0.0.1:5082/publish (file). Every article
 *     then lands as a PR and, best-effort, as readable Markdown in var/sink/<slug>/.
 *   - Because sink-github runs, GITHUB_TOKEN is required here too (plus
 *     TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID). source-github also runs, so the
 *     PR return channel is live: a comment on a labelled PR by GITHUB_OWNER is
 *     forwarded as a revise-pitch. That adds GITHUB_OWNER to the required env.
 *     (Revisions can still come over Telegram too — both channels feed the same
 *     newsroom.)
 *
 * The two configs are alternatives, not additions — newsroom, sink-github,
 * sink-deadletter, and source-telegram appear in both under the same names and
 * would fight over the same ports. Stop one before starting the other.
 *
 * Which sinks actually receive the article is decided by the briefing, not here:
 * briefings/camper-blog.md must set `target-sink`/`logging-sink` to the URLs above.
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
      // The conversation record + live broadcaster (SSE). Started first so the
      // producers below can POST into it. No secrets.
      name: "chat",
      script: "services/chat/index.js",
      ...shared,
    },
    {
      // Writes articles to var/sink/<slug>/. Needs no secrets, no network, no repo.
      // Here the debug mirror (logging-sink), not the real target.
      name: "sink-file",
      script: "services/sink-file/index.js",
      ...shared,
    },
    {
      // The real publication: creates PRs. Holds the GitHub PAT (GITHUB_TOKEN).
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
      // Accepts pitches, writes articles, submits to the sink. Holds the queue.
      // Started after the sinks so a fast first job finds them listening.
      name: "newsroom",
      script: "services/newsroom/index.js",
      ...shared,
    },
    {
      // The research filter: enriches each fresh pitch with `context` and forwards
      // it to the newsroom. Started after the newsroom (its `out`). No secrets.
      name: "research",
      script: "services/research/index.js",
      ...shared,
    },
    {
      // Long-polling on Telegram. fork mode, one process — two pollers with the
      // same token get a 409 from Telegram, and `instances` would switch pm2 to
      // cluster mode, which is for port-sharing HTTP servers, not a poller.
      name: "source-telegram",
      script: "services/source-telegram/index.js",
      exec_mode: "fork",
      ...shared,
    },
    {
      // The PR return channel: polls labelled PRs and forwards GITHUB_OWNER's
      // comments as revise-pitches. Single fork process — a second poller would
      // double-ack the same comment. Needs GITHUB_TOKEN and GITHUB_OWNER.
      name: "source-github",
      script: "services/source-github/index.js",
      exec_mode: "fork",
      ...shared,
    },
    {
      // Watches the blog RSS feed; reports newly live posts to Telegram and the
      // chat hub. Single fork poller. Needs the Telegram secrets (via mcp-telegram).
      name: "watch-rss",
      script: "services/watch-rss/index.js",
      exec_mode: "fork",
      ...shared,
    },
  ],
};
