/**
 * strategy.js — Single hardcoded source of truth for Meridian's TRADING STRATEGY.
 *
 * These are the rigid gates/thresholds. They are consumed in two places that must
 * never disagree:
 *   1. The deterministic JS gates (tools/executor.js, tools/screening.js, index.js)
 *   2. The LLM prompts (prompt.js, the inline goals in index.js)
 * config.js uses these as the DEFAULTS for the live `config` object (user-config.json
 * may still override per key), and the prompts interpolate the effective `config`
 * values — so the model is always gated on the exact numbers it is shown.
 *
 * The "brain" (learned/episodic knowledge) NEVER stores or mutates these. Knowledge
 * informs the LLM's bounded judgment WITHIN these gates; it does not move the gates.
 * To change the strategy, edit this file (or override a key in user-config.json).
 */
export const STRATEGY = Object.freeze({
  // ─── Entry filters (screening gates) ───
  entry: Object.freeze({
    minFeeActiveTvlRatio: 0.05, // min fee/active-TVL yield
    minTvl: 10_000,
    maxTvl: 150_000,
    minVolume: 500,
    minOrganic: 60, // Jupiter organic score (anti-bot/wash)
    minQuoteOrganic: 60,
    minHolders: 500,
    minMcap: 150_000,
    maxMcap: 10_000_000,
    minBinStep: 80,
    maxBinStep: 125,
    minTokenFeesSol: 30, // global fees paid; below = bundled/scam
    maxBundlePct: 30, // max bundle holding % (OKX advanced-info)
    maxBotHoldersPct: 30, // max bot holder % (Jupiter audit)
    maxTop10Pct: 60, // max top-10 holder concentration
    excludeHighSupplyConcentration: true,
    timeframe: "30m",
    category: "trending",
  }),

  // ─── Position sizing & limits ───
  sizing: Object.freeze({
    maxPositions: 3,
    maxDeployAmount: 50, // ceil SOL per position
    deployAmountSol: 0.5, // floor SOL per position
    gasReserve: 0.2,
    positionSizePct: 0.35, // fraction of deployable balance per position
    minSolToOpen: 0.55,
  }),

  // ─── Exit / management rules ───
  exit: Object.freeze({
    stopLossPct: -50,
    takeProfitPct: 5,
    trailingTakeProfit: true,
    trailingTriggerPct: 3, // arm trailing at +X% PnL
    trailingDropPct: 1.5, // close on X% drop from peak
    outOfRangeWaitMinutes: 30,
    outOfRangeBinsToClose: 10,
    minFeePerTvl24h: 7, // low-yield close floor
    minAgeBeforeYieldCheck: 60, // minutes grace before low-yield can fire
    minClaimAmount: 5, // unclaimed fees USD to trigger claim
  }),

  // ─── Bin/range placement & shape ───
  range: Object.freeze({
    strategy: "bid_ask", // spot | curve | bid_ask
    minBinsBelow: 35,
    maxBinsBelow: 69,
    defaultBinsBelow: 69,
    minSafeBinsBelow: 35, // absolute floor; deploys with fewer total bins are refused
  }),

  // ─── Candidate ranking weights (scoreCandidate) ───
  scoring: Object.freeze({
    feeTvlWeight: 1000,
    organicWeight: 10,
    volumeDivisor: 100,
    holdersDivisor: 100,
  }),
});
