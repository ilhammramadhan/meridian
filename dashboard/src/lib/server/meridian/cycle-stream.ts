import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { MERIDIAN_DIR } from "./paths";

export type CycleEvent =
  | { type: "init"; session_id?: string; model?: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; name: string; summary: string }
  | { type: "tool_result"; is_error: boolean }
  | { type: "result"; report: string; cost: number; turns: number; error: boolean }
  | { type: "error"; message: string }
  | { type: "done"; exitCode?: number | null };

function loadCommandBody(kind: string): string {
  let body = fs.readFileSync(path.join(MERIDIAN_DIR, ".claude", "commands", `${kind}.md`), "utf8");
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) body = body.slice(body.indexOf("\n", end + 1) + 1);
  }
  return body.trim();
}

/**
 * Spawn `claude -p` to run one screen/manage cycle on the local Claude session
 * (no API key), forwarding normalized stream-json events to onEvent. Resolves on close.
 */
export function runCycleStream(
  kind: "screen" | "manage",
  onEvent: (e: CycleEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const bin = process.env.CLAUDE_BIN || "claude";
  const model = process.env.CLAUDE_MODEL || "opus";
  const perm = process.env.CLAUDE_PERMISSION_MODE || "default";
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!env.ANTHROPIC_BASE_URL) delete env.ANTHROPIC_API_KEY; // inherit `claude login`

  const prompt =
    `You are running ONE autonomous ${kind} cycle for the Meridian DLMM agent. ` +
    `Use the meridian CLI (\`node cli.js …\`). Run commands sequentially, never in the background. ` +
    `When finished, end with a concise report.\n\n${loadCommandBody(kind)}`;

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, ["-p", "--output-format", "stream-json", "--verbose", "--model", model, "--permission-mode", perm], {
        cwd: MERIDIAN_DIR,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e: unknown) {
      onEvent({ type: "error", message: (e as Error).message });
      onEvent({ type: "done", exitCode: -1 });
      return resolve();
    }

    const timeout = setTimeout(() => child.kill("SIGTERM"), Number(process.env.CLAUDE_CYCLE_TIMEOUT_MS) || 600_000);
    if (signal) signal.addEventListener("abort", () => child.kill("SIGTERM"));

    const rl = readline.createInterface({ input: child.stdout!, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const t = line.trim();
      if (!t) return;
      let ev: any;
      try {
        ev = JSON.parse(t);
      } catch {
        return;
      }
      if (ev.type === "system" && ev.subtype === "init") {
        onEvent({ type: "init", session_id: ev.session_id, model: ev.model });
      } else if (ev.type === "assistant") {
        for (const b of ev.message?.content ?? []) {
          if (b.type === "text" && b.text?.trim()) onEvent({ type: "thinking", text: b.text });
          if (b.type === "tool_use") {
            const summary =
              b.name === "Bash" ? String(b.input?.command || "").slice(0, 180) : JSON.stringify(b.input || {}).slice(0, 180);
            onEvent({ type: "tool_use", name: b.name, summary });
          }
        }
      } else if (ev.type === "user") {
        for (const b of ev.message?.content ?? []) {
          if (b.type === "tool_result") onEvent({ type: "tool_result", is_error: !!b.is_error });
        }
      } else if (ev.type === "result") {
        onEvent({
          type: "result",
          report: ev.result || "",
          cost: ev.total_cost_usd || 0,
          turns: ev.num_turns || 0,
          error: ev.is_error === true || (ev.subtype && ev.subtype !== "success"),
        });
      }
    });

    let stderr = "";
    child.stderr!.on("data", (b) => (stderr += b.toString()));
    child.on("error", (e) => {
      clearTimeout(timeout);
      onEvent({ type: "error", message: e.message });
      onEvent({ type: "done", exitCode: -1 });
      resolve();
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (stderr.trim() && code !== 0) onEvent({ type: "error", message: stderr.trim().slice(0, 500) });
      onEvent({ type: "done", exitCode: code });
      resolve();
    });

    try {
      child.stdin!.write(prompt);
      child.stdin!.end();
    } catch { /* surfaced via close */ }
  });
}
