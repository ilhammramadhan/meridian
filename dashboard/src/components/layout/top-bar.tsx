import { Bell, Moon, Search, Sun } from "lucide-react";
import { MarketTicker } from "./market-ticker";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "@/lib/theme";
import { useAgentStatus } from "@/lib/queries";

export function TopBar() {
  const { theme, toggleTheme } = useTheme();
  const { data: status } = useAgentStatus();
  const s = (status || {}) as { dryRun?: boolean; busy?: boolean; paper?: boolean };
  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-background px-4">
      <SidebarTrigger className="-ml-1" />
      <MarketTicker />
      <div className="flex-1" />
      <div className="relative hidden md:block">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search…" className="h-9 w-56 pl-8" />
      </div>
      {s.paper ? (
        <Badge className="bg-chart-3 text-white">PAPER</Badge>
      ) : s.dryRun ? (
        <Badge variant="secondary">DRY-RUN</Badge>
      ) : (
        <Badge className="bg-[var(--loss)] text-white">LIVE</Badge>
      )}
      <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-9 w-9">
        {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </Button>
      <Button variant="ghost" size="icon" className="relative h-9 w-9">
        <Bell className="h-4 w-4" />
        {s.busy && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" />}
      </Button>
      <Avatar className="h-8 w-8">
        <AvatarFallback>AG</AvatarFallback>
      </Avatar>
    </header>
  );
}
