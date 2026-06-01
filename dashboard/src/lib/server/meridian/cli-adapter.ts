import { spawn } from "node:child_process";
import { MERIDIAN_DIR, NODE_BIN } from "./paths";

export interface CliResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  exitCode: number;
  raw: string;
}

/**
 * Run `node cli.js <args>` in the Meridian dir and parse its JSON output.
 * Success → stdout JSON; failure → stderr `{error}` (or raw stderr).
 */
export function runCli<T = unknown>(
  args: string[],
  { timeoutMs = 30_000 }: { timeoutMs?: number } = {},
): Promise<CliResult<T>> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(NODE_BIN, ["cli.js", ...args], {
        cwd: MERIDIAN_DIR,
        env: { ...process.env, DRY_RUN: process.env.DRY_RUN },
        shell: false,
      });
    } catch (e: unknown) {
      return resolve({ ok: false, error: (e as Error).message, exitCode: -1, raw: "" });
    }

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);

    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", (e) =>
      resolve({ ok: false, error: e.message, exitCode: -1, raw: stderr }),
    );
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        try {
          return resolve({ ok: true, data: JSON.parse(stdout) as T, exitCode: 0, raw: stdout });
        } catch {
          return resolve({ ok: true, data: stdout as unknown as T, exitCode: 0, raw: stdout });
        }
      }
      let error = stderr.trim() || `cli.js exited ${code}`;
      try {
        error = JSON.parse(stderr).error || error;
      } catch { /* keep raw */ }
      resolve({ ok: false, error, exitCode: code ?? -1, raw: stderr });
    });
  });
}
