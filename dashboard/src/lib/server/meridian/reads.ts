import fs from "node:fs";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { readJson, readJsonCached } from "./fs-adapter";
import { runCli } from "./cli-adapter";
import { meridianPath } from "./paths";
import { lockStatus } from "./lock";

// ── live chain/API data (via cli.js) ──
export const getBalance = createServerFn({ method: "GET" }).handler(async () => {
  const r = await runCli(["balance"]);
  return r.ok ? r.data : { error: r.error };
});

export const getPositions = createServerFn({ method: "GET" }).handler(async () => {
  const r = await runCli(["positions"]);
  return r.ok ? r.data : { positions: [], error: r.error };
});

export const getCandidates = createServerFn({ method: "GET" })
  .inputValidator(z.object({ limit: z.number().min(1).max(20).default(5) }))
  .handler(async ({ data }) => {
    const r = await runCli(["candidates", "--limit", String(data.limit)], { timeoutMs: 90_000 });
    return r.ok ? r.data : { candidates: [], error: r.error };
  });

export const getPerformance = createServerFn({ method: "GET" }).handler(async () => {
  const r = await runCli(["performance"]);
  return r.ok ? r.data : { summary: {}, positions: [], error: r.error };
});

export const getLessons = createServerFn({ method: "GET" }).handler(async () => {
  const r = await runCli(["lessons"]);
  return r.ok ? r.data : { lessons: [], total: 0, error: r.error };
});

export const getConfig = createServerFn({ method: "GET" }).handler(async () => {
  const r = await runCli(["config", "get"]);
  return r.ok ? r.data : { error: r.error };
});

export const getDiscordSignals = createServerFn({ method: "GET" }).handler(async () => {
  const r = await runCli(["discord-signals"]);
  return r.ok ? r.data : { count: 0, signals: [] };
});

export const getBlacklist = createServerFn({ method: "GET" }).handler(async () => {
  const r = await runCli(["blacklist", "list"]);
  return r.ok ? r.data : { count: 0, blacklist: [] };
});

// ── raw state files (direct read) ──
export const getDecisions = createServerFn({ method: "GET" }).handler(async () => {
  const d = await readJson<{ decisions: unknown[] }>("decision-log.json", { decisions: [] });
  return d.decisions || [];
});

export const getState = createServerFn({ method: "GET" }).handler(async () => {
  return readJsonCached<Record<string, unknown>>("state.json", {});
});

export const getSignalWeights = createServerFn({ method: "GET" }).handler(async () => {
  return readJsonCached<Record<string, unknown>>("signal-weights.json", {});
});

export const getSmartWallets = createServerFn({ method: "GET" }).handler(async () => {
  return readJsonCached<Record<string, unknown>>("smart-wallets.json", { wallets: [] });
});

export const getPoolMemory = createServerFn({ method: "GET" }).handler(async () => {
  return readJsonCached<Record<string, unknown>>("pool-memory.json", {});
});

// ── action trail (logs/actions-YYYY-MM-DD.jsonl, UTC date per logger.js) ──
export const getActivity = createServerFn({ method: "GET" })
  .inputValidator(z.object({ limit: z.number().min(1).max(1000).default(200) }))
  .handler(async ({ data }) => {
    const date = new Date().toISOString().split("T")[0];
    const fp = meridianPath("logs", `actions-${date}.jsonl`);
    let lines: unknown[] = [];
    try {
      lines = fs
        .readFileSync(fp, "utf8")
        .split("\n")
        .filter(Boolean)
        .slice(-data.limit)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return { raw: l };
          }
        })
        .reverse();
    } catch { /* no file today */ }
    return { date, actions: lines };
  });

// ── agent status (lock + log freshness) ──
export const getAgentStatus = createServerFn({ method: "GET" }).handler(async () => {
  const lock = lockStatus();
  let lastLogMs = 0;
  try {
    const date = new Date().toISOString().split("T")[0];
    lastLogMs = fs.statSync(meridianPath("logs", `actions-${date}.jsonl`)).mtimeMs;
  } catch { /* none */ }
  const recentlyActive = lastLogMs > 0 && Date.now() - lastLogMs < 15_000;
  return {
    busy: !!lock || recentlyActive,
    holder: lock?.holder ?? (recentlyActive ? "agent" : null),
    kind: lock?.kind ?? null,
    since: lock?.startedAt ?? null,
    dryRun: String(process.env.DRY_RUN).toLowerCase() === "true",
    paper: String(process.env.PAPER_TRADING).toLowerCase() === "true",
  };
});
