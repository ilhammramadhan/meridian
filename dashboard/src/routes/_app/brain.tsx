import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { WikiPage } from "@/components/brain/wiki-page";
import { useBrainIndex, useBrainList, useBrainPage } from "@/lib/queries";
import { useAction } from "@/hooks/use-action";
import { brainLint, brainRebuild } from "@/lib/server/meridian/brain";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/brain")({ component: Brain });

function Brain() {
  const { data: list } = useBrainList();
  const { data: idx } = useBrainIndex();
  const [ref, setRef] = useState("");
  const { data: page } = useBrainPage(ref);
  const pages = ((list as any)?.pages || []) as any[];
  const lint = useAction(brainLint as any, { success: "Lint complete" });
  const rebuild = useAction(brainRebuild as any, {
    invalidate: [["brain", "list", "all"], ["brain", "index"]],
    success: "Brain rebuilt",
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Brain" subtitle="The agent's LLM-wiki of learned knowledge">
        <Button variant="outline" onClick={() => lint.mutate(undefined)}>Lint</Button>
        <Button onClick={() => rebuild.mutate(undefined)}>Rebuild</Button>
      </PageHeader>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Pages ({pages.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {pages.length ? (
              <>
                <button
                  onClick={() => setRef("")}
                  className={cn("block w-full rounded-md px-2 py-1 text-left text-sm hover:bg-muted", !ref && "bg-muted font-medium")}
                >
                  Index & Log
                </button>
                {pages.map((p) => (
                  <button
                    key={p.ref}
                    onClick={() => setRef(p.ref)}
                    className={cn("block w-full truncate rounded-md px-2 py-1 text-left text-sm hover:bg-muted", ref === p.ref && "bg-muted font-medium")}
                  >
                    {p.title || p.ref} <span className="ml-1 text-xs text-muted-foreground">{p.type}</span>
                  </button>
                ))}
              </>
            ) : (
              <EmptyState message="Empty brain. Rebuild to backfill from agent memory." />
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{ref || "Index & Log"}</CardTitle>
          </CardHeader>
          <CardContent>
            {ref ? (
              (page as any)?.markdown ? (
                <WikiPage markdown={(page as any).markdown} />
              ) : (
                <p className="text-sm text-muted-foreground">Loading…</p>
              )
            ) : (
              <Tabs defaultValue="index">
                <TabsList>
                  <TabsTrigger value="index">Index</TabsTrigger>
                  <TabsTrigger value="log">Log</TabsTrigger>
                </TabsList>
                <TabsContent value="index">
                  <WikiPage markdown={(idx as any)?.index || "_Empty — rebuild the brain._"} />
                </TabsContent>
                <TabsContent value="log">
                  <WikiPage markdown={(idx as any)?.log || "_No events yet._"} />
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
