import fs from "node:fs";
import { meridianPath } from "./paths";

const LOCK = meridianPath(".dashboard-cycle.lock");
const STALE_MS = 12 * 60 * 1000;

export interface LockInfo {
  holder: string;
  kind?: string;
  pid: number;
  startedAt: number;
}

function pidAlive(pid: number) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock(holder: string, kind?: string): boolean {
  try {
    const fd = fs.openSync(LOCK, "wx"); // O_CREAT|O_EXCL — atomic
    fs.writeFileSync(fd, JSON.stringify({ holder, kind, pid: process.pid, startedAt: Date.now() }));
    fs.closeSync(fd);
    return true;
  } catch {
    const info = lockStatus();
    if (info && (Date.now() - (info.startedAt || 0) > STALE_MS || !pidAlive(info.pid))) {
      try {
        fs.rmSync(LOCK, { force: true });
      } catch { /* race */ }
      return acquireLock(holder, kind);
    }
    return false;
  }
}

export function releaseLock() {
  try {
    fs.rmSync(LOCK, { force: true });
  } catch { /* noop */ }
}

export function lockStatus(): LockInfo | null {
  try {
    return JSON.parse(fs.readFileSync(LOCK, "utf8")) as LockInfo;
  } catch {
    return null;
  }
}
