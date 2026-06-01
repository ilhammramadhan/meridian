/**
 * paper.js — Forward paper-trading (simulation) engine for Meridian.
 *
 * When PAPER_TRADING=true the agent runs with a FAKE SOL balance and VIRTUAL positions
 * (no on-chain transactions, no real funds). Positions are marked-to-market from LIVE
 * Meteora pool data (active bin + price + fee/TVL) so PnL / fees / win-rate accrue over
 * real time, letting you monitor behavior and evaluate strategy performance.
 *
 * Integration is transparent: tools/wallet.js + tools/dlmm.js delegate to this engine when
 * isPaper() is true, so the agent cycles, the CLI, and the dashboard all operate on the
 * virtual ledger automatically. The real on-chain code paths are untouched in live mode.
 *
 * PnL MODEL (documented approximation — not a bin-exact DLMM simulator):
 *   Single-sided SOL below the active bin. Range = [entry_bin - bins_below, entry_bin].
 *   - In range, fees accrue: deployed_usd × (fee_active_tvl_ratio% / tf_minutes) × elapsed_min.
 *   - Price PnL: while price stays at/above entry → held as SOL (≈0 IL). As price falls
 *     through the range, a fraction f=(entry_bin-cur_bin)/bins_below of capital is treated as
 *     converted to token at the mid-fill price; its value is marked at the current price.
 *   Good enough to compare strategies and watch behavior; label it "simulated".
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./logger.js";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(__dirname, "paper-state.json");

const TF_MIN = { "5m": 5, "15m": 15, "30m": 30, "1h": 60, "2h": 120, "4h": 240, "12h": 720, "24h": 1440 };

export function isPaper() {
  return process.env.PAPER_TRADING === "true" || config.paper?.enabled === true;
}

function initialBalance() {
  return Number(process.env.PAPER_SOL) || config.paper?.balanceSol || 5;
}

function load() {
  if (fs.existsSync(STATE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE, "utf8"));
    } catch { /* recreate */ }
  }
  const fresh = { balance_sol: initialBalance(), positions: {}, closed: [], created_at: new Date().toISOString() };
  save(fresh);
  return fresh;
}

function save(d) {
  fs.writeFileSync(STATE, JSON.stringify(d, null, 2));
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

// ─── live data (dynamic imports avoid an import cycle with dlmm/wallet/screening) ───
async function liveBin(pool_address) {
  try {
    const { getActiveBin } = await import("./tools/dlmm.js");
    const b = await getActiveBin({ pool_address });
    return { bin: num(b.binId), price: num(b.price) };
  } catch (e) {
    log("paper_warn", `liveBin failed for ${pool_address?.slice(0, 8)}: ${e.message}`);
    return null;
  }
}

async function poolFeeRatio(pool_address) {
  try {
    const { getPoolDetail } = await import("./tools/screening.js");
    const d = await getPoolDetail({ pool_address, timeframe: config.screening.timeframe });
    return num(d.fee_active_tvl_ratio);
  } catch {
    return 0;
  }
}

// QW#7: cache last-known-good SOL price (persisted in paper-state.json as last_sol_price)
// so a transient 0/throw from the live fetch never poisons valuations or opens zombie
// positions with deployed_usd = 0.
async function solUsdPrice() {
  let live = 0;
  try {
    const { getRealWalletBalances } = await import("./tools/wallet.js");
    const r = await getRealWalletBalances();
    live = num(r.sol_price);
  } catch {
    live = 0;
  }
  if (live > 0) {
    // persist the good price for fallback on future failures
    try {
      const state = load();
      if (num(state.last_sol_price) !== live) {
        state.last_sol_price = live;
        save(state);
      }
    } catch { /* best-effort cache write */ }
    return live;
  }
  // live fetch failed/returned 0 — fall back to the last-known-good cached price
  try {
    const cached = num(load().last_sol_price);
    if (cached > 0) {
      log("paper_warn", `solUsdPrice live fetch unavailable; using cached $${cached}`);
      return cached;
    }
  } catch { /* ignore */ }
  return 0;
}

function openSol(state) {
  return Object.values(state.positions).reduce((s, p) => s + num(p.amount_sol), 0);
}

// ─── wallet (fake balance) ───
export async function paperBalance() {
  const state = load();
  const solPrice = await solUsdPrice();
  const available = Math.max(0, num(state.balance_sol) - openSol(state));
  return {
    wallet: "PAPER",
    sol: Math.round(available * 1e6) / 1e6,
    sol_price: solPrice,
    sol_usd: Math.round(available * solPrice * 100) / 100,
    usdc: 0,
    tokens: [],
    total_usd: Math.round(available * solPrice * 100) / 100,
    paper: true,
  };
}

// ─── deploy (virtual position) ───
export async function paperDeploy(params) {
  const state = load();
  const amount_sol = num(params.amount_sol ?? params.amount_y, config.management.deployAmountSol);
  const available = num(state.balance_sol) - openSol(state);
  if (amount_sol > available) {
    return { success: false, error: `Paper: insufficient virtual balance (${available.toFixed(3)} SOL available, need ${amount_sol})` };
  }
  const live = await liveBin(params.pool_address);
  if (!live) return { success: false, error: "Paper: could not read live pool bin/price" };

  // Enrich missing metadata from the pool so the position shows a readable pair NAME
  // (not the raw address) plus realistic bin_step/volatility/fee_tvl_ratio.
  let meta = {};
  if (!params.pool_name || params.pool_name === params.pool_address || params.bin_step == null || params.volatility == null) {
    try {
      const { getPoolDetail } = await import("./tools/screening.js");
      const d = await getPoolDetail({ pool_address: params.pool_address, timeframe: config.screening.timeframe });
      meta = {
        name: d?.name,
        base_mint: d?.base?.mint ?? d?.base_mint ?? null,
        bin_step: d?.bin_step,
        volatility: d?.volatility,
        fee_tvl_ratio: d?.fee_active_tvl_ratio,
      };
    } catch { /* best-effort enrichment */ }
  }

  const solPrice = await solUsdPrice();
  // QW#7: refuse to open without a usable SOL price — otherwise deployed_usd = 0 creates a
  // zombie position whose value/PnL can never be marked correctly.
  if (!(solPrice > 0)) {
    return { success: false, error: "no SOL price" };
  }
  const binsBelow = num(params.bins_below, config.strategy.defaultBinsBelow);
  const now = new Date().toISOString();
  const id = `paper_${Date.now()}`;
  state.positions[id] = {
    position: id,
    pool: params.pool_address,
    pool_name: (params.pool_name && params.pool_name !== params.pool_address) ? params.pool_name : (meta.name || params.pool_address),
    base_mint: params.base_mint || meta.base_mint || null,
    strategy: params.strategy || config.strategy.strategy,
    amount_sol,
    bins_below: binsBelow,
    bins_above: num(params.bins_above),
    bin_step: num(params.bin_step) || num(meta.bin_step),
    volatility: num(params.volatility) || (Number.isFinite(meta.volatility) ? meta.volatility : null),
    fee_tvl_ratio: num(params.fee_tvl_ratio) || (Number.isFinite(meta.fee_tvl_ratio) ? meta.fee_tvl_ratio : null),
    organic_score: num(params.organic_score) || null,
    entry_bin: live.bin,
    entry_price: live.price,
    deployed_usd: amount_sol * solPrice,
    deployed_at: now,
    last_mark_at: now,
    fees_usd: 0,
    minutes_in_range: 0,
    peak_pnl_pct: 0,
    out_of_range_since: null,
    // §4.3 path-dependent PnL bookkeeping (SOL→token conversions booked once, marked each tick)
    converted_frac: 0,
    converted_usd: 0,
    converted_tokens: 0,
    avg_fill_price: null,
  };
  save(state);
  log("paper", `Virtual deploy ${state.positions[id].pool_name} ${amount_sol} SOL @ bin ${live.bin} (${binsBelow} below)`);
  return { success: true, position: id, paper: true, pool_address: params.pool_address, amount_sol, bins_below: binsBelow, strategy: state.positions[id].strategy };
}

// ─── mark-to-market one position ───
async function mark(p, solPrice) {
  const live = await liveBin(p.pool);
  const now = Date.now();
  const elapsedMin = (now - new Date(p.last_mark_at).getTime()) / 60000;
  const ageMin = (now - new Date(p.deployed_at).getTime()) / 60000;
  const upper = p.entry_bin;
  const lower = p.entry_bin - p.bins_below;

  if (!live) {
    return { ...buildView(p, { active_bin: null, in_range: null, pnl_usd: p.fees_usd, ageMin, upper, lower }), _persist: p };
  }

  const inRange = live.bin >= lower && live.bin <= upper;

  // fee accrual while in range
  if (inRange && elapsedMin > 0) {
    const ratio = await poolFeeRatio(p.pool); // % per screening timeframe
    const tf = TF_MIN[config.screening.timeframe] || 5;
    p.fees_usd = num(p.fees_usd) + p.deployed_usd * (ratio / 100) * (elapsedMin / tf);
    p.minutes_in_range = num(p.minutes_in_range) + elapsedMin;
  }

  // OOR timing (price pumped above range = out of range upside, like single-sided SOL)
  if (!inRange) {
    if (!p.out_of_range_since) p.out_of_range_since = new Date(now).toISOString();
  } else {
    p.out_of_range_since = null;
  }

  // price PnL (approximation) — §4.3 path-dependent.
  // As price falls through the range, capital is progressively converted SOL→token at the
  // fill price *at the moment of conversion*. We BOOK that conversion once (persist the
  // converted USD notional + the avg fill price), then mark the booked token leg at the
  // current price each tick. This makes dip-then-recover path-dependent: a position that
  // dipped and recovered keeps the token it bought cheap (a gain), instead of re-deriving
  // the fill from the current (recovered) bin every mark, which previously washed out the
  // path entirely.
  let pricePnl = 0;
  if (p.entry_price > 0) {
    // fraction of capital that should be converted to token at the *current* depth
    const fNow = Math.min(1, Math.max(0, (p.entry_bin - live.bin) / Math.max(1, p.bins_below)));
    const prevConverted = Math.min(1, Math.max(0, num(p.converted_frac)));

    // Book any NEWLY converted slice at the current fill price (monotonic: we only convert
    // more as price makes new lows; a recovery does not "sell back" the booked token leg —
    // single-sided SOL ranges fill on the way down and hold the token).
    if (fNow > prevConverted) {
      const lowerPrice = p.entry_price * Math.pow(1 - num(p.bin_step) / 10000, p.bins_below);
      const fillNow = (p.entry_price + Math.max(live.price, lowerPrice)) / 2;
      const newSlice = fNow - prevConverted;
      const sliceUsd = newSlice * p.deployed_usd;          // SOL notional converted now
      const sliceTokens = sliceUsd / Math.max(fillNow, 1e-12);
      p.converted_usd = num(p.converted_usd) + sliceUsd;   // capital removed from the SOL leg
      p.converted_tokens = num(p.converted_tokens) + sliceTokens;
      p.converted_frac = fNow;
      // weighted avg fill price across all booked slices (documentation/debug)
      p.avg_fill_price = num(p.converted_usd) / Math.max(num(p.converted_tokens), 1e-12);
    }

    // Mark the booked token leg at the current price; the unconverted remainder is still SOL
    // (≈ flat, no IL). PnL = (token leg value now) − (capital spent buying it).
    const convertedTokens = num(p.converted_tokens);
    if (convertedTokens > 0) {
      const tokenValueNow = convertedTokens * live.price;
      pricePnl = tokenValueNow - num(p.converted_usd);
    }
  }

  const totalValue = p.deployed_usd + num(p.fees_usd) + pricePnl;
  const pnlUsd = totalValue - p.deployed_usd;
  const pnlPct = p.deployed_usd > 0 ? (pnlUsd / p.deployed_usd) * 100 : 0;
  p.peak_pnl_pct = Math.max(num(p.peak_pnl_pct), pnlPct);
  p.last_mark_at = new Date(now).toISOString();

  const minutesOOR = p.out_of_range_since ? (now - new Date(p.out_of_range_since).getTime()) / 60000 : 0;
  return {
    ...buildView(p, { active_bin: live.bin, in_range: inRange, pnl_usd: pnlUsd, pnl_pct: pnlPct, total_value_usd: totalValue, ageMin, upper, lower, minutesOOR, price: live.price }),
    _persist: p,
  };
}

function buildView(p, m) {
  return {
    position: p.position,
    pool: p.pool,
    pair: p.pool_name,
    pool_name: p.pool_name,
    base_mint: p.base_mint,
    strategy: p.strategy,
    amount_sol: p.amount_sol,
    bin_range: { lower: m.lower, upper: m.upper },
    lower_bin: m.lower,
    upper_bin: m.upper,
    active_bin: m.active_bin ?? null,
    in_range: m.in_range ?? null,
    pnl_usd: Math.round(num(m.pnl_usd) * 100) / 100,
    pnl_pct: Math.round(num(m.pnl_pct) * 100) / 100,
    total_value_usd: Math.round(num(m.total_value_usd ?? p.deployed_usd + num(p.fees_usd)) * 100) / 100,
    peak_pnl_pct: Math.round(num(p.peak_pnl_pct) * 100) / 100,
    unclaimed_fees_usd: Math.round(num(p.fees_usd) * 100) / 100,
    total_fees_claimed_usd: 0,
    fee_per_tvl_24h: p.fee_tvl_ratio ?? null,
    minutes_out_of_range: Math.round(num(m.minutesOOR)),
    age_minutes: Math.round(num(m.ageMin)),
    out_of_range_since: p.out_of_range_since,
    deployed_at: p.deployed_at,
    current_price: m.price ?? null,
    paper: true,
  };
}

// ─── positions (marked-to-market) ───
export async function paperPositions() {
  const state = load();
  const ids = Object.keys(state.positions);
  if (!ids.length) return { positions: [], total_positions: 0, paper: true };
  // §5.4 perf: SOL price fetched ONCE, per-position marks run concurrently.
  const solPrice = await solUsdPrice();
  const marked = await Promise.all(ids.map((id) => mark(state.positions[id], solPrice)));
  const views = [];
  ids.forEach((id, i) => {
    const view = marked[i];
    state.positions[id] = view._persist;
    delete view._persist;
    views.push(view);
  });
  save(state);
  return { positions: views, total_positions: views.length, paper: true };
}

export async function paperPositionPnl({ position_address }) {
  const { positions } = await paperPositions();
  const p = positions.find((x) => x.position === position_address);
  return p || { error: "paper position not found", paper: true };
}

// ─── claim (bank accrued fees) ───
export async function paperClaim({ position_address }) {
  const state = load();
  const p = state.positions[position_address];
  if (!p) return { success: false, error: "paper position not found" };
  const claimed = num(p.fees_usd);
  state.balance_sol = num(state.balance_sol); // fees tracked in USD; keep simple — credited at close
  p.claimed_fees_usd = num(p.claimed_fees_usd) + claimed;
  p.fees_usd = 0;
  save(state);
  log("paper", `Virtual claim ${p.pool_name}: $${claimed.toFixed(2)} fees`);
  return { success: true, position: position_address, claimed_usd: Math.round(claimed * 100) / 100, paper: true };
}

// ─── close (record performance → lessons/brain) ───
export async function paperClose({ position_address, reason }) {
  const state = load();
  const p = state.positions[position_address];
  if (!p) return { success: false, error: "paper position not found" };

  const solPrice = await solUsdPrice();
  const view = await mark(p, solPrice);
  delete view._persist;

  // §4.3: total_value_usd only reflects UNCLAIMED fees (paperClaim zeroes p.fees_usd and
  // banks it into claimed_fees_usd). Add already-claimed fees back so a claim-then-close
  // sequence credits the same total as a single close.
  const finalValueUsd = view.total_value_usd + num(p.claimed_fees_usd);
  // credit virtual balance back: original capital +/- pnl + claimed fees, in SOL terms
  const returnedSol = solPrice > 0 ? finalValueUsd / solPrice : p.amount_sol;
  state.balance_sol = num(state.balance_sol) - p.amount_sol + returnedSol;

  const minutesHeld = (Date.now() - new Date(p.deployed_at).getTime()) / 60000;
  const perf = {
    position: p.position,
    pool: p.pool,
    pool_name: p.pool_name,
    base_mint: p.base_mint,
    strategy: p.strategy,
    bin_range: { lower: view.lower_bin, upper: view.upper_bin },
    bin_step: p.bin_step,
    volatility: p.volatility,
    fee_tvl_ratio: p.fee_tvl_ratio,
    organic_score: p.organic_score,
    amount_sol: p.amount_sol,
    fees_earned_usd: num(p.claimed_fees_usd) + num(p.fees_usd),
    fees_earned_sol: solPrice > 0 ? (num(p.claimed_fees_usd) + num(p.fees_usd)) / solPrice : 0,
    final_value_usd: finalValueUsd,
    initial_value_usd: p.deployed_usd,
    minutes_in_range: Math.round(num(p.minutes_in_range)),
    minutes_held: Math.round(minutesHeld),
    close_reason: reason || "paper close",
    deployed_at: p.deployed_at,
  };

  delete state.positions[position_address];
  state.closed.unshift({ ...perf, closed_at: new Date().toISOString(), pnl_usd: view.pnl_usd, pnl_pct: view.pnl_pct });
  state.closed = state.closed.slice(0, 200);
  save(state);

  // Feed the learning loop exactly like a real close (lessons + brain ingest)
  try {
    const { recordPerformance } = await import("./lessons.js");
    await recordPerformance(perf);
  } catch (e) {
    log("paper_warn", `recordPerformance failed: ${e.message}`);
  }

  log("paper", `Virtual close ${p.pool_name}: pnl ${view.pnl_pct}% ($${view.pnl_usd}) — ${reason || "paper close"}`);
  return { success: true, position: position_address, pnl_pct: view.pnl_pct, pnl_usd: view.pnl_usd, base_mint: p.base_mint, paper: true };
}

// ─── swap (simulated fill) ───
// QW#3: in paper mode swaps never touch the chain. We return a simulated 1:?? fill so the
// agent's claim→swap→close flow runs end-to-end on the virtual ledger. The paper position
// PnL model already accounts for SOL/token value, so this is a pass-through stub: it reports
// the input amount as filled and (best-effort) prices the output via the live SOL/token price
// when both legs are known, otherwise echoes the input amount.
export async function paperSwap({ input_mint, output_mint, amount }) {
  const input_amount = num(amount);
  // We don't model per-token order books here; report a 1:1 notional fill unless a SOL price
  // is available to convert, which the position-level PnL model already handles separately.
  const output_amount = input_amount;
  log("paper", `Virtual swap ${input_amount} ${String(input_mint).slice(0, 6)} → ${String(output_mint).slice(0, 6)}`);
  return {
    success: true,
    paper: true,
    input_mint,
    output_mint,
    input_amount,
    output_amount,
    tx: "paper",
  };
}

// ─── CLI helpers ───
export async function paperStatus() {
  const state = load();
  const { positions } = await paperPositions();
  const closed = state.closed || [];
  const wins = closed.filter((c) => num(c.pnl_pct) > 0).length;
  return {
    paper: true,
    balance_sol: Math.round(num(state.balance_sol) * 1e6) / 1e6,
    open: positions.length,
    open_positions: positions,
    closed_count: closed.length,
    win_rate_pct: closed.length ? Math.round((wins / closed.length) * 1000) / 10 : 0,
    total_pnl_usd: Math.round(closed.reduce((s, c) => s + num(c.pnl_usd), 0) * 100) / 100,
    created_at: state.created_at,
  };
}

export function paperReset(balanceSol) {
  const fresh = { balance_sol: num(balanceSol) || initialBalance(), positions: {}, closed: [], created_at: new Date().toISOString() };
  save(fresh);
  log("paper", `Paper ledger reset — ${fresh.balance_sol} SOL`);
  return { reset: true, balance_sol: fresh.balance_sol };
}
