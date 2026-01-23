import { useQuery, useMutation } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { 
  Shield,
  Zap,
  Loader2,
  Check,
  AlertTriangle,
  Wallet,
  DollarSign,
} from "lucide-react";
import { SiTelegram } from "react-icons/si";
import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const KEY_QUORUM_ID = import.meta.env.VITE_PRIVY_KEY_QUORUM_ID;

interface UserProfile {
  id: number;
  email?: string;
  solanaPubkey?: string;
  telegramChatId?: string;
  telegramUsername?: string;
  defaultBuyAmountUsd?: string;
  autoExecuteEnabled?: boolean;
  signerEnabled?: boolean;
  privyWalletId?: string;
}

interface SignerStatus {
  signerEnabled: boolean;
  privyWalletId?: string;
  autoExecuteEnabled: boolean;
}

export default function Settings() {
  const { user, authenticated } = usePrivy();
  const { toast } = useToast();
  const [defaultAmount, setDefaultAmount] = useState("10");
  const [isAddingSigner, setIsAddingSigner] = useState(false);

  const { data: profile, isLoading: profileLoading } = useQuery<UserProfile>({
    queryKey: ["/api/user/profile"],
    enabled: authenticated,
  });

  const { data: signerConfig, isLoading: signerLoading } = useQuery<SignerStatus>({
    queryKey: ["/api/user/signer-status"],
    enabled: authenticated,
  });

  useEffect(() => {
    if (profile?.defaultBuyAmountUsd) {
      setDefaultAmount(profile.defaultBuyAmountUsd);
    }
  }, [profile?.defaultBuyAmountUsd]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: { defaultBuyAmountUsd?: string; autoExecuteEnabled?: boolean }) => {
      return await apiRequest("PATCH", "/api/user/profile", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      toast({
        title: "Settings updated",
        description: "Your preferences have been saved.",
      });
    },
    onError: () => {
      toast({
        title: "Update failed",
        description: "Could not save your settings. Please try again.",
        variant: "destructive",
      });
    },
  });

  const enableSignerMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/user/enable-signer");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/signer-status"] });
    },
  });

  const hasEmbeddedWallet = !!user?.wallet?.address;

  const handleEnableOneTap = async () => {
    if (!hasEmbeddedWallet || !KEY_QUORUM_ID) {
      toast({
        title: "Setup incomplete",
        description: KEY_QUORUM_ID 
          ? "Please connect your wallet first." 
          : "One-tap trading is not configured for this app.",
        variant: "destructive",
      });
      return;
    }

    setIsAddingSigner(true);
    try {
      await enableSignerMutation.mutateAsync();

      toast({
        title: "One-tap trading enabled",
        description: "You can now execute trades directly from Telegram!",
      });
    } catch (error: any) {
      console.error("Failed to enable signer:", error);
      toast({
        title: "Setup failed",
        description: error.message || "Could not enable one-tap trading.",
        variant: "destructive",
      });
    } finally {
      setIsAddingSigner(false);
    }
  };

  const handleAutoExecuteToggle = (enabled: boolean) => {
    updateProfileMutation.mutate({ autoExecuteEnabled: enabled });
  };

  const handleSaveAmount = () => {
    const amount = parseFloat(defaultAmount);
    if (isNaN(amount) || amount <= 0 || amount > 10000) {
      toast({
        title: "Invalid amount",
        description: "Please enter an amount between $1 and $10,000",
        variant: "destructive",
      });
      return;
    }
    updateProfileMutation.mutate({ defaultBuyAmountUsd: defaultAmount });
  };

  const isSignerEnabled = profile?.signerEnabled || signerConfig?.signerEnabled;
  const canEnableOneTap = !!KEY_QUORUM_ID && hasEmbeddedWallet;

  return (
    <AppLayout>
      <div className="space-y-8 max-w-3xl">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-settings-title">Settings</h1>
          <p className="text-muted-foreground mt-1">Configure your trading preferences</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              One-Tap Trading
            </CardTitle>
            <CardDescription>
              Execute trades directly from Telegram with one tap. No signature required.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {profileLoading || signerLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <>
                <div className="p-4 rounded-lg border border-border bg-muted/30">
                  <div className="flex items-start gap-4">
                    <div className={`p-2 rounded-lg ${isSignerEnabled ? 'bg-primary/20' : 'bg-muted'}`}>
                      <Shield className={`w-6 h-6 ${isSignerEnabled ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">
                          {isSignerEnabled ? "One-Tap Trading Enabled" : "One-Tap Trading Available"}
                        </h3>
                        {isSignerEnabled && (
                          <Badge variant="default" className="text-xs">Active</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {isSignerEnabled 
                          ? "Your trades will execute automatically when you tap Buy or Sell in Telegram."
                          : "Grant permission for the app to execute trades on your behalf from Telegram."}
                      </p>
                    </div>
                  </div>
                </div>

                {!isSignerEnabled && (
                  <>
                    {!canEnableOneTap ? (
                      <div className="flex items-start gap-3 p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10">
                        <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-yellow-500">Setup Required</p>
                          <p className="text-sm text-muted-foreground mt-1">
                            {!KEY_QUORUM_ID 
                              ? "One-tap trading is not configured. The app administrator needs to set up authorization keys."
                              : "Please connect your Privy embedded wallet first."}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <Button 
                        onClick={handleEnableOneTap} 
                        disabled={isAddingSigner}
                        className="w-full"
                        data-testid="button-enable-one-tap"
                      >
                        {isAddingSigner ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Zap className="w-4 h-4 mr-2" />
                        )}
                        Enable One-Tap Trading
                      </Button>
                    )}
                  </>
                )}

                {isSignerEnabled && (
                  <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                    <div className="flex items-center gap-3">
                      <SiTelegram className="w-5 h-5 text-[#0088cc]" />
                      <div>
                        <Label className="font-medium">Auto-execute from Telegram</Label>
                        <p className="text-xs text-muted-foreground">
                          Trades execute immediately when you tap Buy/Sell
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={profile?.autoExecuteEnabled || false}
                      onCheckedChange={handleAutoExecuteToggle}
                      disabled={updateProfileMutation.isPending}
                      data-testid="switch-auto-execute"
                    />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-primary" />
              Default Trade Amount
            </CardTitle>
            <CardDescription>
              Set your default trade size for quick trading from Telegram
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {profileLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <>
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="number"
                      value={defaultAmount}
                      onChange={(e) => setDefaultAmount(e.target.value)}
                      className="pl-9"
                      min="1"
                      max="10000"
                      data-testid="input-default-amount"
                    />
                  </div>
                  <Button 
                    onClick={handleSaveAmount}
                    disabled={updateProfileMutation.isPending}
                    data-testid="button-save-amount"
                  >
                    {updateProfileMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Save"
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Quick trade buttons in Telegram will use $10 and $25 by default.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-primary" />
              Wallet Information
            </CardTitle>
            <CardDescription>
              Your connected Solana wallet details
            </CardDescription>
          </CardHeader>
          <CardContent>
            {profileLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <div className="space-y-4">
                <div className="p-4 rounded-lg border border-border bg-muted/30">
                  <Label className="text-xs text-muted-foreground">Wallet Address</Label>
                  <p className="font-mono text-sm mt-1 break-all" data-testid="text-wallet-address">
                    {profile?.solanaPubkey || user?.wallet?.address || "Not connected"}
                  </p>
                </div>
                
                {hasEmbeddedWallet && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-primary" />
                    <span>Using Privy embedded wallet</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
