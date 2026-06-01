import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { RangeProgressBar } from "@/components/common/range-progress-bar";
import { usePositions } from "@/lib/queries";
import { useAction } from "@/hooks/use-action";
import { claimFees, closePosition } from "@/lib/server/meridian/controls";
import { fmtDuration, fmtPct, fmtUsd, pnlClass, shortAddr } from "@/lib/format";

export const Route = createFileRoute("/_app/positions")({ component: Positions });

function Positions() {
  const { data } = usePositions();
  const err = (data as any)?.error as string | undefined;
  const all = ((data as any)?.positions || []) as any[];
  const open = all.filter((p) => !p.closed);
  const closed = all.filter((p) => p.closed);
  const close = useAction(closePosition as any, { invalidate: [["positions"]], success: "Close submitted" });
  const claim = useAction(claimFees as any, { invalidate: [["positions"]], success: "Claim submitted" });

  const renderRow = (p: any) => (
    <Card key={p.position}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div className="font-medium">{p.pool_name || shortAddr(p.pool)}</div>
          <Badge variant="secondary">{p.strategy || "—"}</Badge>
        </div>
        <RangeProgressBar lower={p.bin_range?.lower} upper={p.bin_range?.upper} active={p.active_bin} oor={!!p.out_of_range_since} />
        <div className="grid grid-cols-3 gap-1 text-xs text-muted-foreground">
          <span className={pnlClass(p.pnl_pct)}>PnL {fmtPct(p.pnl_pct)}</span>
          <span>peak {fmtPct(p.peak_pnl_pct)}</span>
          <span>fees {fmtUsd(p.total_fees_claimed_usd)}</span>
          <span>age {fmtDuration(p.age_minutes)}</span>
          <span>{p.amount_sol != null ? `${p.amount_sol} SOL` : ""}</span>
          <span>{p.out_of_range_since ? "out of range" : "in range"}</span>
        </div>
        {p.instruction && <p className="text-xs italic text-muted-foreground">“{p.instruction}”</p>}
        {!p.closed && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => claim.mutate({ position: p.position })}>
              Claim
            </Button>
            <Button size="sm" variant="destructive" onClick={() => close.mutate({ position: p.position })}>
              Close
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Positions" subtitle="Open LP positions + history" />
      {err && (
        <Card className="border-[var(--loss)]/40">
          <CardContent className="p-4 text-sm text-[var(--loss)]">Failed to load positions: {err}</CardContent>
        </Card>
      )}
      <Tabs defaultValue="open">
        <TabsList>
          <TabsTrigger value="open">Open ({open.length})</TabsTrigger>
          <TabsTrigger value="closed">Closed ({closed.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="open">
          {open.length ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{open.map(renderRow)}</div> : <EmptyState message="No open positions." />}
        </TabsContent>
        <TabsContent value="closed">
          {closed.length ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{closed.map(renderRow)}</div> : <EmptyState message="No closed positions yet." />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
