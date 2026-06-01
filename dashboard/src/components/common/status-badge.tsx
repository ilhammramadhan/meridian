import { Check, X, AlertTriangle, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

const MAP: Record<string, { icon: typeof Check; cls: string; label: string }> = {
  success: { icon: Check, cls: "text-[var(--profit)]", label: "OK" },
  error: { icon: X, cls: "text-[var(--loss)]", label: "Failed" },
  warn: { icon: AlertTriangle, cls: "text-[var(--warn)]", label: "Warn" },
  neutral: { icon: Minus, cls: "text-muted-foreground", label: "—" },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const m = MAP[status] || MAP.neutral;
  const I = m.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium",
        m.cls,
      )}
    >
      <I className="h-3 w-3" />
      {label ?? m.label}
    </span>
  );
}
