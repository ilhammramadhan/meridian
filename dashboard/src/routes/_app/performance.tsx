import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { KpiCard } from "@/components/common/kpi-card";
import { EmptyState } from "@/components/common/empty-state";
import { PnlLineChart } from "@/components/charts/pnl-line-chart";
import { useLessons, usePerformance } from "@/lib/queries";
import { fmtPct, fmtUsd } from "@/lib/format";

export const Route = createFileRoute("/_app/performance")({ component: Performance });

function Performance() {
  const { data: perf } = usePerformance();
  const { data: les } = useLessons();
  const summary = ((perf as any)?.summary || {}) as Record<string, number>;
  const positions = ((perf as any)?.positions || []) as any[];
  const lessons = ((les as any)?.lessons || []) as any[];
  let cum = 0;
  const series = positions.map((p, i) => ({ i: i + 1, cum: (cum += Number(p.pnl_usd) || 0) }));

  return (
    <div className="space-y-6">
      <PageHeader title="Performance" subtitle="Closed-position outcomes + learned lessons" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Closed" value={summary.total_positions_closed || 0} />
        <KpiCard label="Win rate" value={fmtPct(summary.win_rate_pct, false)} />
        <KpiCard label="Avg PnL" value={fmtPct(summary.avg_pnl_pct)} intent={(summary.avg_pnl_pct || 0) >= 0 ? "profit" : "loss"} />
        <KpiCard label="Net PnL" value={fmtUsd(summary.total_pnl_usd)} intent={(summary.total_pnl_usd || 0) >= 0 ? "profit" : "loss"} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Cumulative PnL (USD)</CardTitle>
        </CardHeader>
        <CardContent>{series.length ? <PnlLineChart data={series} /> : <EmptyState message="No closed positions yet." />}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Lessons ({lessons.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {lessons.length ? (
            lessons.slice(0, 40).map((l) => (
              <div key={l.id} className="flex items-start gap-2 border-b pb-2 text-sm last:border-0">
                {l.pinned && <Badge variant="secondary">pinned</Badge>}
                <span>{l.rule}</span>
                {l.tags?.length ? <span className="ml-auto shrink-0 text-xs text-muted-foreground">{l.tags.join(", ")}</span> : null}
              </div>
            ))
          ) : (
            <EmptyState message="No lessons yet." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
