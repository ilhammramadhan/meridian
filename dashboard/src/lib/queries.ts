import { useQuery } from "@tanstack/react-query";
import * as reads from "@/lib/server/meridian/reads";
import * as brainApi from "@/lib/server/meridian/brain";

export const useBalance = () =>
  useQuery({ queryKey: ["balance"], queryFn: () => reads.getBalance(), refetchInterval: 15_000 });
export const usePositions = () =>
  // §5.5: 15s (was 10s) — positions forks cli.js; modest backoff reduces fork thrash.
  useQuery({ queryKey: ["positions"], queryFn: () => reads.getPositions(), refetchInterval: 15_000 });
export const useCandidates = (limit = 5) =>
  useQuery({ queryKey: ["candidates", limit], queryFn: () => reads.getCandidates({ data: { limit } }), refetchInterval: 30_000 });
export const useDecisions = () =>
  useQuery({ queryKey: ["decisions"], queryFn: () => reads.getDecisions(), refetchInterval: 15_000 });
export const usePerformance = () =>
  useQuery({ queryKey: ["performance"], queryFn: () => reads.getPerformance(), refetchInterval: 60_000 });
export const useLessons = () =>
  useQuery({ queryKey: ["lessons"], queryFn: () => reads.getLessons(), refetchInterval: 60_000 });
export const useConfig = () =>
  useQuery({ queryKey: ["config"], queryFn: () => reads.getConfig(), refetchInterval: 30_000 });
export const useSignalWeights = () =>
  useQuery({ queryKey: ["weights"], queryFn: () => reads.getSignalWeights(), refetchInterval: 30_000 });
export const useSmartWallets = () =>
  useQuery({ queryKey: ["smartwallets"], queryFn: () => reads.getSmartWallets(), refetchInterval: 60_000 });
export const useDiscordSignals = () =>
  useQuery({ queryKey: ["discord"], queryFn: () => reads.getDiscordSignals(), refetchInterval: 30_000 });
export const useAgentStatus = () =>
  useQuery({ queryKey: ["status"], queryFn: () => reads.getAgentStatus(), refetchInterval: 5_000 });
export const usePaperStatus = () =>
  useQuery({ queryKey: ["paper"], queryFn: () => reads.getPaperStatus(), refetchInterval: 15_000 });
export const useClosedPositions = () =>
  useQuery({ queryKey: ["closed-positions"], queryFn: () => reads.getClosedPositions(), refetchInterval: 30_000 });
export const useEquityCurve = () =>
  useQuery({ queryKey: ["equity"], queryFn: () => reads.getEquityCurve({ data: { limit: 2000 } }), refetchInterval: 30_000 });
export const useReasoning = (limit = 200) =>
  useQuery({
    queryKey: ["reasoning", limit],
    queryFn: () => reads.getReasoning({ data: { limit } }),
    refetchInterval: 2_000,
  });

export const useBrainList = (type?: string) =>
  useQuery({ queryKey: ["brain", "list", type ?? "all"], queryFn: () => brainApi.getBrainList({ data: { type } }) });
export const useBrainPage = (ref: string) =>
  useQuery({ queryKey: ["brain", "page", ref], queryFn: () => brainApi.getBrainPage({ data: { ref } }), enabled: !!ref });
export const useBrainIndex = () =>
  useQuery({ queryKey: ["brain", "index"], queryFn: () => brainApi.getBrainIndex() });
