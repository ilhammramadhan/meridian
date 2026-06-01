/**
 * brain.js — Meridian's "brain": a Karpathy-style LLM-wiki of learned knowledge.
 *
 * Three layers (Karpathy): raw sources (the JSON state files — source of record) →
 * interlinked markdown wiki (this brain/ dir — derived, rebuildable) → schema (this file
 * + CLAUDE.md). Three ops: INGEST (fold a new event into pages + log), QUERY (retrieve
 * bounded, role-aware knowledge to inject into a decision), LINT (scan for staleness /
 * dead links / orphans). Navigation via index.md + log.md.
 *
 * This module is DETERMINISTIC and dependency-free. It writes/refreshes a deterministic
 * `## Summary` for every page so QUERY always has something to inject. LLM-written
 * summaries + contradiction adjudication are layered on in M2 (prompt-brain.js) and only
 * REPLACE the `## Summary` body — never the structured frontmatter this module owns.
 *
 * The brain holds learned/episodic KNOWLEDGE, never strategy gates. Thresholds live in
 * strategy.js. Knowledge informs the LLM's bounded judgment within those gates.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "node:child_process";
import { log } from "./logger.js";
import { isPaper } from "./paper.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRAIN_DIR = path.join(__dirname, "brain");
const INDEX_PATH = path.join(BRAIN_DIR, "index.md");
const LOG_PATH = path.join(BRAIN_DIR, "log.md");
const LOG_MAX_LINES = 500;
const UNTRUSTED_MARKER = "<!-- UNTRUSTED -->";

// page type → subdirectory under brain/
const TYPE_DIR = {
  pool: "pools",
  token: "tokens",
  deployer: "deployers",
  strategy: "strategies",
  lesson: "lessons",
  signal: "",
};

// role → which page types are most relevant, in priority order
const ROLE_TYPES = {
  SCREENER: ["pool", "token", "deployer", "lesson", "signal"],
  MANAGER: ["pool", "lesson"],
  GENERAL: ["pool", "token", "lesson", "signal", "strategy"],
};

const DEFAULT_BUDGET = { SCREENER: 1200, MANAGER: 800, GENERAL: 1500 };
const STALE_DAYS = 30;

// ─────────────────────────── fs + path helpers ───────────────────────────

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** Sanitize an id (pool/mint/wallet address or slug) into a safe filename stem. */
export function slug(id) {
  return String(id || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80) || "unknown";
}

function pagePath(type, id) {
  const sub = TYPE_DIR[type];
  if (sub === undefined) return null;
  if (type === "signal") return path.join(BRAIN_DIR, "signals.md");
  return path.join(BRAIN_DIR, sub, `${slug(id)}.md`);
}

/** A stable wiki reference like "pools/<slug>" used in [[links]] and the CLI. */
export function refOf(type, id) {
  if (type === "signal") return "signals";
  return `${TYPE_DIR[type]}/${slug(id)}`;
}

function pathFromRef(ref) {
  const clean = String(ref || "").replace(/\.md$/, "").replace(/\.\./g, "").replace(/^\/+/, "");
  if (clean === "signals" || clean === "index" || clean === "log") {
    return path.join(BRAIN_DIR, `${clean}.md`);
  }
  return path.join(BRAIN_DIR, `${clean}.md`);
}

// ─────────────────────────── frontmatter (minimal, dependency-free) ───────────────────────────
// Each line is `key: <value>`. Values round-trip through JSON.parse when possible
// (numbers, booleans, arrays, objects); otherwise they are treated as raw strings.

function serializeValue(v) {
  if (typeof v === "string") {
    // keep simple strings bare; quote only when JSON.parse would misread them
    if (v === "" || /^[\[{]/.test(v) || /^-?\d/.test(v) || v === "true" || v === "false" || v === "null") {
      return JSON.stringify(v);
    }
    return v;
  }
  return JSON.stringify(v);
}

function parseValue(raw) {
  const t = raw.trim();
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

function serializeFrontmatter(fm) {
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${serializeValue(v)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

function splitPage(md) {
  if (!md.startsWith("---")) return { fm: {}, body: md };
  const end = md.indexOf("\n---", 3);
  if (end === -1) return { fm: {}, body: md };
  const fmBlock = md.slice(md.indexOf("\n", 0) + 1, end).trim();
  const body = md.slice(md.indexOf("\n", end + 1) + 1);
  const fm = {};
  for (const line of fmBlock.split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    fm[line.slice(0, i).trim()] = parseValue(line.slice(i + 1));
  }
  return { fm, body };
}

// ─────────────────────────── section helpers ───────────────────────────

/** Extract the text under a `## <name>` heading (until the next `## ` or EOF). */
function getSection(body, name) {
  const re = new RegExp(`(^|\\n)##\\s+${name}\\s*\\n`, "i");
  const m = body.match(re);
  if (!m) return "";
  const start = m.index + m[0].length;
  const rest = body.slice(start);
  const next = rest.search(/\n##\s+/);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function setSection(body, name, text) {
  const re = new RegExp(`(^|\\n)(##\\s+${name}\\s*\\n)([\\s\\S]*?)(?=\\n##\\s+|$)`, "i");
  if (re.test(body)) {
    return body.replace(re, `$1$2${text}\n`);
  }
  const sep = body.trim() ? "\n\n" : "";
  return `${body.trimEnd()}${sep}## ${name}\n${text}\n`;
}

// ─────────────────────────── log ───────────────────────────

function appendLog(message) {
  ensureDir(BRAIN_DIR);
  const ts = new Date().toISOString();
  const entry = `- ${ts} — ${message}`;
  let existing = "";
  if (fs.existsSync(LOG_PATH)) existing = fs.readFileSync(LOG_PATH, "utf8");
  const lines = existing.split("\n").filter((l) => l.startsWith("- "));
  lines.unshift(entry); // newest first
  const header = "# Brain Log\n\nChronological ledger of ingest / query / lint events (newest first).\n\n";
  fs.writeFileSync(LOG_PATH, header + lines.slice(0, LOG_MAX_LINES).join("\n") + "\n");
}

// ─────────────────────────── ingest idempotency ledger ───────────────────────────
// A small append-only set of close keys we've already folded in, so a retried or
// replayed close (same position@closed_at) is never double-counted into the stats.

const INGESTED_PATH = path.join(BRAIN_DIR, ".ingested.json");
const INGESTED_MAX = 5000;

function readIngestedKeys() {
  try {
    if (!fs.existsSync(INGESTED_PATH)) return [];
    const v = JSON.parse(fs.readFileSync(INGESTED_PATH, "utf8"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function closeAlreadyIngested(key) {
  return readIngestedKeys().includes(key);
}

function markCloseIngested(key) {
  try {
    ensureDir(BRAIN_DIR);
    const keys = readIngestedKeys();
    if (keys.includes(key)) return;
    keys.push(key);
    fs.writeFileSync(INGESTED_PATH, JSON.stringify(keys.slice(-INGESTED_MAX)));
  } catch { /* best-effort: dedupe is an optimization, never block the ingest */ }
}

/** isPaper() but never throws (paper.js reads config/env). */
function isPaperSafe() {
  try { return isPaper() === true; } catch { return false; }
}

// ─────────────────────────── page read/write ───────────────────────────

function readPageFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

function writePageFile(filePath, fm, body) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, serializeFrontmatter(fm) + "\n" + body.replace(/^\n+/, ""));
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function round(n, dp = 1) {
  const f = 10 ** dp;
  return Math.round(num(n) * f) / f;
}

// ─────────────────────────── deterministic summaries ───────────────────────────

function poolSummary(fm) {
  const parts = [];
  parts.push(`${num(fm.deploys)} deploy(s)`);
  if (fm.win_rate != null) parts.push(`${round(fm.win_rate)}% win rate`);
  if (fm.avg_pnl_pct != null) parts.push(`avg PnL ${round(fm.avg_pnl_pct)}%`);
  if (fm.avg_fee_yield_pct != null) parts.push(`avg fee yield ${round(fm.avg_fee_yield_pct)}%`);
  let s = parts.join(", ") + ".";
  if (fm.status && fm.status !== "active") s += ` Status: ${fm.status}.`;
  if (fm.last_outcome) s += ` Last close: ${fm.last_outcome}.`;
  if (fm.cooldown_until) s += ` On cooldown until ${fm.cooldown_until}.`;
  if (fm.paper) s += " (paper/simulated data).";
  return s;
}

function tokenSummary(fm) {
  const parts = [];
  if (fm.deploys != null) parts.push(`${num(fm.deploys)} deploy(s) across pools`);
  if (fm.win_rate != null) parts.push(`${round(fm.win_rate)}% win rate`);
  if (fm.avg_pnl_pct != null) parts.push(`avg PnL ${round(fm.avg_pnl_pct)}%`);
  let s = (parts.join(", ") || "No closed deploys yet") + ".";
  if (fm.paper) s += " (paper/simulated data).";
  return s;
}

function strategySummary(fm) {
  const parts = [];
  if (fm.deploys != null) parts.push(`${num(fm.deploys)} close(s)`);
  if (fm.win_rate != null) parts.push(`${round(fm.win_rate)}% win rate`);
  if (fm.avg_pnl_pct != null) parts.push(`avg PnL ${round(fm.avg_pnl_pct)}%`);
  return (parts.join(", ") || "No data") + ".";
}

// ─────────────────────────── INGEST ───────────────────────────

/**
 * Fold one event into the wiki. Deterministic + fire-and-forget safe.
 * event = { kind, pool, mint, deployer, strategy, payload, raw_ref }
 *   kind ∈ "close" | "decision" | "snapshot" | "manual_lesson" | "weights"
 */
export async function ingest(event = {}) {
  try {
    ensureDir(BRAIN_DIR);
    const { kind } = event;
    if (kind === "close") return ingestClose(event);
    if (kind === "decision") return ingestDecision(event);
    if (kind === "snapshot") return ingestSnapshot(event);
    if (kind === "manual_lesson") return ingestLesson(event);
    if (kind === "weights") return ingestWeights(event);
  } catch (e) {
    try { log("brain_warn", `ingest failed: ${e.message}`); } catch { /* noop */ }
  }
}

function loadOrInitPage(type, id, extraFm = {}) {
  const filePath = pagePath(type, id);
  const raw = readPageFile(filePath);
  if (raw) {
    const { fm, body } = splitPage(raw);
    return { filePath, fm: { ...fm, ...extraFm }, body };
  }
  return {
    filePath,
    fm: { type, id, ...extraFm },
    body: "## Summary\n\n## What worked / failed\n\n## Cautions\n\n## Links\n",
  };
}

function aggregateFromDeploy(fm, d) {
  const deploys = num(fm.deploys) + 1;
  const wins = num(fm._wins) + (num(d.pnl_pct) > 0 ? 1 : 0);
  const pnlSum = num(fm._pnl_sum) + num(d.pnl_pct);
  fm.deploys = deploys;
  fm._wins = wins;
  fm._pnl_sum = round(pnlSum, 2);
  fm.win_rate = round((wins / deploys) * 100, 1);
  fm.avg_pnl_pct = round(pnlSum / deploys, 2);

  // §4.4 zero-fee guard: only fold a fee-yield observation into the learned
  // fee-edge when the ratio is a real, non-zero number. A 0/blank fee yield /
  // fee_active_tvl is a windowed-metric artifact (e.g. the close landed outside
  // the API window) — folding it in would drag avg_fee_yield_pct toward 0 and
  // make the screener penalize a pool for an artifact, so we skip those.
  const feeYield = feeYieldOf(d);
  if (feeYield != null) {
    const feeN = num(fm._fee_yield_n) + 1;
    const feeSum = num(fm._fee_yield_sum) + feeYield;
    fm._fee_yield_n = feeN;
    fm._fee_yield_sum = round(feeSum, 4);
    fm.avg_fee_yield_pct = round(feeSum / feeN, 2);
  }
  return fm;
}

/**
 * Extract a usable fee-yield (%) observation from a close payload, or null when
 * the value is the zero/blank windowed-metric artifact that must NOT be learned.
 * Prefers an explicit realized fee yield (fees_earned / initial_value) and falls
 * back to the pool's fee_tvl_ratio. Returns null for 0, blank, or non-finite.
 */
function feeYieldOf(d) {
  if (!d || typeof d !== "object") return null;
  let yield_;
  if (Number.isFinite(Number(d.fee_earned_pct))) {
    yield_ = Number(d.fee_earned_pct);
  } else if (Number.isFinite(Number(d.initial_value_usd)) && Number(d.initial_value_usd) > 0
    && Number.isFinite(Number(d.fees_earned_usd))) {
    yield_ = (Number(d.fees_earned_usd) / Number(d.initial_value_usd)) * 100;
  } else if (d.fee_tvl_ratio != null && d.fee_tvl_ratio !== "" && Number.isFinite(Number(d.fee_tvl_ratio))) {
    yield_ = Number(d.fee_tvl_ratio);
  } else {
    return null;
  }
  // skip the zero/blank artifact (no fee edge learned from a windowed zero)
  if (!Number.isFinite(yield_) || yield_ === 0) return null;
  return yield_;
}

/**
 * Stable idempotency key for a close. A close is uniquely identified by its
 * position + the moment it was closed (closed_at / recorded_at). raw_ref alone
 * is shared across closes (e.g. "lessons.json"), so it can't dedupe on its own.
 */
function closeKey({ pool, payload = {}, raw_ref }) {
  const closedAt = payload.closed_at || payload.recorded_at || "";
  const id = payload.position || pool || "";
  if (id || closedAt) return `${id}@${closedAt}`;
  return raw_ref ? `ref:${raw_ref}` : "";
}

function ingestClose({ pool, mint, strategy, payload = {}, raw_ref }) {
  const ts = new Date().toISOString();
  const pnl = num(payload.pnl_pct);
  const outcome = pnl > 0 ? "profit" : "loss";

  // §4.4 idempotency: never double-count the same close (e.g. a retried ingest
  // or a replayed lessons.json). Guard on a stable position@closed_at key.
  const key = closeKey({ pool, payload, raw_ref });
  if (key) {
    if (closeAlreadyIngested(key)) {
      appendLog(`INGEST close (skipped duplicate) · ${payload.pool_name || pool || "?"} · ${key}`);
      return;
    }
    markCloseIngested(key);
  }

  // §4.4 tag paper data: a paper (simulated) close must stay distinguishable
  // from a live one so the screener never treats simulated knowledge as live.
  const paper = payload.paper === true || isPaperSafe();

  // pool page
  if (pool) {
    const p = loadOrInitPage("pool", pool, {
      name: payload.pool_name || pool,
      base_mint: mint || payload.base_mint || null,
    });
    aggregateFromDeploy(p.fm, payload);
    p.fm.last_outcome = outcome;
    p.fm.updated_at = ts;
    if (paper) p.fm.paper = true;
    if (raw_ref) p.fm.source_refs = uniq([...(arr(p.fm.source_refs)), raw_ref]);
    p.body = setSection(p.body, "Summary", poolSummary(p.fm));
    const line = `- ${ts}: closed ${outcome} ${round(pnl, 2)}% via ${strategy || payload.strategy || "?"} (${payload.close_reason || "n/a"})${paper ? " [paper]" : ""}`;
    p.body = setSection(p.body, "What worked / failed", appendBullet(getSection(p.body, "What worked / failed"), line));
    if (mint) p.body = setSection(p.body, "Links", linkLine([refOf("token", mint)]));
    p.fm.needs_summary = true; // M2 LLM resummary picks this up; deterministic Summary is set meanwhile
    writePageFile(p.filePath, p.fm, p.body);
  }

  // token page
  if (mint) {
    const t = loadOrInitPage("token", mint, { name: payload.base_symbol || payload.pool_name || mint });
    aggregateFromDeploy(t.fm, payload);
    t.fm.updated_at = ts;
    if (paper) t.fm.paper = true;
    t.body = setSection(t.body, "Summary", tokenSummary(t.fm));
    if (pool) t.body = setSection(t.body, "Links", linkLine([refOf("pool", pool)]));
    writePageFile(t.filePath, t.fm, t.body);
  }

  // strategy page
  const sid = strategy || payload.strategy;
  if (sid) {
    const st = loadOrInitPage("strategy", sid, { name: sid });
    aggregateFromDeploy(st.fm, payload);
    st.fm.updated_at = ts;
    if (paper) st.fm.paper = true;
    st.body = setSection(st.body, "Summary", strategySummary(st.fm));
    writePageFile(st.filePath, st.fm, st.body);
  }

  appendLog(`INGEST close · ${payload.pool_name || pool || "?"} · ${outcome} ${round(pnl, 2)}%${paper ? " [paper]" : ""}`);
}

function ingestDecision({ pool, payload = {}, raw_ref }) {
  const ts = new Date().toISOString();
  const type = payload.type || "decision";
  if (pool) {
    const p = loadOrInitPage("pool", pool, { name: payload.pool_name || pool });
    p.fm.updated_at = ts;
    if (raw_ref) p.fm.source_refs = uniq([...(arr(p.fm.source_refs)), raw_ref]);
    const detail = sanitizeInline(payload.summary || payload.reason || "");
    const line = `- ${ts}: ${type.toUpperCase()}${detail ? " — " + detail : ""}`;
    p.body = setSection(p.body, "What worked / failed", appendBullet(getSection(p.body, "What worked / failed"), line));
    if (!getSection(p.body, "Summary")) p.body = setSection(p.body, "Summary", poolSummary(p.fm));
    writePageFile(p.filePath, p.fm, p.body);
  }
  appendLog(`INGEST decision · ${type} · ${sanitizeInline(payload.pool_name || pool || "no-pool")}`);
}

function ingestSnapshot({ pool, payload = {} }) {
  // Deterministic, frequent, NO LLM. Just refresh a live-snapshot line + timestamp.
  if (!pool) return;
  const p = loadOrInitPage("pool", pool, {});
  p.fm.updated_at = new Date().toISOString();
  p.fm.last_snapshot = {
    pnl_pct: num(payload.pnl_pct),
    in_range: payload.in_range ?? null,
    unclaimed_fees_usd: num(payload.unclaimed_fees_usd),
  };
  writePageFile(p.filePath, p.fm, p.body);
}

function ingestLesson({ payload = {} }) {
  const ts = new Date().toISOString();
  const topic = topicForLesson(payload);
  const l = loadOrInitPage("lesson", topic, { name: topic, type: "lesson" });
  l.fm.updated_at = ts;
  l.fm.count = num(l.fm.count) + 1;
  const rule = sanitizeInline(payload.rule || payload.text || "");
  if (rule) {
    l.body = setSection(l.body, "Summary", `Lessons clustered under "${topic}".`);
    l.body = setSection(l.body, "What worked / failed", appendBullet(getSection(l.body, "What worked / failed"), `- ${rule}`));
  }
  writePageFile(l.filePath, l.fm, l.body);
  appendLog(`INGEST lesson · ${topic}`);
}

function ingestWeights({ payload = {} }) {
  const ts = new Date().toISOString();
  const filePath = pagePath("signal");
  const raw = readPageFile(filePath);
  const { fm, body } = raw ? splitPage(raw) : { fm: { type: "signal", id: "signals", name: "Signal weights" }, body: "## Summary\n\n## Links\n" };
  fm.updated_at = ts;
  fm.weights = payload.weights || fm.weights || {};
  const top = Object.entries(fm.weights).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, v]) => `${k} ${round(v, 2)}`).join(", ");
  const nb = setSection(body, "Summary", `Darwin signal weights (1.0 = neutral). Strongest: ${top || "all neutral"}.`);
  writePageFile(filePath, fm, nb);
  appendLog(`INGEST weights · ${top}`);
}

// ─────────────────────────── QUERY ───────────────────────────

/**
 * Retrieve bounded, role-aware knowledge for a decision. Deterministic.
 * Returns { markdown, citations, truncated }. Trusted-body only (Summaries);
 * the quarantined UNTRUSTED block is never injected here.
 */
export function query({ role = "GENERAL", pool, mint, deployer, tokenBudget } = {}) {
  const budget = tokenBudget || DEFAULT_BUDGET[role] || 1000;
  const picks = [];

  // Targeted pages first (the specific pool/token/deployer this decision is about)
  if (pool) pushPick(picks, "pool", pool);
  if (mint) pushPick(picks, "token", mint);
  if (deployer) pushPick(picks, "deployer", deployer);

  // Then general role-relevant pages (lessons, signals, top pools)
  for (const type of ROLE_TYPES[role] || ROLE_TYPES.GENERAL) {
    if (type === "signal") { pushPick(picks, "signal"); continue; }
    for (const ref of listRefs(type)) {
      if (picks.length > 40) break;
      pushPickByRef(picks, ref);
    }
  }

  // Greedy fill within budget
  const seen = new Set();
  const blocks = [];
  const citations = [];
  let used = 0;
  let truncated = false;
  for (const pick of picks) {
    if (!pick || seen.has(pick.ref)) continue;
    seen.add(pick.ref);
    const summary = getSection(pick.body, "Summary");
    if (!summary) continue;
    const block = `### ${pick.fm.name || pick.ref} (${pick.ref})\n${summary}`;
    const cost = Math.ceil(block.length / 4);
    if (used + cost > budget) { truncated = true; continue; }
    blocks.push(block);
    citations.push(pick.ref);
    used += cost;
  }

  return { markdown: blocks.join("\n\n"), citations, truncated };
}

function pushPick(picks, type, id) {
  const filePath = pagePath(type, id);
  const raw = readPageFile(filePath);
  if (!raw) return;
  const { fm, body } = splitPage(raw);
  picks.push({ ref: refOf(type, id), fm, body });
}

function pushPickByRef(picks, ref) {
  const raw = readPageFile(pathFromRef(ref));
  if (!raw) return;
  const { fm, body } = splitPage(raw);
  picks.push({ ref, fm, body });
}

// ─────────────────────────── LINT ───────────────────────────

export async function lint() {
  const report = { pages: 0, orphans: [], dead_links: [], stale: [], untrusted_leaks: [] };
  const all = listAllRefs();
  const refSet = new Set(all);
  const inbound = new Set();
  const now = Date.now();

  for (const ref of all) {
    const raw = readPageFile(pathFromRef(ref));
    if (!raw) continue;
    report.pages++;
    const { fm, body } = splitPage(raw);

    // dead links + record inbound
    for (const m of body.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const target = m[1].trim();
      inbound.add(target);
      if (!refSet.has(target)) report.dead_links.push({ ref, target });
    }

    // stale
    if (fm.updated_at) {
      const age = (now - Date.parse(fm.updated_at)) / 86400000;
      if (Number.isFinite(age) && age > STALE_DAYS) report.stale.push({ ref, days: Math.round(age) });
    }

    // untrusted leak: an UNTRUSTED block should never appear inside Summary
    const summary = getSection(body, "Summary");
    if (summary.includes(UNTRUSTED_MARKER) || /ignore (all )?previous|system prompt/i.test(summary)) {
      report.untrusted_leaks.push(ref);
    }
  }

  for (const ref of all) {
    if (ref === "index" || ref === "log" || ref === "signals") continue;
    if (!inbound.has(ref)) report.orphans.push(ref);
  }

  appendLog(`LINT · ${report.pages} pages · ${report.dead_links.length} dead links · ${report.stale.length} stale · ${report.orphans.length} orphans`);
  return report;
}

// ─────────────────────────── dashboard / curate helpers ───────────────────────────

export function listPages({ type } = {}) {
  const refs = type ? listRefs(type) : listAllRefs();
  return refs.map((ref) => {
    const fp = pathFromRef(ref);
    const raw = readPageFile(fp);
    const { fm } = raw ? splitPage(raw) : { fm: {} };
    let mtime = null;
    try { mtime = fs.statSync(fp).mtime.toISOString(); } catch { /* noop */ }
    return { ref, title: fm.name || ref, type: fm.type || refType(ref), updated_at: fm.updated_at || mtime };
  });
}

export function getPage(ref) {
  const raw = readPageFile(pathFromRef(ref));
  if (!raw) return null;
  return { ref, markdown: raw, ...splitPage(raw) };
}

export function curate({ ref, section = "Summary", text, pin } = {}) {
  const fp = pathFromRef(ref);
  const raw = readPageFile(fp);
  if (!raw) throw new Error(`brain page not found: ${ref}`);
  const { fm, body } = splitPage(raw);
  fm.updated_at = new Date().toISOString();
  fm.curated = true;
  if (pin != null) fm.pinned = !!pin;
  const newBody = text != null ? setSection(body, section, text) : body;
  writePageFile(fp, fm, newBody);
  appendLog(`CURATE · ${ref} · ${section}`);
  return { ref, ok: true };
}

// ─────────────────────────── REBUILD (backfill from raw JSON) ───────────────────────────

export async function rebuild() {
  // Wipe derived pages; JSON files stay the source of record.
  if (fs.existsSync(BRAIN_DIR)) fs.rmSync(BRAIN_DIR, { recursive: true, force: true });
  ensureDir(BRAIN_DIR);

  const counts = { pools: 0, tokens: 0, strategies: 0, lessons: 0, signals: 0 };
  const poolMem = readSourceJson("pool-memory.json", {});
  const lessonsData = readSourceJson("lessons.json", { lessons: [], performance: [] });
  const weights = readSourceJson("signal-weights.json", {});

  // pools + token/strategy aggregates from pool-memory
  const tokenAgg = {};
  const stratAgg = {};
  for (const [addr, m] of Object.entries(poolMem)) {
    if (!m || typeof m !== "object" || !Array.isArray(m.deploys)) continue;
    const fm = {
      type: "pool", id: addr, name: m.name || addr, base_mint: m.base_mint || null,
      deploys: num(m.total_deploys, m.deploys.length),
      win_rate: round(m.win_rate, 1), avg_pnl_pct: round(m.avg_pnl_pct, 2),
      last_outcome: m.last_outcome || null,
      status: m.cooldown_until ? "cooldown" : "active",
      cooldown_until: m.cooldown_until || null,
      updated_at: m.last_deployed_at || new Date().toISOString(),
      source_refs: [`pool-memory.json#${addr}`],
    };
    let body = "## Summary\n" + poolSummary(fm) + "\n\n## What worked / failed\n";
    for (const d of m.deploys.slice(-8)) {
      body += `- ${d.closed_at || d.deployed_at || "?"}: ${num(d.pnl_pct) > 0 ? "profit" : "loss"} ${round(d.pnl_pct, 2)}% via ${d.strategy || "?"} (${d.close_reason || "n/a"})\n`;
    }
    body += "\n## Cautions\n";
    for (const n of arr(m.notes)) body += `- ${sanitizeInline(n.note || n)}\n`;
    body += "\n## Links\n" + (m.base_mint ? linkLine([refOf("token", m.base_mint)]) : "");
    writePageFile(pagePath("pool", addr), fm, body);
    counts.pools++;

    // aggregate token + strategy
    if (m.base_mint) accumulate(tokenAgg, m.base_mint, m, addr);
    for (const d of m.deploys) if (d.strategy) accumulateStrategy(stratAgg, d.strategy, d);
  }

  for (const [mint, agg] of Object.entries(tokenAgg)) {
    const fm = {
      type: "token", id: mint, name: agg.name || mint, deploys: agg.deploys,
      win_rate: round((agg.wins / agg.deploys) * 100, 1), avg_pnl_pct: round(agg.pnlSum / agg.deploys, 2),
      updated_at: new Date().toISOString(), source_refs: ["pool-memory.json"],
    };
    const body = "## Summary\n" + tokenSummary(fm) + "\n\n## What worked / failed\n\n## Cautions\n\n## Links\n" + linkLine(agg.pools.map((p) => refOf("pool", p)));
    writePageFile(pagePath("token", mint), fm, body);
    counts.tokens++;
  }

  for (const [sid, agg] of Object.entries(stratAgg)) {
    const fm = {
      type: "strategy", id: sid, name: sid, deploys: agg.deploys,
      win_rate: round((agg.wins / agg.deploys) * 100, 1), avg_pnl_pct: round(agg.pnlSum / agg.deploys, 2),
      updated_at: new Date().toISOString(), source_refs: ["pool-memory.json"],
    };
    writePageFile(pagePath("strategy", sid), fm, "## Summary\n" + strategySummary(fm) + "\n\n## Links\n");
    counts.strategies++;
  }

  // lessons clustered by topic
  const byTopic = {};
  for (const l of arr(lessonsData.lessons)) {
    const topic = topicForLesson(l);
    (byTopic[topic] ||= []).push(l);
  }
  for (const [topic, ls] of Object.entries(byTopic)) {
    const fm = { type: "lesson", id: topic, name: topic, count: ls.length, updated_at: new Date().toISOString(), source_refs: ["lessons.json"] };
    let body = `## Summary\nLessons clustered under "${topic}" (${ls.length}).\n\n## What worked / failed\n`;
    for (const l of ls.slice(-20)) body += `- ${sanitizeInline(l.rule || "")}${l.pinned ? " (pinned)" : ""}\n`;
    body += "\n## Links\n";
    writePageFile(pagePath("lesson", topic), fm, body);
    counts.lessons++;
  }

  // signals page
  if (weights.weights) {
    ingestWeights({ payload: { weights: weights.weights } });
    counts.signals = 1;
  }

  writeIndex();
  appendLog(`REBUILD · ${counts.pools} pools · ${counts.tokens} tokens · ${counts.strategies} strategies · ${counts.lessons} lesson-topics`);
  return counts;
}

function writeIndex() {
  const groups = [
    ["Pools", listRefs("pool")],
    ["Tokens", listRefs("token")],
    ["Deployers", listRefs("deployer")],
    ["Strategies", listRefs("strategy")],
    ["Lessons", listRefs("lesson")],
  ];
  let md = "# Meridian Brain — Index\n\n";
  md += `Knowledge wiki maintained by ingest/query/lint. Updated ${new Date().toISOString()}.\n\n`;
  md += `- [[signals]] — Darwin signal weights\n- [[log]] — event ledger\n\n`;
  for (const [title, refs] of groups) {
    if (!refs.length) continue;
    md += `## ${title} (${refs.length})\n`;
    for (const ref of refs.slice(0, 200)) {
      const { fm } = splitPage(readPageFile(pathFromRef(ref)) || "");
      md += `- [[${ref}]] ${fm.name && fm.name !== ref ? "— " + fm.name : ""}\n`;
    }
    md += "\n";
  }
  ensureDir(BRAIN_DIR);
  fs.writeFileSync(INDEX_PATH, md);
}

// ─────────────────────────── small utils ───────────────────────────

function arr(v) { return Array.isArray(v) ? v : []; }
function uniq(a) { return [...new Set(a)]; }

function appendBullet(section, line, max = 12) {
  const lines = section.split("\n").filter((l) => l.trim().startsWith("-"));
  lines.push(line.startsWith("-") ? line : `- ${line}`);
  return lines.slice(-max).join("\n");
}

function linkLine(refs) {
  const uniqRefs = uniq(refs.filter(Boolean));
  return uniqRefs.map((r) => `[[${r}]]`).join(" · ");
}

/** Strip newlines/control chars and cap length so ingested text can't break the page. */
function sanitizeInline(text, max = 200) {
  return String(text || "").replace(/[\r\n]+/g, " ").replace(/[<>]/g, "").trim().slice(0, max);
}

function topicForLesson(l) {
  const tags = arr(l.tags);
  if (tags.includes("oor")) return "oor";
  if (tags.includes("efficiency")) return "range-efficiency";
  if (tags.some((t) => String(t).startsWith("volatility"))) return "volatility";
  if (tags.includes("evolution") || tags.includes("config_change")) return "evolution";
  if (tags.includes("bundler") || tags.includes("bots")) return "bundler";
  if (tags.includes("narrative")) return "narrative";
  return tags[0] || "general";
}

function accumulate(agg, mint, m, poolAddr) {
  const a = (agg[mint] ||= { deploys: 0, wins: 0, pnlSum: 0, pools: [], name: m.name });
  for (const d of arr(m.deploys)) {
    a.deploys++;
    if (num(d.pnl_pct) > 0) a.wins++;
    a.pnlSum += num(d.pnl_pct);
  }
  if (poolAddr) a.pools.push(poolAddr);
}

function accumulateStrategy(agg, sid, d) {
  const a = (agg[sid] ||= { deploys: 0, wins: 0, pnlSum: 0 });
  a.deploys++;
  if (num(d.pnl_pct) > 0) a.wins++;
  a.pnlSum += num(d.pnl_pct);
}

function listRefs(type) {
  const sub = TYPE_DIR[type];
  if (type === "signal") return fs.existsSync(pagePath("signal")) ? ["signals"] : [];
  const dir = path.join(BRAIN_DIR, sub);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => `${sub}/${f.replace(/\.md$/, "")}`);
}

function listAllRefs() {
  const refs = [];
  for (const type of ["pool", "token", "deployer", "strategy", "lesson"]) refs.push(...listRefs(type));
  if (fs.existsSync(pagePath("signal"))) refs.push("signals");
  return refs;
}

function refType(ref) {
  const sub = ref.split("/")[0];
  return Object.keys(TYPE_DIR).find((k) => TYPE_DIR[k] === sub) || (ref === "signals" ? "signal" : "unknown");
}

function readSourceJson(name, fallback) {
  for (const base of [process.cwd(), __dirname]) {
    const fp = path.join(base, name);
    if (fs.existsSync(fp)) {
      try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch { /* try next */ }
    }
  }
  return fallback;
}

// ─────────────────────────── LLM resummary (via local Claude session) ───────────────────────────

/**
 * Rewrite the `## Summary` of pages flagged needs_summary using the local Claude session
 * (claude -p, no API key). Batched into ONE spawn. Best-effort: any failure is a no-op.
 */
export async function resummarize({ max = 12 } = {}) {
  const dirty = listAllRefs()
    .map((ref) => ({ ref, page: getPage(ref) }))
    .filter((x) => x.page && x.page.fm && x.page.fm.needs_summary && !x.page.fm.curated)
    .slice(0, max)
    .map((x) => ({ ref: x.ref, fm: x.page.fm, body: x.page.body }));
  if (!dirty.length) return { resummarized: 0, pages: [] };

  const { resummaryPrompt } = await import("./prompt-brain.js");
  const map = await runClaudeJson(resummaryPrompt(dirty));
  if (!map || typeof map !== "object") return { resummarized: 0, pages: [], error: "no LLM result" };

  const done = [];
  for (const p of dirty) {
    const summary = map[p.ref];
    if (typeof summary !== "string" || !summary.trim()) continue;
    const fp = pathFromRef(p.ref);
    const raw = readPageFile(fp);
    if (!raw) continue;
    const { fm, body } = splitPage(raw);
    fm.needs_summary = false;
    fm.updated_at = new Date().toISOString();
    writePageFile(fp, fm, setSection(body, "Summary", sanitizeInline(summary, 600)));
    done.push(p.ref);
  }
  appendLog(`RESUMMARIZE · ${done.length} page(s) via Claude session`);
  return { resummarized: done.length, pages: done };
}

function stripFences(s) {
  return String(s).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function runClaudeJson(prompt) {
  return new Promise((resolve) => {
    const bin = process.env.CLAUDE_BIN || "claude";
    const model = process.env.CLAUDE_MODEL || "sonnet";
    const env = { ...process.env };
    if (!env.ANTHROPIC_BASE_URL) delete env.ANTHROPIC_API_KEY; // inherit `claude login`
    let child;
    try {
      child = spawn(bin, ["-p", "--output-format", "json", "--model", model, "--permission-mode", "default"],
        { cwd: __dirname, env, stdio: ["pipe", "pipe", "pipe"] });
    } catch { return resolve(null); }
    let out = "";
    child.stdout.on("data", (b) => { out += b.toString(); });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      try {
        const env2 = JSON.parse(out);
        const text = typeof env2.result === "string" ? env2.result : out;
        resolve(JSON.parse(stripFences(text)));
      } catch { resolve(null); }
    });
    try { child.stdin.write(prompt); child.stdin.end(); } catch { resolve(null); }
  });
}
