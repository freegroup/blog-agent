/**
 * Client to the chat hub (`services/chat`).
 *
 * `shared/*` is libraries — this is the thin client every service uses to talk to
 * the hub. The hub itself is a running service that persists the conversation and
 * broadcasts it; this only speaks to it: push a message, read history, or
 * subscribe to the live stream.
 *
 * `subscribe` realises the observer wish across processes: opening the stream is
 * "registering"; the hub broadcasts to everyone and does not know who is on the
 * other end. Reconnect is built in — a dropped hub comes back on its own.
 *
 * @typedef {{
 *   direction:'in'|'out', author?:string, text?:string,
 *   chat_id?:(string|number), message_id?:number, reply_to?:object|null, meta?:object
 * }} ChatEntry
 */
const BASE = process.env.CHAT_URL ?? "http://127.0.0.1:5090";

/** Record one message with the hub. Never throws — logging must not break I/O. */
export async function postMessage(entry, { baseUrl = BASE } = {}) {
  try {
    await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    });
  } catch (err) {
    console.error(`[chat] post failed: ${err.message}`);
  }
}

/** The last `limit` messages, oldest-first. Empty on any error. */
export async function history({ limit = 50, baseUrl = BASE } = {}) {
  try {
    const res = await fetch(`${baseUrl}/messages?limit=${limit}`);
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

/**
 * Subscribe to the live stream. Calls `onMessage(entry)` for every new message,
 * reconnecting on its own if the hub restarts. Returns a function to stop.
 *
 * A minimal SSE reader over fetch — no dependency, works wherever fetch does.
 */
export function subscribe(onMessage, { baseUrl = BASE, reconnectMs = 2000 } = {}) {
  let closed = false;
  const ac = new AbortController();

  (async () => {
    while (!closed) {
      try {
        const res = await fetch(`${baseUrl}/events`, { headers: { accept: "text/event-stream" }, signal: ac.signal });
        if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const data = frame.split("\n").find((l) => l.startsWith("data:"));
            if (data) {
              try {
                onMessage(JSON.parse(data.slice(5).trim()));
              } catch {
                /* ignore a malformed frame */
              }
            }
          }
        }
      } catch (err) {
        if (!closed) console.error(`[chat] stream dropped, reconnecting: ${err.message}`);
      }
      if (!closed) await new Promise((r) => setTimeout(r, reconnectMs));
    }
  })();

  return () => {
    closed = true;
    ac.abort();
  };
}
