import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  sub,
  icon,
  intent = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  intent?: "profit" | "loss" | "default";
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          {icon && <span className="text-muted-foreground">{icon}</span>}
        </div>
        <div
          className={cn(
            "mt-2 text-2xl font-bold tracking-tight",
            intent === "profit" && "text-[var(--profit)]",
            intent === "loss" && "text-[var(--loss)]",
          )}
        >
          {value}
        </div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
