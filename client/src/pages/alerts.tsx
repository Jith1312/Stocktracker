import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bell,
  ExternalLink,
  Clock,
  Check,
  X,
  AlertCircle,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { SignalBadge } from "@/components/SignalBadge";
import { formatDistanceToNow } from "date-fns";

interface AlertItem {
  id: number;
  status: string;
  createdAt: string;
  ticker: string;
  sentiment?: string | null;
  action?: string | null;
  confidence?: string | null;
  tweetText?: string | null;
  tweetUrl?: string | null;
  influencerHandle?: string | null;
}

const statusStyles: Record<string, string> = {
  SENT: "border-primary/30 bg-primary/10 text-primary",
  CLICKED: "border-border bg-muted/50 text-muted-foreground",
  EXECUTED: "border-bull/30 bg-bull/10 text-bull",
  IGNORED: "border-border bg-muted/50 text-muted-foreground",
  FAILED: "border-bear/30 bg-bear/10 text-bear",
};

const statusIcons: Record<string, LucideIcon> = {
  SENT: Bell,
  CLICKED: Clock,
  EXECUTED: Check,
  IGNORED: X,
  FAILED: AlertCircle,
};

const statusLabels: Record<string, string> = {
  SENT: "New",
  CLICKED: "Viewed",
  EXECUTED: "Executed",
  IGNORED: "Ignored",
  FAILED: "Failed",
};

function SignalRow({ alert }: { alert: AlertItem }) {
  const StatusIcon = statusIcons[alert.status] || Bell;

  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 py-4 first:pt-0 last:pb-0"
      data-testid={`alert-card-${alert.id}`}
    >
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-bold text-base">${alert.ticker}</span>
          <SignalBadge action={alert.action} confidence={alert.confidence} size="sm" />
          <span
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              statusStyles[alert.status] || statusStyles.CLICKED
            }`}
          >
            <StatusIcon className="w-2.5 h-2.5" />
            {statusLabels[alert.status] || alert.status}
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          {alert.influencerHandle && (
            <span className="font-mono">@{alert.influencerHandle}</span>
          )}
          {alert.influencerHandle && " · "}
          <span className="text-num">
            {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
          </span>
        </p>

        {alert.tweetText && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            &ldquo;{alert.tweetText}&rdquo;
          </p>
        )}

        {alert.tweetUrl && (
          <a
            href={alert.tweetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            View post
          </a>
        )}
      </div>

      {alert.status === "SENT" && (
        <div className="flex sm:flex-col gap-2 shrink-0">
          <Link href={`/trade/confirm?alertId=${alert.id}&amount=10`}>
            <Button
              size="sm"
              className="w-full"
              variant={alert.action === "SELL" ? "outline" : "default"}
              data-testid={`button-buy-10-${alert.id}`}
            >
              Trade $10
            </Button>
          </Link>
          <Link href={`/trade/confirm?alertId=${alert.id}&amount=25`}>
            <Button size="sm" variant="outline" className="w-full" data-testid={`button-buy-25-${alert.id}`}>
              Trade $25
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}

function SignalList({
  alerts,
  isLoading,
  emptyIcon: EmptyIcon,
  emptyTitle,
  emptyDescription,
  emptyCta,
}: {
  alerts: AlertItem[];
  isLoading: boolean;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  emptyDescription: string;
  emptyCta?: React.ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <Card className="rise-in">
        <CardContent className="py-12 text-center">
          <div className="w-12 h-12 mx-auto rounded-xl bg-muted flex items-center justify-center mb-4">
            <EmptyIcon className="w-5 h-5 text-muted-foreground" />
          </div>
          <p className="font-medium">{emptyTitle}</p>
          <p className="text-sm text-muted-foreground mt-1">{emptyDescription}</p>
          {emptyCta && <div className="mt-4">{emptyCta}</div>}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rise-in">
      <CardContent className="p-4 md:p-5">
        <div className="divide-y divide-border">
          {alerts.map((alert) => (
            <SignalRow key={alert.id} alert={alert} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Alerts() {
  const { data: alerts, isLoading } = useQuery<AlertItem[]>({
    queryKey: ["/api/alerts"],
  });

  const pendingAlerts = alerts?.filter((a) => a.status === "SENT") || [];
  const executedAlerts = alerts?.filter((a) => a.status === "EXECUTED") || [];
  const allAlerts = alerts || [];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="rise-in">
          <h1 className="font-display text-2xl md:text-3xl font-bold" data-testid="text-alerts-title">
            Signals
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI-classified calls from the traders you follow — trade them in one tap
          </p>
        </div>

        <Tabs defaultValue="pending" className="w-full">
          <TabsList>
            <TabsTrigger value="pending" data-testid="tab-pending">
              New
              {pendingAlerts.length > 0 && (
                <span className="ml-2 inline-flex items-center justify-center rounded-md bg-primary/15 px-1.5 py-0.5 text-num text-[10px] font-semibold text-primary">
                  {pendingAlerts.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="executed" data-testid="tab-executed">
              Executed
              {executedAlerts.length > 0 && (
                <span className="ml-2 inline-flex items-center justify-center rounded-md bg-muted px-1.5 py-0.5 text-num text-[10px] font-semibold text-muted-foreground">
                  {executedAlerts.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="all" data-testid="tab-all">
              All
              {allAlerts.length > 0 && (
                <span className="ml-2 inline-flex items-center justify-center rounded-md bg-muted px-1.5 py-0.5 text-num text-[10px] font-semibold text-muted-foreground">
                  {allAlerts.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="mt-4">
            <SignalList
              alerts={pendingAlerts}
              isLoading={isLoading}
              emptyIcon={Bell}
              emptyTitle="No new signals"
              emptyDescription="Fresh calls from your traders will land here"
            />
          </TabsContent>

          <TabsContent value="executed" className="mt-4">
            <SignalList
              alerts={executedAlerts}
              isLoading={isLoading}
              emptyIcon={Check}
              emptyTitle="No executed trades"
              emptyDescription="Signals you trade will appear here"
            />
          </TabsContent>

          <TabsContent value="all" className="mt-4">
            <SignalList
              alerts={allAlerts}
              isLoading={isLoading}
              emptyIcon={Bell}
              emptyTitle="No signals yet"
              emptyDescription="Follow traders to start receiving signals"
              emptyCta={
                <Link href="/influencers">
                  <Button variant="outline" size="sm">
                    <Plus className="w-4 h-4 mr-2" />
                    Follow a trader
                  </Button>
                </Link>
              }
            />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
