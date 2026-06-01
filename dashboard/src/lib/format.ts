export const fmtSol = (n: unknown) => `${(Number(n) || 0).toFixed(3)} SOL`;
export const fmtUsd = (n: unknown) =>
  `$${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
export const fmtPct = (n: unknown, signed = true) => {
  const v = Number(n) || 0;
  return `${signed && v > 0 ? "+" : ""}${v.toFixed(2)}%`;
};
export const shortAddr = (a: unknown) => {
  const s = String(a || "");
  return s.length > 10 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
};
export const fmtAgo = (iso: unknown) => {
  if (!iso) return "—";
  const d = Date.now() - new Date(iso as string).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};
export const fmtDuration = (min: unknown) => {
  const m = Number(min) || 0;
  if (m < 60) return `${Math.round(m)}m`;
  return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
};
export const pnlClass = (n: unknown) =>
  (Number(n) || 0) >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]";
