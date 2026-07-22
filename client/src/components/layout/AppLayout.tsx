import { Link, useLocation } from "wouter";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Users,
  Bell,
  Wallet,
  Settings,
  LogOut,
  Zap,
  Shield
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

interface UserProfile {
  isAdmin?: boolean;
}

const navItems = [
  { path: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { path: "/influencers", label: "Traders", icon: Users },
  { path: "/alerts", label: "Signals", icon: Bell },
  { path: "/portfolio", label: "Portfolio", icon: Wallet },
  { path: "/settings", label: "Settings", icon: Settings },
];

const pageTitles: Record<string, string> = {
  "/dashboard": "Overview",
  "/influencers": "Traders",
  "/alerts": "Signals",
  "/portfolio": "Portfolio",
  "/settings": "Settings",
  "/admin": "Asset Registry",
};

function AppSidebar() {
  const [location] = useLocation();
  const { user, logout, authenticated } = usePrivy();

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/user/profile"],
    enabled: authenticated,
  });

  const userEmail = user?.email?.address || user?.wallet?.address?.slice(0, 8) + "...";
  const userInitial = userEmail ? userEmail[0].toUpperCase() : "U";
  const isAdmin = profile?.isAdmin || false;

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border px-4 py-5">
        <Link href="/dashboard">
          <div className="flex items-center gap-3 cursor-pointer group">
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center glow-volt transition-shadow group-hover:shadow-[0_0_32px_hsl(var(--primary)/0.4)]">
              <Zap className="w-5 h-5 text-primary-foreground" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold leading-none text-foreground">ARENA</h1>
              <p className="text-[11px] text-muted-foreground mt-1 tracking-wide uppercase">Trade the signal</p>
            </div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="pt-2">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1 px-2">
              {navItems.map((item) => {
                const isActive = location === item.path || location.startsWith(item.path + "/");
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      className="h-10 rounded-lg data-[active=true]:bg-sidebar-accent data-[active=true]:text-primary"
                    >
                      <Link href={item.path}>
                        <item.icon className="w-4 h-4" strokeWidth={isActive ? 2.5 : 2} />
                        <span className={isActive ? "font-semibold" : ""}>{item.label}</span>
                        {isActive && <span className="ml-auto w-1 h-4 rounded-full bg-primary" />}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="px-4">Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1 px-2">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/admin"}
                    className="h-10 rounded-lg data-[active=true]:bg-sidebar-accent data-[active=true]:text-primary"
                  >
                    <Link href="/admin">
                      <Shield className="w-4 h-4" />
                      <span>Asset Registry</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
          <Avatar className="w-8 h-8">
            <AvatarFallback className="bg-primary/15 text-primary text-sm font-semibold">
              {userInitial}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{userEmail}</p>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-bull pulse-dot" />
              Connected
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => logout()}
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const title = pageTitles[location] ||
    (location.startsWith("/influencers/") ? "Trader" : "Arena");

  const sidebarStyle = {
    "--sidebar-width": "15rem",
    "--sidebar-width-icon": "3rem",
  } as React.CSSProperties;

  return (
    <SidebarProvider style={sidebarStyle}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="glass sticky top-0 z-20 flex items-center gap-3 px-4 h-14 border-b border-border">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <span className="font-display text-sm font-semibold text-foreground">{title}</span>
            <div className="ml-auto flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-bull pulse-dot" />
              Signals live
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <div className="max-w-6xl mx-auto px-4 py-6 md:px-8 md:py-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
