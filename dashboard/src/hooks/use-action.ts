import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

type ServerFn = (opts?: { data: unknown }) => Promise<unknown>;

/** Wrap a control server-fn as a mutation with toast + cache invalidation (no confirm). */
export function useAction(
  fn: ServerFn,
  { invalidate = [], success = "Done" }: { invalidate?: unknown[][]; success?: string } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars?: unknown) => (vars === undefined ? fn() : fn({ data: vars })),
    onSuccess: (res: any) => {
      if (res && res.ok === false) {
        toast.error(res.error || "Action failed");
        return;
      }
      toast.success(success);
      invalidate.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    },
    onError: (e: any) => toast.error(e?.message || "Action failed"),
  });
}
