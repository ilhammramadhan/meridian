import fs from "node:fs";
import { meridianPath } from "./paths";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cache = new Map<string, { mtimeMs: number; data: unknown }>();

/**
 * Read a JSON file from the Meridian dir. Tolerates ENOENT (returns fallback) and
 * retries once on a parse error (mitigates torn reads — the agent writes non-atomically).
 */
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  const fp = meridianPath(file);
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string;
    try {
      raw = fs.readFileSync(fp, "utf8");
    } catch {
      return fallback; // ENOENT etc.
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      if (attempt === 0) {
        await sleep(40);
        continue;
      }
      return fallback;
    }
  }
  return fallback;
}

/** Cached read keyed by file mtime — avoids re-parsing large files on hot polling. */
export async function readJsonCached<T>(file: string, fallback: T): Promise<T> {
  const fp = meridianPath(file);
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(fp).mtimeMs;
  } catch {
    return fallback;
  }
  const hit = cache.get(fp);
  if (hit && hit.mtimeMs === mtimeMs) return hit.data as T;
  const data = await readJson<T>(file, fallback);
  cache.set(fp, { mtimeMs, data });
  return data;
}
