import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { WeightBarsChart } from "@/components/charts/weight-bars-chart";
import { useDiscordSignals, useSignalWeights, useSmartWallets } from "@/lib/queries";
import { fmtAgo, shortAddr } from "@/lib/format";

export const Route = createFileRoute("/_app/signals")({ component: Signals });

function Signals() {
  const { data: w } = useSignalWeights();
  const { data: sw } = useSmartWallets();
  const { data: disc } = useDiscordSignals();
  const weights = ((w as any)?.weights || {}) as Record<string, number>;
  const wd = Object.entries(weights).map(([name, weight]) => ({ name, weight: Number(weight) || 0 }));
  const wallets = ((sw as any)?.wallets || []) as any[];
  const signals = ((disc as any)?.signals || []) as any[];

  return (
    <div className="space-y-6">
      <PageHeader title="Signals" subtitle="Darwin signal weights, smart wallets, Discord queue" />
      <Card>
        <CardHeader>
          <CardTitle>Darwin signal weights</CardTitle>
        </CardHeader>
        <CardContent>{wd.length ? <WeightBarsChart data={wd} /> : <EmptyState message="Weights are neutral until ≥10 closes." />}</CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Smart wallets ({wallets.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {wallets.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wallets.map((x, i) => (
                    <TableRow key={i}>
                      <TableCell>{x.name}</TableCell>
                      <TableCell className="font-mono text-xs">{shortAddr(x.address)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{x.type || x.category}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState message="No tracked wallets." />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Discord queue ({signals.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {signals.length ? (
              signals.slice(0, 12).map((s) => (
                <div key={s.id} className="flex items-center gap-2 border-b pb-1 text-sm last:border-0">
                  <Badge variant={s.status === "pending" ? "default" : "secondary"}>{s.status}</Badge>
                  <span>{s.base_symbol || shortAddr(s.base_mint)}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{fmtAgo(s.queued_at)}</span>
                </div>
              ))
            ) : (
              <EmptyState message="No Discord signals." />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
