import { AlertTriangle, BrainCircuit, CheckCircle2, Loader2, Wrench } from "lucide-react";
import type { StreamEvent } from "@/hooks/use-cycle-stream";

export function ReasoningStream({ events, running }: { events: StreamEvent[]; running: boolean }) {
  if (!events.length && !running) return null;
  return (
    <div className="max-h-96 space-y-1.5 overflow-auto rounded-xl border bg-card p-4 font-mono text-xs">
      {events.map((e, i) => {
        if (e.type === "thinking")
          return (
            <div key={i} className="flex gap-2">
              <BrainCircuit className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="whitespace-pre-wrap">{String(e.text).slice(0, 400)}</span>
            </div>
          );
        if (e.type === "tool_use")
          return (
            <div key={i} className="flex gap-2 text-muted-foreground">
              <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <b>{String(e.name)}</b> {String(e.summary || "")}
              </span>
            </div>
          );
        if (e.type === "result")
          return (
            <div key={i} className="flex gap-2 text-[var(--profit)]">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="whitespace-pre-wrap">
                {String(e.report).slice(0, 600)} · ${Number(e.cost || 0).toFixed(4)} · {String(e.turns)} turns
              </span>
            </div>
          );
        if (e.type === "error")
          return (
            <div key={i} className="flex gap-2 text-[var(--loss)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{String(e.message)}</span>
            </div>
          );
        return null;
      })}
      {running && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> running…
        </div>
      )}
    </div>
  );
}
