import { useMemo } from "react";
import { useReasoning } from "@/lib/queries";
import type { StreamEvent } from "@/hooks/use-cycle-stream";

/** Raw row shape written by claude-runner.js to logs/reasoning.jsonl. */
interface RawReasoning {
  ts?: number | string;
  kind?: string;
  type?: string;
  text?: string;
  name?: string;
  summary?: string;
  report?: string;
  cost?: number;
  turns?: number;
  error?: string;
}

/**
 * §5.1 — Poll logs/reasoning.jsonl (~2s) and adapt rows into the StreamEvent shape the
 * ReasoningStream component renders. No SSE; reuses the poll transport (like use-log-tail).
 * `running` is inferred: a trailing run that hasn't emitted a result/done yet.
 */
export function useReasoningStream(opts: { kind?: "screen" | "manage"; limit?: number } = {}) {
  const { kind, limit = 200 } = opts;
  const { data } = useReasoning(limit);

  const raw = useMemo(() => {
    const all = (((data as any)?.events || []) as RawReasoning[]).filter(Boolean);
    return kind ? all.filter((e) => !e.kind || e.kind === kind) : all;
  }, [data, kind]);

  const events = useMemo<StreamEvent[]>(() => {
    const out: StreamEvent[] = [];
    for (const e of raw) {
      switch (e.type) {
        case "thinking":
          if (e.text) out.push({ type: "thinking", text: e.text });
          break;
        case "tool_use":
          out.push({ type: "tool_use", name: e.name, summary: e.summary });
          break;
        case "tool_result":
          // surfaced compactly as a tool line so progress is visible
          out.push({ type: "tool_use", name: e.name, summary: e.summary || "→ done" });
          break;
        case "result":
        case "done":
          if (e.error) out.push({ type: "error", message: e.error });
          else
            out.push({
              type: "result",
              report: e.report ?? e.text ?? e.summary ?? "",
              cost: e.cost,
              turns: e.turns,
            });
          break;
        case "init":
          // a fresh cycle boundary; skip rendering but used below for running inference
          break;
        default:
          if (e.error) out.push({ type: "error", message: e.error });
          else if (e.text) out.push({ type: "thinking", text: e.text });
      }
    }
    return out;
  }, [raw]);

  // running = last event is not a terminal result/done/error
  const running = useMemo(() => {
    const last = raw[raw.length - 1];
    if (!last) return false;
    return last.type !== "result" && last.type !== "done" && !last.error;
  }, [raw]);

  return { events, running };
}
