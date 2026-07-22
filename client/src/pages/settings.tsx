import { useQuery, useMutation } from "@tanstack/react-query";
import { usePrivy, useSessionSigners, useWallets } from "@privy-io/react-auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Shield,
  Zap,
  Loader2,
  Check,
  Copy,
  AlertTriangle,
  ExternalLink,
  DollarSign,
  BellOff,
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
  dailySpendCapUsd?: string | null;
  autoExecuteEnabled?: boolean;
  signerEnabled?: boolean;
  privyWalletId?: string;
}

interface SignerStatus {
  signerEnabled: boolean;
  privyWalletId?: string;
  autoExecuteEnabled: boolean;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{children}</p>
  );
}

export default function Settings() {
  const { user, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { addSessionSigners } = useSessionSigners();
  const { toast } = useToast();
  const [defaultAmount, setDefaultAmount] = useState("10");
  const [spendCap, setSpendCap] = useState("");
  const [isAddingSigner, setIsAddingSigner] = useState(false);
  const [copied, setCopied] = useState(false);
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

  useEffect(() => {
    setSpendCap(profile?.dailySpendCapUsd ?? "");
  }, [profile?.dailySpendCapUsd]);

  useEffect(() => {
    console.log("[Settings] Profile data:", profile);
    console.log("[Settings] Signer config:", signerConfig);
    console.log("[Settings] hasSessionSigner:", hasSessionSigner);
  }, [profile, signerConfig, hasSessionSigner]);

  // Stop polling when Telegram becomes connected
  useEffect(() => {
    if (profile?.telegramChatId && telegramPollRef.current) {
      clearInterval(telegramPollRef.current);
      telegramPollRef.current = null;
      toast({
        title: "Telegram connected",
        description: "You'll now receive trading signals in Telegram.",
      });
    }
  }, [profile?.telegramChatId, toast]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: {
      defaultBuyAmountUsd?: string;
      dailySpendCapUsd?: number | null;
      autoExecuteEnabled?: boolean;
    }) => {
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

  const handleSaveSpendCap = () => {
    const amount = parseFloat(spendCap);
    if (isNaN(amount) || amount <= 0 || amount > 100000) {
      toast({
        title: "Invalid amount",
        description: "Please enter a cap between $1 and $100,000",
        variant: "destructive",
      });
      return;
    }
    updateProfileMutation.mutate({ dailySpendCapUsd: amount });
  };

  const handleClearSpendCap = () => {
    updateProfileMutation.mutate({ dailySpendCapUsd: null });
  };

  const isSignerEnabled = profile?.signerEnabled || signerConfig?.signerEnabled;
  const canEnableOneTap = !!embeddedWallet;
  const telegramConnected = !!profile?.telegramChatId;
  const walletAddress = profile?.solanaPubkey || user?.wallet?.address;
  const accountEmail = user?.email?.address || profile?.email;

  const copyAddress = () => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      toast({ title: "Address copied", description: "Wallet address copied to clipboard." });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6 max-w-3xl">
        <div className="rise-in">
          <h1 className="font-display text-2xl font-bold" data-testid="text-settings-title">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Trading preferences, notifications, and account</p>
        </div>

        {/* ── Trading ─────────────────────────────────────────── */}
        <Card className="rise-in">
          <CardHeader className="pb-4">
            <SectionLabel>Trading</SectionLabel>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Default buy amount */}
            <div>
              <Label className="font-medium">Default buy amount</Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-3">
                The trade size used when you tap Buy on a signal in Telegram
              </p>
              {profileLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="number"
                      value={defaultAmount}
                      onChange={(e) => setDefaultAmount(e.target.value)}
                      className="pl-9 text-num"
                      min="1"
                      max="10000"
                      data-testid="input-default-amount"
                    />
                  </div>
                  <Button
                    onClick={handleSaveAmount}
                    disabled={updateProfileMutation.isPending}
                    variant="outline"
                    data-testid="button-save-amount"
                  >
                    {updateProfileMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Save"
                    )}
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                Quick trade buttons in Telegram will use <span className="text-num">$10</span> and <span className="text-num">$25</span> by default.
              </p>
            </div>

            {/* One-tap execution — the important toggle */}
            <div
              className={`rounded-lg border p-4 transition-colors ${
                isSignerEnabled ? "border-primary/50 glow-volt" : "border-border"
              }`}
            >
              {profileLoading || signerLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      isSignerEnabled ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                    }`}>
                      <Zap className="w-4 h-4" strokeWidth={2.5} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-sm">One-tap execution</h3>
                        {isSignerEnabled && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                            <span className="w-1 h-1 rounded-full bg-primary pulse-dot" />
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {isSignerEnabled
                          ? "Trades execute the moment you tap Buy or Sell in Telegram — no wallet popup."
                          : "Trade straight from a Telegram signal without a wallet popup on every trade."}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5 rounded-lg bg-muted/40 p-3">
                    <Shield className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      <span className="text-foreground font-medium">The tradeoff:</span> enabling this adds a
                      delegated session signer to your embedded wallet, authorizing Arena's server to sign
                      swap transactions when you tap a trade button. It trades a per-trade signature prompt
                      for speed — the server can only act on trades you trigger, but you are trusting it
                      with signing authority over this wallet.
                    </p>
                  </div>

                  {!isSignerEnabled && (
                    <>
                      {!canEnableOneTap ? (
                        <div className="flex items-start gap-3 p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10">
                          <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-sm font-medium text-yellow-500">Setup required</p>
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
                          Enable one-tap trading
                        </Button>
                      )}
                    </>
                  )}

                  {isSignerEnabled && (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <SiTelegram className="w-5 h-5 text-[#0088cc] shrink-0" />
                        <div className="min-w-0">
                          <Label className="font-medium text-sm">Auto-execute from Telegram</Label>
                          <p className="text-xs text-muted-foreground truncate">
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
                </div>
              )}
            </div>

            {/* Daily spend cap */}
            <div>
              <Label className="font-medium">Daily spend cap</Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-3">
                Hard limit on one-tap buys per day (UTC). Protects you if a bad signal slips through.
              </p>
              {profileLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <>
                  <div className="flex gap-3">
                    <div className="relative flex-1">
                      <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="number"
                        value={spendCap}
                        onChange={(e) => setSpendCap(e.target.value)}
                        placeholder="No cap"
                        className="pl-9 text-num"
                        min="1"
                        max="100000"
                        data-testid="input-spend-cap"
                      />
                    </div>
                    <Button
                      onClick={handleSaveSpendCap}
                      disabled={updateProfileMutation.isPending}
                      variant="outline"
                      data-testid="button-save-spend-cap"
                    >
                      {updateProfileMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "Save"
                      )}
                    </Button>
                    {profile?.dailySpendCapUsd != null && (
                      <Button
                        onClick={handleClearSpendCap}
                        disabled={updateProfileMutation.isPending}
                        variant="ghost"
                        data-testid="button-clear-spend-cap"
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  {isSignerEnabled && profile?.dailySpendCapUsd == null && (
                    <p className="text-xs text-warning mt-2" data-testid="text-spend-cap-nudge">
                      One-tap execution is on with no daily cap — setting one is recommended.
                    </p>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Notifications ───────────────────────────────────── */}
        <Card className="rise-in">
          <CardHeader className="pb-4">
            <SectionLabel>Notifications</SectionLabel>
          </CardHeader>
          <CardContent className="space-y-5">
            {profileLoading ? (
              <Skeleton className="h-14 w-full" />
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <SiTelegram className="w-4 h-4 text-[#0088cc]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Telegram</p>
                    {telegramConnected ? (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5 truncate" data-testid="text-telegram-status">
                        <span className="w-1.5 h-1.5 rounded-full bg-bull pulse-dot shrink-0" />
                        Connected{profile?.telegramUsername ? (
                          <span className="font-mono truncate">as @{profile.telegramUsername}</span>
                        ) : null}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground" data-testid="text-telegram-status">
                        Not connected — signals are delivered via Telegram
                      </p>
                    )}
                  </div>
                </div>
                {!telegramConnected && (
                  <Button
                    size="sm"
                    onClick={() => connectTelegramMutation.mutate()}
                    disabled={connectTelegramMutation.isPending || !authenticated}
                    data-testid="button-connect-telegram"
                  >
                    {connectTelegramMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <SiTelegram className="w-4 h-4 mr-2" />
                    )}
                    Connect
                  </Button>
                )}
              </div>
            )}

            <div>
              <div className="flex items-center gap-2">
                <BellOff className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-sm font-medium">Muted tickers</p>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Silence signals for specific tickers from the Telegram bot — send{" "}
                <code className="font-mono text-foreground/90 bg-muted rounded px-1 py-0.5">/mute TSLA</code>{" "}
                to mute and{" "}
                <code className="font-mono text-foreground/90 bg-muted rounded px-1 py-0.5">/unmute TSLA</code>{" "}
                to restore alerts.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ── Account ─────────────────────────────────────────── */}
        <Card className="rise-in">
          <CardHeader className="pb-4">
            <SectionLabel>Account</SectionLabel>
          </CardHeader>
          <CardContent className="space-y-4">
            {profileLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className="text-sm font-medium truncate" data-testid="text-account-email">
                    {accountEmail || "—"}
                  </p>
                </div>

                <div className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <SectionLabel>Wallet address · Solana</SectionLabel>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={copyAddress}
                        disabled={!walletAddress}
                        data-testid="button-copy-wallet"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-bull" /> : <Copy className="w-3.5 h-3.5" />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={!walletAddress}
                        onClick={() => walletAddress && window.open(`https://solscan.io/account/${walletAddress}`, "_blank")}
                        data-testid="button-view-wallet-explorer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <p className="font-mono text-xs md:text-sm break-all text-foreground/90" data-testid="text-wallet-address">
                    {walletAddress || "Not connected"}
                  </p>
                </div>

                {embeddedWallet && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Check className="w-3.5 h-3.5 text-primary" />
                    <span>Using Privy embedded wallet</span>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
