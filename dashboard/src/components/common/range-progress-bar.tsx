import { cn } from "@/lib/utils";

export function RangeProgressBar({
  lower,
  upper,
  active,
  oor,
}: {
  lower?: number;
  upper?: number;
  active?: number;
  oor?: boolean;
}) {
  let pct = 50;
  if (lower != null && upper != null && active != null && upper > lower) {
    pct = Math.min(100, Math.max(0, ((active - lower) / (upper - lower)) * 100));
  }
  return (
    <div className="space-y-1">
      <div className="relative h-2 w-full rounded-full bg-muted">
        <div
          className={cn(
            "absolute top-0 h-2 w-1.5 -translate-x-1/2 rounded-full",
            oor ? "bg-[var(--warn)]" : "bg-primary",
          )}
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{lower ?? "?"}</span>
        <span>{oor ? "out of range" : `${Math.round(pct)}%`}</span>
        <span>{upper ?? "?"}</span>
      </div>
    </div>
  );
}
