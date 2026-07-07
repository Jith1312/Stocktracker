import { useQuery, useMutation } from "@tanstack/react-query";
import { usePrivy, useSessionSigners, useWallets } from "@privy-io/react-auth";
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
  BellOff,
  X,
  Plus,
} from "lucide-react";
import { SiTelegram } from "react-icons/si";
import { useState, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface AppConfig {
  keyQuorumId: string | null;
  authKeyConfigured: boolean;
}

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

interface MutedTicker {
  id: number;
  ticker: string;
}

export default function Settings() {
  const { user, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { addSessionSigners } = useSessionSigners();
  const { toast } = useToast();
  const [defaultAmount, setDefaultAmount] = useState("10");
  const [isAddingSigner, setIsAddingSigner] = useState(false);
  const [newMutedTicker, setNewMutedTicker] = useState("");
  const telegramPollRef = useRef<NodeJS.Timeout | null>(null);
  
  // Fetch config from server (runtime, not build-time)
  const { data: appConfig } = useQuery<AppConfig>({
    queryKey: ["/api/config"],
  });
  const KEY_QUORUM_ID = appConfig?.keyQuorumId;
  
  // Find the embedded Privy Solana wallet from useWallets hook
  const embeddedWalletFromHook = wallets.find(w => 
    w.walletClientType === "privy" && 
    (w as any).chainType === "solana"
  ) || wallets.find(w => w.walletClientType === "privy");
  
  // Also check user.linkedAccounts for embedded Solana wallet as fallback
  const embeddedWalletFromUser = user?.linkedAccounts?.find(
    (account: any) => account.type === "wallet" && 
                       account.walletClientType === "privy" && 
                       account.chainType === "solana"
  );
  
  // Use either source - prefer the hook for address access
  const embeddedWallet = embeddedWalletFromHook || embeddedWalletFromUser;
  const embeddedWalletAddress = embeddedWalletFromHook?.address || (embeddedWalletFromUser as any)?.address;
  
  // Check if wallet already has our session signer added
  const hasSessionSigner = user?.linkedAccounts?.some(
    (account: any) => {
      if (account.type === "wallet" && account.walletClientType === "privy" && account.chainType === "solana") {
        // Check if this wallet has session signers that include our signer
        const signers = (account as any).sessionSigners || [];
        return signers.some((s: any) => s.signerId === KEY_QUORUM_ID);
      }
      return false;
    }
  );

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

  const { data: mutedTickers } = useQuery<MutedTicker[]>({
    queryKey: ["/api/muted-tickers"],
    enabled: authenticated,
  });

  // Stop polling once Telegram shows as connected
  useEffect(() => {
    if (profile?.telegramChatId && telegramPollRef.current) {
      clearInterval(telegramPollRef.current);
      telegramPollRef.current = null;
      toast({
        title: "Telegram connected!",
        description: "Trading alerts will arrive in your Telegram chat.",
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
        if (telegramPollRef.current) clearInterval(telegramPollRef.current);
        let pollCount = 0;
        telegramPollRef.current = setInterval(() => {
          pollCount++;
          if (pollCount >= 30) {
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
        description: "Could not generate a Telegram link. Please try again.",
        variant: "destructive",
      });
    },
  });

  const muteTickerMutation = useMutation({
    mutationFn: (ticker: string) => apiRequest("POST", "/api/muted-tickers", { ticker }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/muted-tickers"] });
      setNewMutedTicker("");
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't mute ticker",
        description: error.message?.replace(/^\d+:\s*/, "") || "Please try again",
        variant: "destructive",
      });
    },
  });

  const unmuteTickerMutation = useMutation({
    mutationFn: (ticker: string) => apiRequest("DELETE", `/api/muted-tickers/${ticker}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/muted-tickers"] });
    },
  });

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

  const handleEnableOneTap = async () => {
    if (!embeddedWallet || !embeddedWalletAddress) {
      toast({
        title: "No wallet found",
        description: "Please create a wallet first by connecting your account.",
        variant: "destructive",
      });
      return;
    }

    if (!KEY_QUORUM_ID) {
      toast({
        title: "Configuration error",
        description: "Server signing is not configured. Please contact support.",
        variant: "destructive",
      });
      return;
    }

    setIsAddingSigner(true);
    try {
      // Step 1: Add session signer for TEE wallets (replaces delegateWallet for on-device)
      // Skip if already enabled in database (signer was already added previously)
      const alreadyEnabled = profile?.signerEnabled || signerConfig?.signerEnabled;
      if (!hasSessionSigner && !alreadyEnabled) {
        console.log("[Settings] Adding session signer for wallet:", embeddedWalletAddress);
        console.log("[Settings] Using signer ID:", KEY_QUORUM_ID);
        try {
          await addSessionSigners({
            address: embeddedWalletAddress,
            signers: [
              {
                signerId: KEY_QUORUM_ID,
                policyIds: [], // No policy restrictions
              },
            ],
          });
          console.log("[Settings] Session signer added successfully");
        } catch (signerError: any) {
          // If it's a duplicate signer error, we can continue since it already exists
          if (signerError?.message?.toLowerCase().includes('duplicate') || 
              signerError?.message?.toLowerCase().includes('already')) {
            console.log("[Settings] Session signer already exists, continuing...");
          } else {
            throw signerError;
          }
        }
      } else {
        console.log("[Settings] Skipping session signer add - already enabled:", { hasSessionSigner, alreadyEnabled });
      }
      
      // Step 2: Enable server-side signer in our database
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
  const canEnableOneTap = !!embeddedWallet;

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
              <SiTelegram className="w-5 h-5 text-[#0088cc]" />
              Telegram Alerts
            </CardTitle>
            <CardDescription>
              Alerts and one-tap trading happen in your Telegram chat
            </CardDescription>
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
              <div className="flex items-start gap-3 p-3 rounded-md border border-yellow-500/30 bg-yellow-500/10">
                <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                <p className="text-sm text-muted-foreground">
                  Not connected — you won't receive any alerts until you connect Telegram.
                </p>
              </div>
            )}
            <Button
              variant={profile?.telegramChatId ? "outline" : "default"}
              className="w-full"
              onClick={() => connectTelegramMutation.mutate()}
              disabled={connectTelegramMutation.isPending || !authenticated}
              data-testid="button-connect-telegram"
            >
              {connectTelegramMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <SiTelegram className="w-4 h-4 mr-2" />
              )}
              {profile?.telegramChatId ? "Reconnect Telegram" : "Connect Telegram"}
            </Button>
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
                  {(() => {
                    const base = Math.max(1, Math.round(parseFloat(defaultAmount) || 10));
                    const larger = Math.max(base + 1, Math.round(base * 2.5));
                    return `Quick-buy buttons in Telegram alerts will show $${base} and $${larger}.`;
                  })()}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BellOff className="w-5 h-5 text-primary" />
              Muted Tickers
            </CardTitle>
            <CardDescription>
              You won't receive alerts for muted tickers, even when your influencers mention them
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <Input
                placeholder="e.g. TSLA"
                value={newMutedTicker}
                onChange={(e) => setNewMutedTicker(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newMutedTicker.trim()) {
                    muteTickerMutation.mutate(newMutedTicker.trim());
                  }
                }}
                maxLength={10}
                data-testid="input-mute-ticker"
              />
              <Button
                onClick={() => muteTickerMutation.mutate(newMutedTicker.trim())}
                disabled={!newMutedTicker.trim() || muteTickerMutation.isPending}
                data-testid="button-mute-ticker"
              >
                {muteTickerMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-1" />
                    Mute
                  </>
                )}
              </Button>
            </div>

            {mutedTickers && mutedTickers.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {mutedTickers.map((m) => (
                  <Badge key={m.id} variant="secondary" className="gap-1 pr-1" data-testid={`badge-muted-${m.ticker}`}>
                    ${m.ticker}
                    <button
                      onClick={() => unmuteTickerMutation.mutate(m.ticker)}
                      className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
                      aria-label={`Unmute ${m.ticker}`}
                      data-testid={`button-unmute-${m.ticker}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No muted tickers. You can also mute from Telegram with /mute TSLA.
              </p>
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
                
                {embeddedWallet && (
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
