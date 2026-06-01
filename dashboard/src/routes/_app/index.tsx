import { createFileRoute } from "@tanstack/react-router";
import { Activity, Coins, Layers, Play, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { KpiCard } from "@/components/common/kpi-card";
import { ReasoningStream } from "@/components/streams/reasoning-stream";
import { PnlLineChart } from "@/components/charts/pnl-line-chart";
import { WinRateChart } from "@/components/charts/win-rate-chart";
import { useBalance, useDecisions, usePerformance, usePositions } from "@/lib/queries";
import { useCycleStream } from "@/hooks/use-cycle-stream";
import { fmtAgo, fmtPct, fmtSol, fmtUsd } from "@/lib/format";

export const Route = createFileRoute("/_app/")({ component: Overview });

function Overview() {
  const { data: bal } = useBalance();
  const { data: pos } = usePositions();
  const { data: perf } = usePerformance();
  const { data: decisions } = useDecisions();
  const { events, running, start } = useCycleStream();

  const b = (bal || {}) as Record<string, number>;
  const positions = ((pos as any)?.positions || []) as any[];
  const summary = ((perf as any)?.summary || {}) as Record<string, number>;
  const perfPositions = ((perf as any)?.positions || []) as any[];
  let cum = 0;
  const series = perfPositions.map((p, i) => ({ i: i + 1, cum: (cum += Number(p.pnl_usd) || 0) }));
  const recent = ((decisions as any) || []).slice(0, 6) as any[];

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" subtitle="Live agent + portfolio health">
        <Button onClick={() => start("manage")} disabled={running} variant="outline">
          <Activity className="mr-1.5 h-4 w-4" /> Manage now
        </Button>
        <Button onClick={() => start("screen")} disabled={running}>
          <Play className="mr-1.5 h-4 w-4" /> Run screen
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Wallet" value={fmtSol(b.sol)} sub={b.total_usd != null ? fmtUsd(b.total_usd) : undefined} icon={<Wallet className="h-4 w-4" />} />
        <KpiCard label="Open positions" value={positions.length} icon={<Layers className="h-4 w-4" />} />
        <KpiCard label="Win rate" value={fmtPct(summary.win_rate_pct, false)} sub={`${summary.total_positions_closed || 0} closed`} icon={<TrendingUp className="h-4 w-4" />} />
        <KpiCard label="Net PnL" value={fmtUsd(summary.total_pnl_usd)} intent={(summary.total_pnl_usd || 0) >= 0 ? "profit" : "loss"} icon={<Coins className="h-4 w-4" />} />
      </div>

      {(running || events.length > 0) && <ReasoningStream events={events} running={running} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Cumulative PnL (USD)</CardTitle>
          </CardHeader>
          <CardContent>
            {series.length ? <PnlLineChart data={series} /> : <p className="text-sm text-muted-foreground">No closed positions yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Win rate</CardTitle>
          </CardHeader>
          <CardContent>
            <WinRateChart value={Number(summary.win_rate_pct) || 0} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent decisions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recent.length ? (
            recent.map((d) => (
              <div key={d.id} className="flex items-start gap-3 border-b pb-2 last:border-0">
                <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium uppercase">{d.type}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{d.pool_name || d.pool || "—"}</div>
                  <div className="truncate text-xs text-muted-foreground">{d.summary || d.reason || ""}</div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{fmtAgo(d.ts)}</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No decisions logged yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
