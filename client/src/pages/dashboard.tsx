import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Wallet, 
  Users, 
  Bell, 
  TrendingUp,
  Plus,
  ExternalLink,
  Copy,
  Check
} from "lucide-react";
import { SiTelegram, SiSolana } from "react-icons/si";
import { Link } from "wouter";
import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";

export default function Dashboard() {
  const { user } = usePrivy();
  const [copied, setCopied] = useState(false);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["/api/user/profile"],
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/user/stats"],
  });

  const { data: recentAlerts, isLoading: alertsLoading } = useQuery({
    queryKey: ["/api/alerts", "recent"],
  });

  const walletAddress = user?.wallet?.address || profile?.solanaPubkey;

  const copyAddress = () => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-dashboard-title">Dashboard</h1>
            <p className="text-muted-foreground mt-1">Welcome back! Here's your trading overview.</p>
          </div>
          <div className="flex gap-3">
            <Link href="/influencers">
              <Button data-testid="button-add-influencer">
                <Plus className="w-4 h-4 mr-2" />
                Add Influencer
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Wallet Balance</CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <>
                  <div className="text-2xl font-bold" data-testid="text-balance">
                    ${stats?.usdcBalance || "0.00"}
                  </div>
                  <p className="text-xs text-muted-foreground">USDC on Solana</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Influencers</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <div className="text-2xl font-bold" data-testid="text-influencer-count">
                    {stats?.influencerCount || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">Following</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Alerts Today</CardTitle>
              <Bell className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <div className="text-2xl font-bold" data-testid="text-alerts-today">
                    {stats?.alertsToday || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">Actionable signals</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Trades</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <div className="text-2xl font-bold" data-testid="text-trade-count">
                    {stats?.tradeCount || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">Executed</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SiSolana className="w-5 h-5 text-primary" />
                Your Wallet
              </CardTitle>
              <CardDescription>Deposit USDC to start trading</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {profileLoading ? (
                <Skeleton className="h-12 w-full" />
              ) : walletAddress ? (
                <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50 border border-border">
                  <code className="flex-1 text-sm font-mono truncate" data-testid="text-wallet-address">
                    {walletAddress}
                  </code>
                  <Button size="icon" variant="ghost" onClick={copyAddress} data-testid="button-copy-address">
                    {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              ) : (
                <p className="text-muted-foreground">Connect your wallet to get started</p>
              )}
              
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" data-testid="button-view-explorer">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View on Explorer
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SiTelegram className="w-5 h-5 text-[#0088cc]" />
                Telegram Alerts
              </CardTitle>
              <CardDescription>Get notified when signals are detected</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {profileLoading ? (
                <Skeleton className="h-12 w-full" />
              ) : profile?.telegramChatId ? (
                <div className="flex items-center gap-3 p-3 rounded-md bg-primary/10 border border-primary/20">
                  <Check className="w-5 h-5 text-primary" />
                  <div>
                    <p className="font-medium text-sm">Connected</p>
                    <p className="text-xs text-muted-foreground">@{profile.telegramUsername || "Unknown"}</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50 border border-border">
                  <Bell className="w-5 h-5 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Not connected</p>
                </div>
              )}
              
              <Button 
                variant={profile?.telegramChatId ? "outline" : "default"} 
                className="w-full"
                data-testid="button-connect-telegram"
              >
                <SiTelegram className="w-4 h-4 mr-2" />
                {profile?.telegramChatId ? "Manage Connection" : "Connect Telegram"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent Alerts</CardTitle>
              <CardDescription>Latest actionable signals from your influencers</CardDescription>
            </div>
            <Link href="/alerts">
              <Button variant="ghost" size="sm" data-testid="button-view-all-alerts">
                View All
                <ExternalLink className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {alertsLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : recentAlerts?.length > 0 ? (
              <div className="space-y-4">
                {recentAlerts.slice(0, 5).map((alert: any) => (
                  <div 
                    key={alert.id} 
                    className="flex items-center justify-between p-4 rounded-md bg-muted/30 border border-border hover-elevate"
                    data-testid={`alert-item-${alert.id}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-2 h-2 rounded-full ${
                        alert.action === "BUY" ? "bg-green-500" : "bg-red-500"
                      }`} />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{alert.ticker}</span>
                          <Badge variant={alert.action === "BUY" ? "default" : "destructive"}>
                            {alert.action}
                          </Badge>
                          <Badge variant="secondary">{Math.round(alert.confidence * 100)}%</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          @{alert.influencerHandle}
                        </p>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" data-testid={`button-trade-${alert.id}`}>
                      Trade
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Bell className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No alerts yet</p>
                <p className="text-sm mt-1">Add influencers to start receiving signals</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
