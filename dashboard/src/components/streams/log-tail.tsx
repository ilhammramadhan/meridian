import { useLogTail } from "@/hooks/use-log-tail";
import { fmtAgo } from "@/lib/format";
import { StatusBadge } from "@/components/common/status-badge";

export function LogTail() {
  const lines = useLogTail();
  if (!lines.length)
    return <div className="text-sm text-muted-foreground">Waiting for action-trail activity…</div>;
  return (
    <div className="space-y-1 font-mono text-xs">
      {lines.map((a, i) => (
        <div key={i} className="flex items-center gap-2 border-b py-1">
          <StatusBadge status={a.success ? "success" : "error"} label={a.tool} />
          <span className="truncate text-muted-foreground">{a.error ? String(a.error).slice(0, 90) : ""}</span>
          <span className="ml-auto shrink-0 text-muted-foreground">{fmtAgo(a.timestamp)}</span>
        </div>
      ))}
    </div>
  );
}
