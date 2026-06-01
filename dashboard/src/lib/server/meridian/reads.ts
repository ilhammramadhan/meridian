import fs from "node:fs";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { readJson, readJsonCached } from "./fs-adapter";
import { runCli } from "./cli-adapter";
import { meridianPath, logsPath } from "./paths";
import { lockStatus } from "./lock";

/** Read the last N lines of a JSONL file, parsing each line (skips malformed rows). */
function tailJsonl(fp: string, max: number): unknown[] {
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(fp, "utf8").split("\n").filter(Boolean);
  } catch {
    return []; // no file yet
  }
  return lines
    .slice(-max)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((x) => x !== null);
}

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
    dryRun: agentEnvFlag("DRY_RUN"),
    paper: agentEnvFlag("PAPER_TRADING"),
  };
});

// Read a boolean flag from the agent's process env OR its .env file. The dashboard process
// often isn't started with these, but the agent's .env has them — so the LIVE/PAPER and
// DRY-RUN badges stay accurate regardless of how the dashboard was launched.
function agentEnvFlag(key: string): boolean {
  if (String(process.env[key]).toLowerCase() === "true") return true;
  try {
    const env = fs.readFileSync(meridianPath(".env"), "utf8");
    return new RegExp(`^\\s*${key}\\s*=\\s*true\\s*$`, "im").test(env);
  } catch {
    return false;
  }
}

// ── §5.2 paper ledger ──
// paper-state.json gives balance / deployed / realized / win-rate instantly (fast file
// read, no fork). Open positions are mark-to-market — their live PnL is NOT persisted in
// the file (only the raw record is), so we mark them via `cli.js paper status` which marks
// open positions concurrently against live pool data. If that fork fails, we still return
// the static figures from the file so the card never goes blank.
interface PaperState {
  balance_sol?: number;
  positions?: Record<string, { amount_sol?: number; deployed_usd?: number }>;
  closed?: { pnl_usd?: number; pnl_pct?: number }[];
}
interface PaperPosView { pnl_usd?: number; deployed_usd?: number; amount_sol?: number; total_value_usd?: number }

export const getPaperStatus = createServerFn({ method: "GET" }).handler(async () => {
  const state = await readJson<PaperState>("paper-state.json", {});
  const closed = state.closed || [];
  const wins = closed.filter((c) => Number(c.pnl_usd) > 0).length;
  const realizedPnlUsd = closed.reduce((s, c) => s + (Number(c.pnl_usd) || 0), 0);
  const winRatePct = closed.length ? Math.round((wins / closed.length) * 1000) / 10 : 0;
  const balanceSol = Number(state.balance_sol) || 0;
  // static deployed from the raw records (no live mark needed)
  const posRecords = Object.values(state.positions || {});
  let deployedUsd = posRecords.reduce((s, p) => s + (Number(p.deployed_usd) || 0), 0);
  let openCount = posRecords.length;

  // live mark-to-market for open PnL (best-effort)
  let openPnlUsd: number | null = null;
  let live = false;
  if (openCount > 0) {
    const r = await runCli<{
      open?: number;
      open_positions?: PaperPosView[];
      balance_sol?: number;
    }>(["paper", "status"], { timeoutMs: 30_000 });
    if (r.ok && r.data && Array.isArray(r.data.open_positions)) {
      const open = r.data.open_positions;
      openCount = r.data.open === undefined ? open.length : r.data.open;
      openPnlUsd = open.reduce((s, p) => s + (Number(p.pnl_usd) || 0), 0);
      deployedUsd = open.reduce((s, p) => s + (Number(p.deployed_usd) || 0), 0) || deployedUsd;
      live = true;
    }
  } else {
    openPnlUsd = 0;
    live = true;
  }

  return {
    paper: String(process.env.PAPER_TRADING).toLowerCase() === "true",
    balance_sol: balanceSol,
    open: openCount,
    deployed_usd: deployedUsd,
    open_pnl_usd: openPnlUsd, // null = couldn't mark live
    realized_pnl_usd: realizedPnlUsd,
    closed_count: closed.length,
    win_rate_pct: winRatePct,
    live_marked: live,
  };
});

// ── §5.1 reasoning stream (poll transport) ──
// The runner appends per-event rows to logs/reasoning.jsonl. We tail the last ~200 and the
// hook polls every ~2s (same transport as use-log-tail — no SSE).
export const getReasoning = createServerFn({ method: "GET" })
  .inputValidator(z.object({ limit: z.number().min(1).max(500).default(200) }))
  .handler(async ({ data }) => {
    const events = tailJsonl(logsPath("reasoning.jsonl"), data.limit);
    return { events };
  });

// ── closed positions ──
// getPositions returns OPEN positions only; closed ones move to paper-state.json `closed[]`
// (paper) or lessons.json `performance[]` (live). The Positions "Closed" tab reads from here.
interface ClosedRec {
  position?: string; pool?: string; pool_name?: string; strategy?: string; amount_sol?: number;
  pnl_pct?: number; pnl_usd?: number; fees_earned_usd?: number; minutes_held?: number;
  close_reason?: string; closed_at?: string; recorded_at?: string;
}
export const getClosedPositions = createServerFn({ method: "GET" }).handler(async () => {
  const paper = await readJson<{ closed?: ClosedRec[] }>("paper-state.json", {});
  let recs: ClosedRec[] = Array.isArray(paper.closed) ? paper.closed : [];
  if (!recs.length) {
    const l = await readJson<{ performance?: ClosedRec[] }>("lessons.json", {});
    recs = Array.isArray(l.performance) ? [...l.performance].reverse() : [];
  }
  return recs.map((c) => ({
    position: c.position,
    pool: c.pool,
    pool_name: c.pool_name,
    strategy: c.strategy,
    amount_sol: c.amount_sol,
    pnl_pct: c.pnl_pct,
    pnl_usd: c.pnl_usd,
    fees_earned_usd: c.fees_earned_usd,
    minutes_held: c.minutes_held,
    close_reason: c.close_reason,
    closed_at: c.closed_at || c.recorded_at,
    closed: true,
  }));
});

// ── §5.3 equity curve ──
// Runner appends one row per finished cycle to logs/paper-equity.jsonl. Return it as a
// time series for a real time-axis chart.
export const getEquityCurve = createServerFn({ method: "GET" })
  .inputValidator(z.object({ limit: z.number().min(1).max(5000).default(2000) }))
  .handler(async ({ data }) => {
    const rows = tailJsonl(logsPath("paper-equity.jsonl"), data.limit) as {
      ts?: number | string;
      total_value_usd?: number;
      balance_sol?: number;
      open?: number;
    }[];
    const points = rows
      .map((r) => {
        const t = typeof r.ts === "number" ? r.ts : Date.parse(String(r.ts));
        return {
          ts: t,
          total_value_usd: Number(r.total_value_usd) || 0,
          balance_sol: Number(r.balance_sol) || 0,
          open: Number(r.open) || 0,
        };
      })
      .filter((p) => Number.isFinite(p.ts))
      .sort((a, b) => a.ts - b.ts);
    return { points };
  });
