import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Bell, 
  TrendingUp, 
  TrendingDown,
  ExternalLink,
  Clock,
  Check,
  X,
  AlertCircle
} from "lucide-react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { formatDistanceToNow } from "date-fns";

function AlertCard({ alert, defaultAmount }: { alert: any; defaultAmount: number }) {
  const isBuy = alert.action === "BUY";
  const isSell = alert.action === "SELL";
  const quickAmount = Math.max(1, Math.round(defaultAmount));
  const largerAmount = Math.max(quickAmount + 1, Math.round(quickAmount * 2.5));

  const statusColors: Record<string, string> = {
    SENT: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    CLICKED: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    EXECUTED: "bg-green-500/10 text-green-500 border-green-500/20",
    IGNORED: "bg-gray-500/10 text-gray-500 border-gray-500/20",
    FAILED: "bg-red-500/10 text-red-500 border-red-500/20",
  };

  const statusIcons: Record<string, any> = {
    SENT: Bell,
    CLICKED: Clock,
    EXECUTED: Check,
    IGNORED: X,
    FAILED: AlertCircle,
  };

  const StatusIcon = statusIcons[alert.status] || Bell;

  return (
    <Card className="hover-elevate" data-testid={`alert-card-${alert.id}`}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                isSell ? "bg-red-500/10" : "bg-green-500/10"
              }`}>
                {isSell ? (
                  <TrendingDown className="w-5 h-5 text-red-500" />
                ) : (
                  <TrendingUp className="w-5 h-5 text-green-500" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold">${alert.ticker}</span>
                  <Badge variant={isBuy ? "default" : isSell ? "destructive" : "secondary"}>
                    {isBuy || isSell ? alert.action : "Mention"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  @{alert.influencerHandle} · {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
                </p>
              </div>
            </div>

            {alert.tweetText && (
              <p className="text-sm text-muted-foreground line-clamp-2 pl-13">
                "{alert.tweetText}"
              </p>
            )}

            <div className="flex items-center gap-3 pl-13">
              <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs border ${statusColors[alert.status]}`}>
                <StatusIcon className="w-3 h-3" />
                <span>{alert.status}</span>
              </div>
              {alert.sentiment && alert.sentiment !== "NEUTRAL" && (
                <Badge variant="outline" className="text-xs">
                  {alert.sentiment}
                </Badge>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {alert.status === "SENT" && (
              <>
                <Link href={`/trade/confirm?alertId=${alert.id}&amount=${quickAmount}`}>
                  <Button size="sm" className="w-full" data-testid={`button-buy-${quickAmount}-${alert.id}`}>
                    Buy ${quickAmount}
                  </Button>
                </Link>
                <Link href={`/trade/confirm?alertId=${alert.id}&amount=${largerAmount}`}>
                  <Button size="sm" variant="outline" className="w-full" data-testid={`button-buy-${largerAmount}-${alert.id}`}>
                    Buy ${largerAmount}
                  </Button>
                </Link>
              </>
            )}
            {alert.tweetUrl && (
              <Button size="sm" variant="ghost" asChild>
                <a href={alert.tweetUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4 mr-1" />
                  Tweet
                </a>
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Alerts() {
  const { data: alerts, isLoading } = useQuery<any[]>({
    queryKey: ["/api/alerts"],
  });

  const { data: profile } = useQuery<{ defaultBuyAmountUsd?: string }>({
    queryKey: ["/api/user/profile"],
  });
  const defaultAmount = parseFloat(profile?.defaultBuyAmountUsd || "10");

  const pendingAlerts = alerts?.filter((a: any) => a.status === "SENT") || [];
  const executedAlerts = alerts?.filter((a: any) => a.status === "EXECUTED") || [];
  const allAlerts = alerts || [];

  return (
    <AppLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-alerts-title">Alerts</h1>
          <p className="text-muted-foreground mt-1">View and act on trading signals from your influencers</p>
        </div>

        <Tabs defaultValue="pending" className="w-full">
          <TabsList>
            <TabsTrigger value="pending" data-testid="tab-pending">
              Pending
              {pendingAlerts.length > 0 && (
                <Badge variant="default" className="ml-2">{pendingAlerts.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="executed" data-testid="tab-executed">Executed</TabsTrigger>
            <TabsTrigger value="all" data-testid="tab-all">All</TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="mt-6">
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-32 w-full" />
                ))}
              </div>
            ) : pendingAlerts.length > 0 ? (
              <div className="space-y-4">
                {pendingAlerts.map((alert: any) => (
                  <AlertCard key={alert.id} alert={alert} defaultAmount={defaultAmount} />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-16 text-center">
                  <Bell className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-xl font-semibold mb-2">No pending alerts</h3>
                  <p className="text-muted-foreground">
                    New signals will appear here when detected
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="executed" className="mt-6">
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-32 w-full" />
                ))}
              </div>
            ) : executedAlerts.length > 0 ? (
              <div className="space-y-4">
                {executedAlerts.map((alert: any) => (
                  <AlertCard key={alert.id} alert={alert} defaultAmount={defaultAmount} />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-16 text-center">
                  <Check className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-xl font-semibold mb-2">No executed trades</h3>
                  <p className="text-muted-foreground">
                    Trades you execute will appear here
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="all" className="mt-6">
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-32 w-full" />
                ))}
              </div>
            ) : allAlerts.length > 0 ? (
              <div className="space-y-4">
                {allAlerts.map((alert: any) => (
                  <AlertCard key={alert.id} alert={alert} defaultAmount={defaultAmount} />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-16 text-center">
                  <Bell className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-xl font-semibold mb-2">No alerts yet</h3>
                  <p className="text-muted-foreground">
                    Add influencers to start receiving trading signals
                  </p>
                  <Link href="/influencers">
                    <Button className="mt-4">Add Influencers</Button>
                  </Link>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
