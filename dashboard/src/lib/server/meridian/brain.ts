import fs from "node:fs";
import path from "node:path";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { runCli } from "./cli-adapter";
import { BRAIN_DIR } from "./paths";

function readBrainFile(name: string): string {
  try {
    return fs.readFileSync(path.join(BRAIN_DIR, name), "utf8");
  } catch {
    return "";
  }
}

export const getBrainList = createServerFn({ method: "GET" })
  .inputValidator(z.object({ type: z.string().optional() }))
  .handler(async ({ data }) => {
    const args = ["brain", "list"];
    if (data.type) args.push("--type", data.type);
    const r = await runCli<{ pages: unknown[] }>(args);
    return r.ok ? r.data : { pages: [] };
  });

export const getBrainPage = createServerFn({ method: "GET" })
  .inputValidator(z.object({ ref: z.string() }))
  .handler(async ({ data }) => {
    const r = await runCli(["brain", "page", data.ref]);
    return r.ok ? r.data : { error: r.error };
  });

export const getBrainIndex = createServerFn({ method: "GET" }).handler(async () => ({
  index: readBrainFile("index.md"),
  log: readBrainFile("log.md"),
}));

export const brainLint = createServerFn({ method: "POST" }).handler(async () => {
  const r = await runCli(["brain", "lint"]);
  return r.ok ? r.data : { error: r.error };
});

export const brainRebuild = createServerFn({ method: "POST" }).handler(async () => {
  const r = await runCli(["brain", "rebuild"], { timeoutMs: 60_000 });
  return r.ok ? r.data : { error: r.error };
});

export const saveBrainPage = createServerFn({ method: "POST" })
  .inputValidator(z.object({ ref: z.string(), section: z.string().default("Summary"), text: z.string(), pin: z.boolean().optional() }))
  .handler(async ({ data }) => {
    const a = ["brain", "curate", "--ref", data.ref, "--section", data.section, "--text", data.text];
    if (data.pin) a.push("--pin");
    const r = await runCli(a);
    return r.ok ? { ok: true, ...(r.data as object) } : { ok: false, error: r.error };
  });
