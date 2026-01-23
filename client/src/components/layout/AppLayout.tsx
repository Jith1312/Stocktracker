import { Link, useLocation } from "wouter";
import { usePrivy } from "@privy-io/react-auth";
import { 
  LayoutDashboard, 
  Users, 
  Bell, 
  Wallet, 
  Settings,
  LogOut,
  Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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

const navItems = [
  { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { path: "/influencers", label: "Influencers", icon: Users },
  { path: "/alerts", label: "Alerts", icon: Bell },
  { path: "/portfolio", label: "Portfolio", icon: Wallet },
  { path: "/settings", label: "Settings", icon: Settings },
];

function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = usePrivy();

  const userEmail = user?.email?.address || user?.wallet?.address?.slice(0, 8) + "...";
  const userInitial = userEmail ? userEmail[0].toUpperCase() : "U";

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <Link href="/dashboard">
          <div className="flex items-center gap-3 cursor-pointer">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">StockPulse</h1>
              <p className="text-xs text-muted-foreground">Trade on signals</p>
            </div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = location === item.path || location.startsWith(item.path + "/");
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={item.path}>
                        <item.icon className="w-5 h-5" />
                        <span>{item.label}</span>
                        {item.label === "Alerts" && (
                          <Badge variant="default" className="ml-auto text-xs">3</Badge>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Settings</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/admin"}>
                  <Link href="/admin">
                    <Settings className="w-5 h-5" />
                    <span>Admin</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-4">
        <div className="flex items-center gap-3">
          <Avatar className="w-9 h-9">
            <AvatarFallback className="bg-primary/20 text-primary text-sm">
              {userInitial}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{userEmail}</p>
            <p className="text-xs text-muted-foreground">Connected</p>
          </div>
          <Button 
            size="icon" 
            variant="ghost" 
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
  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  } as React.CSSProperties;

  return (
    <SidebarProvider style={sidebarStyle}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center gap-4 p-4 border-b border-border">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
          </header>
          <main className="flex-1 overflow-auto">
            <div className="max-w-7xl mx-auto p-6">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
