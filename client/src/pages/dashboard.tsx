import { useQuery, useMutation } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  Bell,
  TrendingUp,
  Plus,
  ArrowRight,
  ExternalLink,
  Copy,
  Check,
  Loader2,
  Wallet,
  CircleCheck,
  Circle
} from "lucide-react";
import { SiTelegram } from "react-icons/si";
import { Link } from "wouter";
import { useState, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { SignalBadge } from "@/components/SignalBadge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface UserProfile {
  id: number;
  email?: string;
  solanaPubkey?: string;
  telegramChatId?: string;
  telegramUsername?: string;
  defaultBuyAmountUsd?: string;
  autoExecuteEnabled?: boolean;
}

interface UserStats {
  influencerCount: number;
  alertsToday: number;
  tradeCount: number;
}

interface AlertItem {
  id: number;
  ticker: string;
  action: string;
  sentiment?: string;
  confidence?: string;
  tweetText?: string;
  influencerHandle?: string;
  createdAt: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function Dashboard() {
  const { user, authenticated } = usePrivy();
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const telegramPollRef = useRef<NodeJS.Timeout | null>(null);

  const { data: profile, isLoading: profileLoading } = useQuery<UserProfile>({
    queryKey: ["/api/user/profile"],
    enabled: authenticated,
  });

  const { data: stats, isLoading: statsLoading } = useQuery<UserStats>({
    queryKey: ["/api/user/stats"],
    enabled: authenticated,
  });

  const { data: portfolioData, isLoading: portfolioLoading } = useQuery<{
    holdings: any[];
    usdcBalance: number;
    totalValue: number;
  }>({
    queryKey: ["/api/portfolio/holdings"],
    enabled: authenticated,
  });

  const { data: recentAlerts, isLoading: alertsLoading } = useQuery<AlertItem[]>({
    queryKey: ["/api/alerts"],
    enabled: authenticated,
  });

  const walletAddress = user?.wallet?.address || profile?.solanaPubkey;

  const copyAddress = () => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      toast({ title: "Address copied", description: "Send USDC (Solana) to this address to fund your account." });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Stop polling when Telegram becomes connected
  useEffect(() => {
    if (profile?.telegramChatId && telegramPollRef.current) {
      clearInterval(telegramPollRef.current);
      telegramPollRef.current = null;
      toast({
        title: "Telegram Connected!",
        description: "You'll now receive trading alerts in Telegram.",
      });
    }
  }, [profile?.telegramChatId, toast]);

  const connectTelegramMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("GET", "/api/telegram/link");
    },
    onSuccess: (data) => {
      if (data.deepLink) {
        window.open(data.deepLink, "_blank");
        toast({
          title: "Opening Telegram",
          description: "Click 'Start' in the Telegram bot to complete the connection.",
        });
        let pollCount = 0;
        const maxPolls = 30;
        if (telegramPollRef.current) clearInterval(telegramPollRef.current);
        telegramPollRef.current = setInterval(() => {
          pollCount++;
          if (pollCount >= maxPolls) {
            if (telegramPollRef.current) clearInterval(telegramPollRef.current);
            telegramPollRef.current = null;
            return;
          }
          queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
        }, 2000);
      }
    },
    onError: () => {
      toast({
        title: "Connection failed",
        description: "Could not generate Telegram link. Please try again.",
        variant: "destructive",
      });
    },
  });

  const telegramConnected = !!profile?.telegramChatId;
  const hasTraders = (stats?.influencerCount || 0) > 0;
  const hasFunds = (portfolioData?.usdcBalance || 0) > 0;
  const setupComplete = telegramConnected && hasTraders && hasFunds;

  const setupSteps = [
    {
      done: telegramConnected,
      label: "Connect Telegram",
      description: "Signals arrive as Telegram messages with one-tap trade buttons",
      cta: (
        <Button
          size="sm"
          onClick={() => connectTelegramMutation.mutate()}
          disabled={connectTelegramMutation.isPending || !authenticated}
          data-testid="button-connect-telegram"
        >
          {connectTelegramMutation.isPending
            ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            : <SiTelegram className="w-4 h-4 mr-2" />}
          Connect
        </Button>
      ),
    },
    {
      done: hasTraders,
      label: "Follow a trader",
      description: "Paste an X profile and we watch their calls for you",
      cta: (
        <Link href="/influencers">
          <Button size="sm" variant="secondary" data-testid="button-setup-add-trader">
            <Plus className="w-4 h-4 mr-2" />
            Add
          </Button>
        </Link>
      ),
    },
    {
      done: hasFunds,
      label: "Deposit USDC",
      description: "Fund your embedded Solana wallet to enable one-tap buys",
      cta: (
        <Button size="sm" variant="secondary" onClick={copyAddress} disabled={!walletAddress} data-testid="button-setup-copy-address">
          {copied ? <Check className="w-4 h-4 mr-2 text-bull" /> : <Copy className="w-4 h-4 mr-2" />}
          Copy address
        </Button>
      ),
    },
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Balance hero */}
        <div className="rise-in rounded-xl border border-card-border bg-gradient-to-br from-card to-background p-6 md:p-8 relative overflow-hidden">
          <div className="absolute inset-0 bg-grid fade-grid opacity-40 pointer-events-none" />
          <div className="relative flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Portfolio value</p>
              {portfolioLoading ? (
                <Skeleton className="h-12 w-48 mt-2" />
              ) : (
                <p className="text-num text-4xl md:text-5xl font-semibold mt-1" data-testid="text-total-value">
                  ${(portfolioData?.totalValue ?? 0).toFixed(2)}
                </p>
              )}
              <p className="text-sm text-muted-foreground mt-2 flex items-center gap-2">
                <Wallet className="w-3.5 h-3.5" />
                <span className="text-num" data-testid="text-usdc-balance">
                  ${(portfolioData?.usdcBalance ?? 0).toFixed(2)}
                </span>
                USDC ready to trade
              </p>
            </div>
            <div className="flex gap-2">
              <Link href="/influencers">
                <Button data-testid="button-add-influencer">
                  <Plus className="w-4 h-4 mr-2" />
                  Follow a trader
                </Button>
              </Link>
              <Link href="/portfolio">
                <Button variant="outline" data-testid="button-view-portfolio">
                  Portfolio
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Setup checklist — only until everything is wired up */}
        {!profileLoading && !setupComplete && (
          <Card className="rise-in border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="w-6 h-6 rounded-md bg-primary/15 text-primary flex items-center justify-center text-xs font-bold text-num">
                  {setupSteps.filter(s => s.done).length}/3
                </span>
                Finish setting up
              </CardTitle>
              <CardDescription>Three steps to your first one-tap trade</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {setupSteps.map((step) => (
                <div
                  key={step.label}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover-elevate"
                >
                  {step.done ? (
                    <CircleCheck className="w-5 h-5 text-bull shrink-0" />
                  ) : (
                    <Circle className="w-5 h-5 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${step.done ? "line-through text-muted-foreground" : ""}`}>
                      {step.label}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{step.description}</p>
                  </div>
                  {!step.done && step.cta}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Stats */}
        <div className="grid gap-3 grid-cols-3">
          {[
            { label: "Traders followed", value: stats?.influencerCount, icon: Users, testId: "text-influencer-count" },
            { label: "Signals today", value: stats?.alertsToday, icon: Bell, testId: "text-alerts-today" },
            { label: "Trades executed", value: stats?.tradeCount, icon: TrendingUp, testId: "text-trade-count" },
          ].map((stat) => (
            <Card key={stat.label} className="rise-in">
              <CardContent className="p-4 md:p-5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{stat.label}</p>
                  <stat.icon className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                {statsLoading ? (
                  <Skeleton className="h-8 w-12 mt-2" />
                ) : (
                  <p className="text-num text-2xl md:text-3xl font-semibold mt-1" data-testid={stat.testId}>
                    {stat.value ?? 0}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Signal feed */}
        <Card className="rise-in">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <div>
              <CardTitle className="text-base">Latest signals</CardTitle>
              <CardDescription>AI-classified calls from traders you follow</CardDescription>
            </div>
            <Link href="/alerts">
              <Button variant="ghost" size="sm" data-testid="button-view-all-alerts">
                View all
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="pt-0">
            {alertsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : recentAlerts && recentAlerts.length > 0 ? (
              <div className="divide-y divide-border">
                {recentAlerts.slice(0, 5).map((alert) => (
                  <div
                    key={alert.id}
                    className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0"
                    data-testid={`alert-item-${alert.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-sm">${alert.ticker}</span>
                        <SignalBadge action={alert.action} confidence={alert.confidence} size="sm" />
                        <span className="text-xs text-muted-foreground">
                          @{alert.influencerHandle} · {timeAgo(alert.createdAt)}
                        </span>
                      </div>
                      {alert.tweetText && (
                        <p className="text-sm text-muted-foreground truncate mt-1">
                          {alert.tweetText}
                        </p>
                      )}
                    </div>
                    <Link href={`/trade/confirm?alertId=${alert.id}`}>
                      <Button size="sm" variant={alert.action === "SELL" ? "outline" : "default"} data-testid={`button-trade-${alert.id}`}>
                        Trade
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="w-12 h-12 mx-auto rounded-xl bg-muted flex items-center justify-center mb-4">
                  <Bell className="w-5 h-5 text-muted-foreground" />
                </div>
                <p className="font-medium">No signals yet</p>
                <p className="text-sm text-muted-foreground mt-1 mb-4">
                  Follow traders and their calls will show up here
                </p>
                <Link href="/influencers">
                  <Button variant="outline" size="sm">
                    <Plus className="w-4 h-4 mr-2" />
                    Follow a trader
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Wallet address for deposits */}
        <Card className="rise-in">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Deposit address · Solana USDC</p>
              {profileLoading ? (
                <Skeleton className="h-6 w-full max-w-md" />
              ) : walletAddress ? (
                <code className="text-num text-xs md:text-sm text-foreground/90 break-all" data-testid="text-wallet-address">
                  {walletAddress}
                </code>
              ) : (
                <p className="text-sm text-muted-foreground">Log in to create your embedded wallet</p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={copyAddress} disabled={!walletAddress} data-testid="button-copy-address">
                {copied ? <Check className="w-4 h-4 mr-2 text-bull" /> : <Copy className="w-4 h-4 mr-2" />}
                Copy
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!walletAddress}
                onClick={() => walletAddress && window.open(`https://solscan.io/account/${walletAddress}`, "_blank")}
                data-testid="button-view-explorer"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Solscan
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
