# Meridian Dashboard

Monitoring + control dashboard for the [Meridian](../) autonomous DLMM liquidity agent.
TanStack Start + Tailwind v4 + shadcn/ui + recharts. Light/blue admin theme.

## What it does

- **Overview** — wallet/PnL KPIs, cumulative-PnL + win-rate charts, recent decisions, one-click *Run screen / Manage now* with a **live reasoning stream** (the agent thinking through a cycle via your local Claude session).
- **Screening** — candidate cards + the agent's deploy/skip decisions (reasons, risks), blacklist action.
- **Positions** — open/closed with bin-range progress, live PnL, *Claim* / *Close* (no-confirm).
- **Brain** — the Karpathy LLM-wiki: page index, page viewer, log; *Lint* / *Rebuild*.
- **Performance / Signals / Activity / Config** — outcomes & lessons, Darwin weights + smart wallets + Discord queue, live action-trail tail, and live config editing.

## How it reads the agent

Server functions read the Meridian project dir (`MERIDIAN_DIR`, default `..`): JSON state files
directly + `node cli.js …` for live chain data. SSE routes stream cycle reasoning
(`/api/meridian/cycle/stream`) and the action-trail (`/api/meridian/logs/stream`). A cross-process
lock (`.dashboard-cycle.lock`) serializes dashboard-triggered cycles against the autonomous agent.

## Run

```bash
cd meridian/dashboard
npm install
cp .env.example .env   # keep DRY_RUN=true until validated
npm run dev            # http://localhost:3001
```

The Meridian agent must be set up (its `.env` with `WALLET_PRIVATE_KEY` / `RPC_URL`) for live
data, and `claude login` must be active for the cycle reasoning stream.

> **Full control = no confirmation.** With `DRY_RUN=false`, Close/Claim/Run-screen move real funds.
