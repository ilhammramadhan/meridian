import { useBalance } from "@/lib/queries";
import { fmtUsd } from "@/lib/format";

export function MarketTicker() {
  const { data } = useBalance();
  const b = (data || {}) as Record<string, number>;
  const sol = Number(b.sol) || 0;
  const solUsd = Number(b.sol_usd) || 0;
  const price = sol > 0 && solUsd > 0 ? solUsd / sol : 0;
  return (
    <div className="hidden items-center gap-4 sm:flex">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">SOL</span>
        <span className="text-sm font-semibold">{price ? fmtUsd(price) : "—"}</span>
      </div>
      <div className="h-4 w-px bg-border" />
      <div className="text-sm">
        <span className="text-muted-foreground">Wallet </span>
        <span className="font-medium">{sol.toFixed(3)} SOL</span>
      </div>
      {b.total_usd != null && (
        <div className="text-sm">
          <span className="text-muted-foreground">Portfolio </span>
          <span className="font-medium">{fmtUsd(b.total_usd)}</span>
        </div>
      )}
    </div>
  );
}
