import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ArrowLeft,
  ExternalLink,
  Bell,
  Clock,
  RefreshCw,
} from "lucide-react";
import { SiX } from "react-icons/si";
import { AppLayout } from "@/components/layout/AppLayout";
import { SignalBadge } from "@/components/SignalBadge";
import { formatDistanceToNow } from "date-fns";

interface InfluencerDetail {
  id: number;
  platform: string;
  handle: string;
  profileUrl: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  lastPolledAt?: string | null;
  createdAt: string;
  alertCount?: number;
  tweetCount?: number;
}

interface TickerCall {
  // Classifier stores calls under `symbol`; older records may use `ticker`.
  symbol?: string;
  ticker?: string;
  action?: string | null;
  sentiment?: string | null;
  confidence?: number | string | null;
}

interface TweetClassification {
  isActionable: boolean;
  tickers?: TickerCall[];
}

interface TweetItem {
  id: number;
  tweetId: string;
  text: string;
  url: string;
  tweetCreatedAt?: string | null;
  ingestedAt: string;
  classification?: TweetClassification | null;
}

interface SubscriptionInfo {
  id: number;
  enabled: boolean;
}

export default function InfluencerDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: influencer, isLoading } = useQuery<InfluencerDetail>({
    queryKey: ["/api/influencers", id],
    enabled: !!id,
  });

  const { data: tweets, isLoading: tweetsLoading } = useQuery<TweetItem[]>({
    queryKey: ["/api/influencers", id, "tweets"],
    enabled: !!id,
  });

  const { data: subscription } = useQuery<SubscriptionInfo>({
    queryKey: ["/api/subscriptions/influencer", id],
    enabled: !!id,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ enabled }: { enabled: boolean }) =>
      apiRequest("PATCH", `/api/subscriptions/${subscription?.id}`, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions"] });
    },
  });

  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  const stats = [
    {
      label: "Signals",
      icon: Bell,
      value: <span className="text-num text-xl md:text-2xl font-semibold">{influencer?.alertCount || 0}</span>,
    },
    {
      label: "Tweets tracked",
      icon: RefreshCw,
      value: <span className="text-num text-xl md:text-2xl font-semibold">{influencer?.tweetCount || 0}</span>,
    },
    {
      label: "Last checked",
      icon: Clock,
      value: (
        <span className="text-num text-sm md:text-base font-medium">
          {influencer?.lastPolledAt
            ? formatDistanceToNow(new Date(influencer.lastPolledAt), { addSuffix: true })
            : "Never"}
        </span>
      ),
    },
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Trader header card */}
        <div className="rise-in rounded-xl border border-card-border bg-gradient-to-br from-card to-background p-6 md:p-8 relative overflow-hidden">
          <div className="absolute inset-0 bg-grid fade-grid opacity-40 pointer-events-none" />
          <div className="relative">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <Link href="/influencers">
                  <Button variant="ghost" size="icon" className="shrink-0" data-testid="button-back">
                    <ArrowLeft className="w-5 h-5" />
                  </Button>
                </Link>
                <Avatar className="w-14 h-14 md:w-16 md:h-16 border border-border shrink-0">
                  <AvatarImage src={influencer?.avatarUrl ?? undefined} />
                  <AvatarFallback className="bg-primary/10 text-primary">
                    <SiX className="w-6 h-6" />
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <h1 className="font-display text-xl md:text-2xl font-bold truncate" data-testid="text-influencer-name">
                    {influencer?.displayName || influencer?.handle}
                  </h1>
                  <p className="text-sm text-muted-foreground font-mono truncate">@{influencer?.handle}</p>
                </div>
              </div>

              <div className="flex items-center gap-4 shrink-0 pl-14 sm:pl-0">
                <div className="flex flex-col items-center gap-1">
                  <Switch
                    checked={subscription?.enabled}
                    onCheckedChange={(enabled) => toggleMutation.mutate({ enabled })}
                    data-testid="switch-alerts"
                  />
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Signals
                  </span>
                </div>
                <Button variant="outline" asChild>
                  <a href={influencer?.profileUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    View on X
                  </a>
                </Button>
              </div>
            </div>

            {/* Stats */}
            <div className="mt-6 grid grid-cols-3 gap-3">
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-lg border border-border bg-card/60 p-3 md:p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{stat.label}</p>
                    <stat.icon className="w-3.5 h-3.5 text-muted-foreground hidden sm:block" />
                  </div>
                  <div className="mt-1">{stat.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tweet timeline */}
        <Card className="rise-in">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Tradeable posts</CardTitle>
            <CardDescription>Recent posts mentioning tokenized stocks you can trade</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {tweetsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-24 w-full rounded-lg" />
                ))}
              </div>
            ) : tweets && tweets.length > 0 ? (
              <div className="space-y-3">
                {tweets.map((tweet) => {
                  const calls = tweet.classification?.tickers || [];
                  return (
                    <div
                      key={tweet.id}
                      className="rounded-lg border border-border bg-muted/20 p-4 space-y-3 hover-elevate"
                      data-testid={`tweet-item-${tweet.id}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm leading-relaxed flex-1 min-w-0">{tweet.text}</p>
                        <a
                          href={tweet.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          aria-label="Open post on X"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </div>

                      <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
                        {calls.map((call, i) => {
                          const symbol = call.symbol || call.ticker;
                          if (!symbol) return null;
                          return (
                            <span key={`${symbol}-${i}`} className="inline-flex items-center gap-1.5">
                              <span className="font-mono font-bold text-xs">${symbol}</span>
                              <SignalBadge action={call.action} confidence={call.confidence} size="sm" />
                            </span>
                          );
                        })}
                        <span className="text-num text-xs text-muted-foreground ml-auto">
                          {formatDistanceToNow(
                            new Date(tweet.tweetCreatedAt || tweet.ingestedAt),
                            { addSuffix: true }
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="w-12 h-12 mx-auto rounded-xl bg-muted flex items-center justify-center mb-4">
                  <RefreshCw className="w-5 h-5 text-muted-foreground" />
                </div>
                <p className="font-medium">No tradeable posts yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Only posts mentioning tradeable tickers appear here
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
