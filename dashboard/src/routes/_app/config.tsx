import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/common/page-header";
import { useConfig } from "@/lib/queries";
import { useAction } from "@/hooks/use-action";
import { setConfig } from "@/lib/server/meridian/controls";

export const Route = createFileRoute("/_app/config")({ component: Config });

function Config() {
  const { data } = useConfig();
  const cfg = (data || {}) as Record<string, any>;
  const save = useAction(setConfig as any, { invalidate: [["config"]], success: "Config updated" });
  const sections = ["risk", "screening", "management", "strategy", "schedule", "llm", "darwin"].filter((s) => cfg[s]);

  return (
    <div className="space-y-6">
      <PageHeader title="Config & Strategy" subtitle="Live runtime config — edits call update_config on the agent" />
      {sections.length ? (
        sections.map((sec) => (
          <Card key={sec}>
            <CardHeader>
              <CardTitle className="capitalize">{sec}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {Object.entries(cfg[sec]).map(([k, v]) =>
                typeof v === "object" && v !== null ? null : (
                  <ConfigField key={k} keyName={k} value={v} onSave={(val) => save.mutate({ key: k, value: String(val) })} />
                ),
              )}
            </CardContent>
          </Card>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">Loading config…</p>
      )}
    </div>
  );
}

function ConfigField({ keyName, value, onSave }: { keyName: string; value: any; onSave: (v: string) => void }) {
  const [v, setV] = useState(String(value));
  const dirty = v !== String(value);
  return (
    <div className="flex items-center gap-2">
      <label className="w-44 shrink-0 truncate text-xs text-muted-foreground" title={keyName}>
        {keyName}
      </label>
      <Input value={v} onChange={(e) => setV(e.target.value)} className="h-8" />
      {dirty && (
        <Button size="sm" onClick={() => onSave(v)}>
          Save
        </Button>
      )}
    </div>
  );
}
