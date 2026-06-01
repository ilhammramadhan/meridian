import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export interface StreamEvent {
  type: string;
  [k: string]: unknown;
}

export function useCycleStream() {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [running, setRunning] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const qc = useQueryClient();

  const stop = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setRunning(false);
  }, []);

  const start = useCallback(
    (kind: "screen" | "manage") => {
      if (typeof EventSource === "undefined") return;
      esRef.current?.close();
      setEvents([]);
      setRunning(true);
      const es = new EventSource(`/api/meridian/cycle/stream?kind=${kind}`);
      esRef.current = es;
      es.onmessage = (m) => {
        let e: StreamEvent;
        try {
          e = JSON.parse(m.data);
        } catch {
          return;
        }
        setEvents((p) => [...p, e]);
        if (e.type === "tool_result" || e.type === "result") {
          qc.invalidateQueries({ queryKey: ["positions"] });
          qc.invalidateQueries({ queryKey: ["decisions"] });
          qc.invalidateQueries({ queryKey: ["balance"] });
        }
        if (e.type === "done") stop();
      };
      es.onerror = () => stop();
    },
    [qc, stop],
  );

  return { events, running, start, stop };
}
