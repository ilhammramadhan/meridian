import { useEffect, useState } from "react";
import type { ActionEntry } from "@/lib/types";

export function useLogTail(max = 300) {
  const [lines, setLines] = useState<ActionEntry[]>([]);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource("/api/meridian/logs/stream");
    es.onmessage = (m) => {
      let e: { type: string; entry?: ActionEntry };
      try {
        e = JSON.parse(m.data);
      } catch {
        return;
      }
      if (e.type === "line" && e.entry) setLines((p) => [e.entry as ActionEntry, ...p].slice(0, max));
    };
    return () => es.close();
  }, [max]);

  return lines;
}
