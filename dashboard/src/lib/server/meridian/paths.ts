import path from "node:path";

/**
 * Absolute path to the Meridian agent project. The dashboard lives at
 * meridian/dashboard, so the default is its parent. Override with MERIDIAN_DIR.
 */
export const MERIDIAN_DIR =
  process.env.MERIDIAN_DIR || path.resolve(process.cwd(), "..");

export const BRAIN_DIR =
  process.env.MERIDIAN_BRAIN_DIR || path.join(MERIDIAN_DIR, "brain");

export const NODE_BIN = process.env.MERIDIAN_NODE || "node";

export function meridianPath(...parts: string[]) {
  return path.join(MERIDIAN_DIR, ...parts);
}
