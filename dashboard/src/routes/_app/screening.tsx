import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Pagination } from "@/components/common/pagination";
import { ReasoningStream } from "@/components/streams/reasoning-stream";
import { useCandidates, useDecisions } from "@/lib/queries";
import { useCycleStream } from "@/hooks/use-cycle-stream";
import { useReasoningStream } from "@/hooks/use-reasoning-stream";
import { useAction } from "@/hooks/use-action";
import { blacklistAdd } from "@/lib/server/meridian/controls";
import { fmtAgo, fmtUsd, shortAddr } from "@/lib/format";

export const Route = createFileRoute("/_app/screening")({ component: Screening });

function Screening() {
  const { data: cand } = useCandidates(8);
  const { data: decisions } = useDecisions();
  const { running, start } = useCycleStream();
  const { events: liveEvents, running: liveRunning } = useReasoningStream({ kind: "screen" });
  const candidates = ((cand as any)?.candidates || []) as any[];
  const decs = ((decisions as any) || []) as any[];
  const [page, setPage] = useState(1);
  const per = 6;
  const pageDecs = decs.slice((page - 1) * per, page * per);
  const blacklist = useAction(blacklistAdd as any, { invalidate: [["candidates", 8]], success: "Blacklisted" });

  return (
    <div className="space-y-6">
      <PageHeader title="Screening" subtitle="Candidates the agent is evaluating + its deploy/skip decisions">
        <Button onClick={() => start("screen")} disabled={running}>
          <Play className="mr-1.5 h-4 w-4" /> Run screen now
        </Button>
      </PageHeader>

      {(liveRunning || liveEvents.length > 0) && <ReasoningStream events={liveEvents} running={liveRunning} />}

      <Tabs defaultValue="candidates">
        <TabsList>
          <TabsTrigger value="candidates">Candidates ({candidates.length})</TabsTrigger>
          <TabsTrigger value="decisions">Decisions ({decs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="candidates">
          {candidates.length ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {candidates.map((c, i) => (
                <Card key={c.pool_address || c.pool || i}>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{c.name || shortAddr(c.pool_address || c.pool)}</div>
                      {c.score != null && <Badge variant="secondary">score {Math.round(c.score)}</Badge>}
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                      <span>fee/TVL {c.fee_active_tvl_ratio ?? "—"}</span>
                      <span>organic {c.organic_score ?? "—"}</span>
                      <span>mcap {c.mcap != null ? fmtUsd(c.mcap) : "—"}</span>
                      <span>vol {c.volume != null ? fmtUsd(c.volume) : "—"}</span>
                      <span>bin {c.bin_step ?? "—"}</span>
                      <span>volatility {c.volatility ?? "—"}</span>
                    </div>
                    {c.smart_wallets?.length ? (
                      <Badge className="bg-primary/10 text-primary">smart money: {c.smart_wallets.length}</Badge>
                    ) : null}
                    {c.base_mint && (
                      <div className="pt-1">
                        <Button size="sm" variant="outline" onClick={() => blacklist.mutate({ mint: c.base_mint, reason: "manual blacklist from dashboard" })}>
                          Blacklist
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState message="No candidates surfaced. Run a screen cycle." />
          )}
        </TabsContent>

        <TabsContent value="decisions">
          {pageDecs.length ? (
            <div className="space-y-3">
              {pageDecs.map((d) => (
                <Card key={d.id}>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium uppercase">{d.type}</span>
                        <span className="text-xs text-muted-foreground">{d.actor}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{fmtAgo(d.ts)}</span>
                    </div>
                    <div className="font-medium">{d.pool_name || d.pool || "—"}</div>
                    {d.summary && <p className="text-sm">{d.summary}</p>}
                    {d.reason && <p className="text-xs text-muted-foreground">{d.reason}</p>}
                    {d.risks?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {d.risks.map((r: string, i: number) => (
                          <Badge key={i} variant="outline" className="text-[var(--warn)]">
                            {r}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
              <Pagination page={page} pageCount={Math.ceil(decs.length / per)} onChange={setPage} />
            </div>
          ) : (
            <EmptyState message="No decisions logged yet." />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
