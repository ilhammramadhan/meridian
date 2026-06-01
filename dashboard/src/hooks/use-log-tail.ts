import { useQuery } from "@tanstack/react-query";
import { getActivity } from "@/lib/server/meridian/reads";
import type { ActionEntry } from "@/lib/types";

/** Poll the action trail (logs/actions-*.jsonl) — reliable transport vs SSE in this version. */
export function useLogTail(max = 300) {
  const { data } = useQuery({
    queryKey: ["activity", max],
    queryFn: () => getActivity({ data: { limit: max } }),
    refetchInterval: 4000,
  });
  return ((data as any)?.actions || []) as ActionEntry[];
}
