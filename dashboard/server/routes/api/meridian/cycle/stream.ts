// @ts-nocheck — Nitro server route; defineEventHandler/getQuery are runtime globals
import { runCycleStream } from "../../../../../src/lib/server/meridian/cycle-stream";
import { acquireLock, releaseLock } from "../../../../../src/lib/server/meridian/lock";

export default defineEventHandler(async (event) => {
  const kind = getQuery(event).kind === "manage" ? "manage" : "screen";
  const res = event.node.res;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);

  if (!acquireLock("dashboard", kind)) {
    send({ type: "error", message: "agent busy — a cycle is already running" });
    send({ type: "done" });
    return res.end();
  }

  const ac = new AbortController();
  const hb = setInterval(() => res.write(": ping\n\n"), 15_000);
  event.node.req.on("close", () => ac.abort());

  try {
    send({ type: "started", kind });
    await runCycleStream(kind, send, ac.signal);
  } catch (e) {
    send({ type: "error", message: String(e?.message || e) });
  } finally {
    clearInterval(hb);
    releaseLock();
    res.end();
  }
});
