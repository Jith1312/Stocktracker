import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { 
  Plus, 
  ExternalLink, 
  Trash2, 
  Users,
  Bell,
  TrendingUp
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

export default function Influencers() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: subscriptions, isLoading } = useQuery({
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
      setDialogOpen(false);
      form.reset();
      toast({
        title: "Influencer added",
        description: "You'll now receive alerts from this influencer",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to add influencer",
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
        title: "Influencer removed",
        description: "You'll no longer receive alerts from this influencer",
      });
    },
  });

  const onSubmit = (data: AddInfluencerForm) => {
    addMutation.mutate(data);
  };

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-influencers-title">Influencers</h1>
            <p className="text-muted-foreground mt-1">Manage the X accounts you follow for trading signals</p>
          </div>
          
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-influencer">
                <Plus className="w-4 h-4 mr-2" />
                Add Influencer
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Influencer</DialogTitle>
                <DialogDescription>
                  Paste an X (Twitter) profile URL to start receiving trading signals
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="profileUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Profile URL</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="https://x.com/elonmusk" 
                            {...field} 
                            data-testid="input-profile-url"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-end gap-3">
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={() => setDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button 
                      type="submit" 
                      disabled={addMutation.isPending}
                      data-testid="button-submit-influencer"
                    >
                      {addMutation.isPending ? "Adding..." : "Add Influencer"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="pt-6">
                  <Skeleton className="h-20 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : subscriptions?.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {subscriptions.map((sub: any) => (
              <Card key={sub.id} className="hover-elevate" data-testid={`influencer-card-${sub.id}`}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar className="w-12 h-12">
                        <AvatarImage src={sub.influencer?.avatarUrl} />
                        <AvatarFallback className="bg-primary/10 text-primary">
                          <SiX className="w-5 h-5" />
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h3 className="font-semibold">{sub.influencer?.displayName || sub.influencer?.handle}</h3>
                        <p className="text-sm text-muted-foreground">@{sub.influencer?.handle}</p>
                      </div>
                    </div>
                    <Switch 
                      checked={sub.enabled}
                      onCheckedChange={(enabled) => toggleMutation.mutate({ id: sub.id, enabled })}
                      data-testid={`switch-enabled-${sub.id}`}
                    />
                  </div>

                  <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Bell className="w-4 h-4" />
                        <span>{sub.alertCount || 0}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <TrendingUp className="w-4 h-4" />
                        <span>{sub.tradeCount || 0}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link href={`/influencers/${sub.influencerId}`}>
                        <Button size="icon" variant="ghost" data-testid={`button-view-${sub.id}`}>
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                      </Link>
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="text-destructive"
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
          <Card>
            <CardContent className="py-16 text-center">
              <Users className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-xl font-semibold mb-2">No influencers yet</h3>
              <p className="text-muted-foreground mb-6">
                Add X influencers to start receiving trading signals
              </p>
              <Button onClick={() => setDialogOpen(true)} data-testid="button-add-first">
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Influencer
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
