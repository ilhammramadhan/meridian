import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  LayoutDashboard,
  Radar,
  Layers,
  BrainCircuit,
  TrendingUp,
  Network,
  ScrollText,
  Settings2,
  PanelLeftClose,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/screening", label: "Screening", icon: Radar },
  { to: "/positions", label: "Positions", icon: Layers },
  { to: "/brain", label: "Brain", icon: BrainCircuit },
  { to: "/performance", label: "Performance", icon: TrendingUp },
  { to: "/signals", label: "Signals", icon: Network },
  { to: "/activity", label: "Activity", icon: ScrollText },
  { to: "/config", label: "Config", icon: Settings2 },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { toggleSidebar } = useSidebar();
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Activity className="h-4 w-4" />
          </div>
          <div className="text-base font-semibold tracking-tight">Meridian</div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => {
                const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={active}>
                      <Link to={item.to}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={toggleSidebar}>
              <PanelLeftClose className="h-4 w-4" />
              <span>Hide menu</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
