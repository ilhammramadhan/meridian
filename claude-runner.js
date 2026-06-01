#!/usr/bin/env node
/**
 * claude-runner.js — Headless Claude-session driver for Meridian's autonomous cycles.
 *
 * Instead of the OpenRouter ReAct loop in agent.js, this spawns your locally
 * installed `claude` CLI (using your `claude login` session — no API key) and
 * lets Claude Code run the existing /screen and /manage cycle logic from
 * .claude/commands/, driving the meridian CLI. All deploy/close safety checks
 * still apply because every action goes through `node cli.js …` → tools/executor.js.
 *
 * Usage:
 *   node claude-runner.js screen        # run ONE screening cycle, then exit
 *   node claude-runner.js manage        # run ONE management cycle, then exit
 *   node claude-runner.js start         # cron loop: screen + manage on config intervals
 *   node claude-runner.js start --now   # also run both immediately on startup
 *
 * Env:
 *   CLAUDE_BIN              path to claude binary (else resolved from PATH)
 *   CLAUDE_MODEL           model alias/id (default "opus")
 *   CLAUDE_PERMISSION_MODE "default" (respects .claude/settings.json allow/deny — recommended)
 *                          or "bypassPermissions" (no guardrails). Default: "default".
 *   CLAUDE_CYCLE_TIMEOUT_MS max ms per cycle before SIGTERM (default 600000 = 10m)
 *   DRY_RUN=true           passed through to cli.js → skips all on-chain transactions
 *   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID   optional cycle-report notifications
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import cron from "node-cron";
import "./envcrypt.js"; // load meridian/.env into process.env BEFORE config reads it (PAPER_TRADING, DRY_RUN, wallet, RPC…)
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODEL = process.env.CLAUDE_MODEL || "opus";
const PERMISSION_MODE = process.env.CLAUDE_PERMISSION_MODE || "default";
const CYCLE_TIMEOUT_MS = Number(process.env.CLAUDE_CYCLE_TIMEOUT_MS) || 10 * 60 * 1000;

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}
function logLine(...a) {
  console.log(`[${ts()}]`, ...a);
}

function findClaude() {
  if (process.env.CLAUDE_BIN && existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const full = path.join(dir, "claude");
    if (full && existsSync(full)) return full;
  }
  for (const p of [
    path.join(process.env.HOME || "", ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ]) {
    if (existsSync(p)) return p;
  }
  throw new Error("claude CLI not found on PATH. Install `npm i -g @anthropic-ai/claude-code` and run `claude login`.");
}

// Read a project slash-command body and strip its YAML frontmatter.
function loadCommandBody(name) {
  let body = readFileSync(path.join(__dirname, ".claude", "commands", `${name}.md`), "utf8");
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) body = body.slice(body.indexOf("\n", end + 1) + 1);
  }
  return body.trim();
}

const PREAMBLE =
  "The working directory is the Meridian DLMM agent project. Use the meridian CLI " +
  "(`node cli.js …`) for all actions. To read files use the Read tool or " +
  "`node cli.js config get` — the shell `cat`/`wget` commands are blocked by policy. " +
  "Run commands sequentially, never in the background.";

const CYCLES = {
  screen: {
    label: "SCREENING",
    buildPrompt: () =>
      `You are running ONE autonomous screening cycle for Meridian. ${PREAMBLE}\n` +
      `When finished, end with a concise 3–5 line report: what you found, the decision, and ` +
      `— if you deployed — pool, amount, strategy, and tx.\n\n${loadCommandBody("screen")}`,
  },
  manage: {
    label: "MANAGEMENT",
    buildPrompt: () =>
      `You are running ONE autonomous management cycle for Meridian. ${PREAMBLE}\n` +
      `When finished, end with a concise report of each open position and the action taken.\n\n${loadCommandBody("manage")}`,
  },
};

function summarizeTool(block) {
  const i = block.input || {};
  if (block.name === "Bash" && i.command) {
    return i.command.length > 120 ? i.command.slice(0, 120) + "…" : i.command;
  }
  if (i.file_path) return i.file_path;
  return "";
}

function shortAddr(a) {
  return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

// Replace long base58 addresses in a logged command with short form + resolved token/pair name.
function annotateAddrs(text, nameMap) {
  return text.replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, (m) =>
    nameMap[m] ? `${shortAddr(m)}(${nameMap[m]})` : shortAddr(m),
  );
}

// Harvest pool/mint → name from a cli.js JSON tool result so later log lines show readable names.
function harvestNames(raw, nameMap) {
  const s = raw.indexOf("{");
  if (s < 0) return;
  let data;
  try {
    data = JSON.parse(raw.slice(s));
  } catch {
    return;
  }
  const add = (addr, name) => {
    if (addr && name && !nameMap[addr]) nameMap[addr] = String(name).slice(0, 22);
  };
  if (Array.isArray(data?.candidates)) {
    for (const c of data.candidates) {
      add(c.pool || c.pool_address, c.name);
      if (c.token) add(c.token.mint, c.token.symbol);
    }
  }
  if (data?.pool) add(data.pool, data.name);
  if (data?.base?.mint) add(data.base.mint, data.base.symbol);
  if (data?.mint) add(data.mint, data.symbol);
  if (Array.isArray(data?.results)) for (const r of data.results) add(r.mint || r.id, r.symbol);
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function notifyTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
}

// Count open positions from the registry (paper or live) without spawning anything.
function openPositionCount() {
  try {
    const paper = process.env.PAPER_TRADING === "true";
    const s = JSON.parse(readFileSync(path.join(__dirname, paper ? "paper-state.json" : "state.json"), "utf8"));
    const positions = s.positions || {};
    return paper
      ? Object.keys(positions).length
      : Object.values(positions).filter((p) => !p.closed).length;
  } catch {
    return 0; // no registry yet → nothing open
  }
}

function runCycle(kind) {
  return new Promise((resolve) => {
    const cyc = CYCLES[kind];
    // Don't waste a full LLM cycle managing an empty portfolio.
    if (kind === "manage" && openPositionCount() === 0) {
      logLine("⏭ MANAGEMENT cycle skipped — no open positions to manage.");
      return resolve({ report: "no open positions", code: 0, isError: false, cost: 0, turns: 0 });
    }
    const bin = findClaude();
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--model", MODEL,
      "--permission-mode", PERMISSION_MODE,
    ];

    // Inherit `claude login` — strip the API key unless a custom endpoint is set.
    const env = { ...process.env };
    if (!env.ANTHROPIC_BASE_URL) delete env.ANTHROPIC_API_KEY;

    const dry = String(env.DRY_RUN).toLowerCase() === "true";
    const paper = env.PAPER_TRADING === "true";
    const modeLabel = paper ? "PAPER" : dry ? "DRY_RUN" : "LIVE";
    logLine(`▶ ${cyc.label} cycle starting (model=${MODEL}, perm=${PERMISSION_MODE}, ${modeLabel})`);

    const child = spawn(bin, args, { cwd: __dirname, env, stdio: ["pipe", "pipe", "pipe"], shell: false });

    let finalText = "";
    const assistantText = [];
    const toolCalls = [];
    const nameMap = {}; // pool/mint address → readable name, harvested from tool results
    let cost = 0;
    let turns = 0;
    let isError = false;

    const killTimer = setTimeout(() => {
      logLine(`⚠ ${cyc.label} cycle exceeded ${Math.round(CYCLE_TIMEOUT_MS / 1000)}s — terminating`);
      child.kill("SIGTERM");
    }, CYCLE_TIMEOUT_MS);

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const t = line.trim();
      if (!t) return;
      let ev;
      try {
        ev = JSON.parse(t);
      } catch {
        return; // non-JSON CLI noise
      }
      if (ev.type === "system" && ev.subtype === "init") {
        logLine(`  session ${ev.session_id} · model ${ev.model}`);
      } else if (ev.type === "assistant") {
        for (const b of ev.message?.content ?? []) {
          if (b.type === "text" && b.text?.trim()) assistantText.push(b.text.trim());
          if (b.type === "tool_use") {
            toolCalls.push(b.name);
            const detail = annotateAddrs(summarizeTool(b), nameMap);
            logLine(`  ↳ ${b.name}${detail ? ": " + detail : ""}`);
          }
        }
      } else if (ev.type === "user") {
        for (const b of ev.message?.content ?? []) {
          if (b.type !== "tool_result") continue;
          const txt =
            typeof b.content === "string"
              ? b.content
              : Array.isArray(b.content)
                ? b.content.map((x) => x.text || "").join("")
                : "";
          if (txt) harvestNames(txt, nameMap);
        }
      } else if (ev.type === "result") {
        finalText = ev.result || "";
        cost = ev.total_cost_usd || 0;
        turns = ev.num_turns || 0;
        isError = ev.is_error === true || (ev.subtype && ev.subtype !== "success");
      }
    });

    let stderr = "";
    child.stderr.on("data", (b) => {
      stderr += b.toString();
    });

    child.on("error", (e) => {
      clearTimeout(killTimer);
      logLine(`✖ spawn error: ${e.message}`);
      resolve({ report: e.message, code: -1, isError: true, cost: 0, turns: 0 });
    });

    child.on("close", (code) => {
      clearTimeout(killTimer);
      const report = (finalText || assistantText.join("\n\n") || "(no output)").trim();
      logLine(`■ ${cyc.label} cycle done (exit ${code}, turns ${turns}, $${cost.toFixed(4)}${isError ? ", ERROR" : ""})`);
      if (toolCalls.length) logLine(`  tools: ${toolCalls.join(", ")}`);
      logLine("──── report ────\n" + report + "\n────────────────");
      if (stderr.trim() && (code !== 0 || isError)) logLine("stderr:\n" + stderr.trim().slice(0, 2000));
      notifyTelegram(
        `<b>Meridian · ${cyc.label}</b>${dry ? " (dry-run)" : ""}\n${escapeHtml(report).slice(0, 3500)}`,
      ).catch((e) => logLine(`telegram notify failed: ${e.message}`));
      resolve({ report, code, isError, cost, turns });
    });

    try {
      child.stdin.write(cyc.buildPrompt());
      child.stdin.end();
    } catch {
      // surfaced via the 'error'/'close' handlers
    }
  });
}

let running = false;
async function runGuarded(kind) {
  if (running) {
    logLine(`⏭ skip ${kind} — another cycle is still running`);
    return;
  }
  running = true;
  try {
    await runCycle(kind);
  } catch (e) {
    logLine(`✖ ${kind} cycle failed: ${e.message}`);
  } finally {
    running = false;
  }
}

async function main() {
  const mode = process.argv[2] || "start";

  try {
    findClaude();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  if (mode === "screen" || mode === "manage") {
    await runGuarded(mode);
    process.exit(0);
  }

  if (mode === "start") {
    const sMin = Math.max(1, config.schedule.screeningIntervalMin);
    const mMin = Math.max(1, config.schedule.managementIntervalMin);
    const paper = process.env.PAPER_TRADING === "true" || config.paper?.enabled;
    const dry = String(process.env.DRY_RUN).toLowerCase() === "true";
    logLine(`Meridian Claude runner — screen every ${sMin}m, manage every ${mMin}m (model=${MODEL}, perm=${PERMISSION_MODE})`);
    if (paper) logLine(`🧪 PAPER mode — virtual trades only, no funds at risk${dry ? " (DRY_RUN on too)" : ""}.`);
    else if (dry) logLine("DRY-RUN mode — no on-chain transactions.");
    else logLine("⚠ LIVE mode — real on-chain transactions enabled. Set PAPER_TRADING=true or DRY_RUN=true to simulate.");

    cron.schedule(`*/${mMin} * * * *`, () => runGuarded("manage"));
    cron.schedule(`*/${sMin} * * * *`, () => runGuarded("screen"));

    if (process.argv.includes("--now")) {
      await runGuarded("manage");
      await runGuarded("screen");
    }
    logLine("Runner armed. Waiting for next scheduled cycle… (Ctrl+C to stop)");
    return;
  }

  console.error(`Unknown mode "${mode}". Use: screen | manage | start [--now]`);
  process.exit(1);
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    logLine(`${sig} received — shutting down.`);
    process.exit(0);
  });
}

main();
