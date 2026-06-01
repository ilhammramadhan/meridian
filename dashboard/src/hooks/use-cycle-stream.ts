import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { triggerCycle } from "@/lib/server/meridian/controls";

export interface StreamEvent {
  type: string;
  [k: string]: unknown;
}

/**
 * Trigger a screen/manage cycle via the local Claude session (fire-and-forget).
 * The cycle runs in the background; data views refresh via polling. (Token-by-token
 * live streaming needs this TanStack Start version's server-route API — deferred.)
 */
export function useCycleStream() {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [running, setRunning] = useState(false);
  const qc = useQueryClient();

  const start = useCallback(
    async (kind: "screen" | "manage") => {
      setRunning(true);
      setEvents([
        {
          type: "thinking",
          text:
            `${kind} cycle started in the background via your Claude session (paper mode). ` +
            `Positions, Decisions and Performance refresh as it runs. ` +
            `For continuous runs use the terminal:  cd meridian && npm run dev:claude`,
        },
      ]);
      try {
        const r: any = await triggerCycle({ data: { kind } });
        if (r?.ok === false) {
          toast.error(r.error || "Failed to start cycle");
          setEvents((e) => [...e, { type: "error", message: r.error }]);
        } else {
          toast.success(`${kind} cycle started`);
        }
      } catch (e: any) {
        toast.error(e?.message || "Failed to start cycle");
        setEvents((ev) => [...ev, { type: "error", message: e?.message }]);
      }
      setTimeout(() => {
        setRunning(false);
        qc.invalidateQueries();
      }, 4000);
    },
    [qc],
  );

  const stop = useCallback(() => setRunning(false), []);
  return { events, running, start, stop };
}
