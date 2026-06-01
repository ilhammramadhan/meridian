import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { runCli } from "./cli-adapter";
import { acquireLock, releaseLock } from "./lock";

async function withLock<T>(kind: string, fn: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  if (!acquireLock("dashboard", kind)) return { ok: false, error: "agent busy" };
  try {
    return await fn();
  } finally {
    releaseLock();
  }
}

const dryFlag = (dryRun?: boolean) => (dryRun ? ["--dry-run"] : []);

export const runScreen = createServerFn({ method: "POST" })
  .inputValidator(z.object({ dryRun: z.boolean().optional() }))
  .handler(async ({ data }) =>
    withLock("screen", async () => {
      const r = await runCli(["screen", "--silent", ...dryFlag(data.dryRun)], { timeoutMs: 600_000 });
      return r.ok ? { ok: true, report: r.data } : { ok: false, error: r.error };
    }),
  );

export const runManage = createServerFn({ method: "POST" })
  .inputValidator(z.object({ dryRun: z.boolean().optional() }))
  .handler(async ({ data }) =>
    withLock("manage", async () => {
      const r = await runCli(["manage", "--silent", ...dryFlag(data.dryRun)], { timeoutMs: 600_000 });
      return r.ok ? { ok: true, report: r.data } : { ok: false, error: r.error };
    }),
  );

export const closePosition = createServerFn({ method: "POST" })
  .inputValidator(z.object({ position: z.string(), skipSwap: z.boolean().optional(), dryRun: z.boolean().optional() }))
  .handler(async ({ data }) =>
    withLock("close", async () => {
      const a = ["close", "--position", data.position, ...dryFlag(data.dryRun)];
      if (data.skipSwap) a.push("--skip-swap");
      const r = await runCli(a, { timeoutMs: 180_000 });
      return r.ok ? { ok: true, ...(r.data as object) } : { ok: false, error: r.error };
    }),
  );

export const claimFees = createServerFn({ method: "POST" })
  .inputValidator(z.object({ position: z.string() }))
  .handler(async ({ data }) =>
    withLock("claim", async () => {
      const r = await runCli(["claim", "--position", data.position], { timeoutMs: 180_000 });
      return r.ok ? { ok: true, ...(r.data as object) } : { ok: false, error: r.error };
    }),
  );

export const swapToken = createServerFn({ method: "POST" })
  .inputValidator(z.object({ from: z.string(), to: z.string(), amount: z.number(), dryRun: z.boolean().optional() }))
  .handler(async ({ data }) =>
    withLock("swap", async () => {
      const r = await runCli(
        ["swap", "--from", data.from, "--to", data.to, "--amount", String(data.amount), ...dryFlag(data.dryRun)],
        { timeoutMs: 180_000 },
      );
      return r.ok ? { ok: true, ...(r.data as object) } : { ok: false, error: r.error };
    }),
  );

export const setConfig = createServerFn({ method: "POST" })
  .inputValidator(z.object({ key: z.string(), value: z.string() }))
  .handler(async ({ data }) => {
    const r = await runCli(["config", "set", data.key, data.value]);
    return r.ok ? { ok: true, ...(r.data as object) } : { ok: false, error: r.error };
  });

export const blacklistAdd = createServerFn({ method: "POST" })
  .inputValidator(z.object({ mint: z.string(), reason: z.string() }))
  .handler(async ({ data }) => {
    const r = await runCli(["blacklist", "add", "--mint", data.mint, "--reason", data.reason]);
    return r.ok ? { ok: true, ...(r.data as object) } : { ok: false, error: r.error };
  });
