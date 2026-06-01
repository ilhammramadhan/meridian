import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { LogTail } from "@/components/streams/log-tail";

export const Route = createFileRoute("/_app/activity")({ component: ActivityView });

function ActivityView() {
  return (
    <div className="space-y-6">
      <PageHeader title="Activity" subtitle="Live action trail (logs/actions-*.jsonl)" />
      <Card>
        <CardHeader>
          <CardTitle>Live action trail</CardTitle>
        </CardHeader>
        <CardContent>
          <LogTail />
        </CardContent>
      </Card>
    </div>
  );
}
