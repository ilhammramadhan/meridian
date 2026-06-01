import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Activity, Coins, FlaskConical, Layers, Play, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { KpiCard } from "@/components/common/kpi-card";
import { ReasoningStream } from "@/components/streams/reasoning-stream";
import { PnlLineChart } from "@/components/charts/pnl-line-chart";
import { WinRateChart } from "@/components/charts/win-rate-chart";
import { useBalance, useDecisions, usePaperStatus, usePerformance, usePositions } from "@/lib/queries";
import { useCycleStream } from "@/hooks/use-cycle-stream";
import { useReasoningStream } from "@/hooks/use-reasoning-stream";
import { fmtAgo, fmtPct, fmtSol, fmtUsd } from "@/lib/format";

export const Route = createFileRoute("/_app/")({ component: Overview });

function Overview() {
  const { data: bal } = useBalance();
  const { data: pos } = usePositions();
  const { data: perf } = usePerformance();
  const { data: decisions } = useDecisions();
  const { data: paper } = usePaperStatus();
  const { running, start } = useCycleStream();
  const { events: liveEvents, running: liveRunning } = useReasoningStream();

  const b = (bal || {}) as Record<string, number>;
  const positions = ((pos as any)?.positions || []) as any[];
  const summary = ((perf as any)?.summary || {}) as Record<string, number>;
  const perfPositions = ((perf as any)?.positions || []) as any[];
  const pp = (paper || {}) as Record<string, number | boolean | null>;
  let cum = 0;
  const series = perfPositions.map((p, i) => ({ i: i + 1, cum: (cum += Number(p.pnl_usd) || 0) }));
  const recent = ((decisions as any) || []).slice(0, 6) as any[];
  const isPaper = pp.paper === true;
  const openPnl = pp.open_pnl_usd;

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

      {isPaper && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConical className="h-4 w-4 text-primary" /> Paper ledger (simulated)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="Virtual balance" value={fmtSol(pp.balance_sol)} />
              <Stat label="Deployed" value={fmtUsd(pp.deployed_usd)} sub={`${Number(pp.open) || 0} open`} />
              <Stat
                label="Open M2M PnL"
                value={openPnl == null ? "—" : fmtUsd(openPnl)}
                intent={openPnl == null ? "default" : Number(openPnl) >= 0 ? "profit" : "loss"}
              />
              <Stat
                label="Realized PnL"
                value={fmtUsd(pp.realized_pnl_usd)}
                sub={`${Number(pp.closed_count) || 0} closed`}
                intent={(Number(pp.realized_pnl_usd) || 0) >= 0 ? "profit" : "loss"}
              />
              <Stat label="Win rate" value={fmtPct(pp.win_rate_pct, false)} />
            </div>
            {pp.live_marked === false && (
              <p className="mt-3 text-xs text-[var(--warn)]">Open PnL not marked live (using static deploy value).</p>
            )}
          </CardContent>
        </Card>
      )}

      {(liveRunning || liveEvents.length > 0) && <ReasoningStream events={liveEvents} running={liveRunning} />}

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

function Stat({
  label,
  value,
  sub,
  intent = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  intent?: "profit" | "loss" | "default";
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          "mt-1 text-lg font-semibold tracking-tight" +
          (intent === "profit" ? " text-[var(--profit)]" : intent === "loss" ? " text-[var(--loss)]" : "")
        }
      >
        {value}
      </div>
      {sub != null && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
