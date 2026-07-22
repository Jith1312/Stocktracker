import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Trash2,
  Users,
  Bell,
  TrendingUp,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { SiX } from "react-icons/si";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";

const addInfluencerSchema = z.object({
  profileUrl: z.string().url("Please enter a valid URL").refine(
    (url) => url.includes("twitter.com") || url.includes("x.com"),
    "Please enter a valid X (Twitter) profile URL"
  ),
});

type AddInfluencerForm = z.infer<typeof addInfluencerSchema>;

interface Influencer {
  id: number;
  platform: string;
  handle: string;
  profileUrl: string;
  platformUserId?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  lastPolledAt?: string | null;
  createdAt: string;
}

interface Subscription {
  id: number;
  userId: number;
  influencerId: number;
  enabled: boolean;
  amountOverrideUsd?: string | null;
  createdAt: string;
  influencer?: Influencer;
  alertCount?: number;
  tradeCount?: number;
}

export default function Influencers() {
  const { toast } = useToast();

  const { data: subscriptions, isLoading } = useQuery<Subscription[]>({
    queryKey: ["/api/subscriptions"],
  });

  const form = useForm<AddInfluencerForm>({
    resolver: zodResolver(addInfluencerSchema),
    defaultValues: {
      profileUrl: "",
    },
  });

  const addMutation = useMutation({
    mutationFn: (data: AddInfluencerForm) => apiRequest("POST", "/api/influencers", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions"] });
      form.reset();
      toast({
        title: "Trader added",
        description: "You'll now receive signals from this trader",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to add trader",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiRequest("PATCH", `/api/subscriptions/${id}`, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/subscriptions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions"] });
      toast({
        title: "Trader removed",
        description: "You'll no longer receive signals from this trader",
      });
    },
  });

  const onSubmit = (data: AddInfluencerForm) => {
    addMutation.mutate(data);
  };

  const focusAddInput = () => form.setFocus("profileUrl");

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Add-trader hero */}
        <div className="rise-in rounded-xl border border-card-border bg-gradient-to-br from-card to-background p-6 md:p-8 relative overflow-hidden">
          <div className="absolute inset-0 bg-grid fade-grid opacity-40 pointer-events-none" />
          <div className="relative">
            <h1 className="font-display text-2xl md:text-3xl font-bold" data-testid="text-influencers-title">
              Traders
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-lg">
              Paste an X profile — we watch their calls and turn them into one-tap signals
            </p>

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="mt-5 flex flex-col sm:flex-row gap-2 max-w-xl"
              >
                <FormField
                  control={form.control}
                  name="profileUrl"
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormControl>
                        <Input
                          placeholder="https://x.com/trader"
                          className="h-10 rounded-lg font-mono text-sm"
                          {...field}
                          data-testid="input-profile-url"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="h-10 shrink-0"
                  disabled={addMutation.isPending}
                  data-testid="button-submit-influencer"
                >
                  {addMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4 mr-2" />
                  )}
                  {addMutation.isPending ? "Adding..." : "Follow trader"}
                </Button>
              </form>
            </Form>
          </div>
        </div>

        {/* Following */}
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Following
            {subscriptions && subscriptions.length > 0 && (
              <span className="text-num ml-2 text-foreground">{subscriptions.length}</span>
            )}
          </p>
          <Button size="sm" variant="ghost" onClick={focusAddInput} data-testid="button-add-influencer">
            <Plus className="w-4 h-4 mr-1.5" />
            Add trader
          </Button>
        </div>

        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-36 w-full rounded-xl" />
            ))}
          </div>
        ) : subscriptions && subscriptions.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {subscriptions.map((sub) => (
              <Card key={sub.id} className="rise-in hover-elevate" data-testid={`influencer-card-${sub.id}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/influencers/${sub.influencerId}`}>
                      <div className="flex items-center gap-3 min-w-0 cursor-pointer">
                        <Avatar className="w-11 h-11 border border-border">
                          <AvatarImage src={sub.influencer?.avatarUrl ?? undefined} />
                          <AvatarFallback className="bg-primary/10 text-primary">
                            <SiX className="w-4 h-4" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-sm truncate">
                            {sub.influencer?.displayName || sub.influencer?.handle}
                          </h3>
                          <p className="text-xs text-muted-foreground font-mono truncate">
                            @{sub.influencer?.handle}
                          </p>
                        </div>
                      </div>
                    </Link>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <Switch
                        checked={sub.enabled}
                        onCheckedChange={(enabled) => toggleMutation.mutate({ id: sub.id, enabled })}
                        data-testid={`switch-enabled-${sub.id}`}
                      />
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                        {sub.enabled && <span className="w-1.5 h-1.5 rounded-full bg-bull pulse-dot" />}
                        {sub.enabled ? "Active" : "Paused"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Bell className="w-3.5 h-3.5" />
                        <span className="text-num">{sub.alertCount || 0}</span>
                        signals
                      </span>
                      <span className="flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5" />
                        <span className="text-num">{sub.tradeCount || 0}</span>
                        trades
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Link href={`/influencers/${sub.influencerId}`}>
                        <Button size="icon" variant="ghost" data-testid={`button-view-${sub.id}`}>
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </Link>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => deleteMutation.mutate(sub.id)}
                        data-testid={`button-delete-${sub.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="rise-in">
            <CardContent className="py-12 text-center">
              <div className="w-12 h-12 mx-auto rounded-xl bg-muted flex items-center justify-center mb-4">
                <Users className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="font-medium">No traders yet</p>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                Follow traders on X to start receiving signals
              </p>
              <Button variant="outline" size="sm" onClick={focusAddInput} data-testid="button-add-first">
                <Plus className="w-4 h-4 mr-2" />
                Follow your first trader
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
