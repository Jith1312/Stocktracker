import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  ArrowLeft,
  ExternalLink,
  Bell,
  TrendingUp,
  TrendingDown,
  Clock,
  RefreshCw
} from "lucide-react";
import { SiX } from "react-icons/si";
import { AppLayout } from "@/components/layout/AppLayout";
import { formatDistanceToNow } from "date-fns";

export default function InfluencerDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: influencer, isLoading } = useQuery({
    queryKey: ["/api/influencers", id],
    enabled: !!id,
  });

  const { data: tweets, isLoading: tweetsLoading } = useQuery({
    queryKey: ["/api/influencers", id, "tweets"],
    enabled: !!id,
  });

  const { data: subscription } = useQuery({
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
        <div className="space-y-8">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/influencers">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-4">
              <Avatar className="w-16 h-16">
                <AvatarImage src={influencer?.avatarUrl} />
                <AvatarFallback className="bg-primary/10 text-primary text-xl">
                  <SiX className="w-7 h-7" />
                </AvatarFallback>
              </Avatar>
              <div>
                <h1 className="text-2xl font-bold" data-testid="text-influencer-name">
                  {influencer?.displayName || influencer?.handle}
                </h1>
                <p className="text-muted-foreground">@{influencer?.handle}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Alerts</p>
              <Switch 
                checked={subscription?.enabled}
                onCheckedChange={(enabled) => toggleMutation.mutate({ enabled })}
                data-testid="switch-alerts"
              />
            </div>
            <Button variant="outline" asChild>
              <a href={influencer?.profileUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4 mr-2" />
                View Profile
              </a>
            </Button>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Alerts</CardTitle>
              <Bell className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{influencer?.alertCount || 0}</div>
              <p className="text-xs text-muted-foreground">From this influencer</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Tweets Analyzed</CardTitle>
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{influencer?.tweetCount || 0}</div>
              <p className="text-xs text-muted-foreground">Total processed</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Last Polled</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {influencer?.lastPolledAt 
                  ? formatDistanceToNow(new Date(influencer.lastPolledAt), { addSuffix: true })
                  : "Never"
                }
              </div>
              <p className="text-xs text-muted-foreground">Polling every ~2 min</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Ondo-Tradeable Tweets</CardTitle>
            <CardDescription>Last 10 tweets mentioning tickers available on Ondo</CardDescription>
          </CardHeader>
          <CardContent>
            {tweetsLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              </div>
            ) : tweets?.length > 0 ? (
              <div className="space-y-4">
                {tweets.map((tweet: any) => (
                  <div 
                    key={tweet.id} 
                    className="p-4 rounded-lg bg-muted/30 border border-border space-y-3"
                    data-testid={`tweet-item-${tweet.id}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <p className="text-sm flex-1">{tweet.text}</p>
                      <a 
                        href={tweet.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                    
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{formatDistanceToNow(new Date(tweet.tweetCreatedAt || tweet.ingestedAt), { addSuffix: true })}</span>
                      
                      {tweet.classification && (
                        <div className="flex items-center gap-2">
                          {tweet.classification.isActionable ? (
                            <Badge variant="default" className="text-xs">Actionable</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">Not Actionable</Badge>
                          )}
                          
                          {tweet.classification.tickers?.map((ticker: any) => (
                            <Badge 
                              key={ticker.ticker}
                              variant={ticker.action === "BUY" ? "default" : ticker.action === "SELL" ? "destructive" : "outline"}
                              className="text-xs flex items-center gap-1"
                            >
                              {ticker.action === "BUY" ? (
                                <TrendingUp className="w-3 h-3" />
                              ) : ticker.action === "SELL" ? (
                                <TrendingDown className="w-3 h-3" />
                              ) : null}
                              ${ticker.ticker}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <RefreshCw className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No Ondo-tradeable tweets yet</p>
                <p className="text-sm mt-1">Only tweets with tickers available on Ondo will appear here</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
