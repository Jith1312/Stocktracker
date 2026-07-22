import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePrivy, useSessionSigners, useWallets } from "@privy-io/react-auth";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Zap,
  Wallet,
  Copy,
  Check,
  ArrowRight,
  Loader2,
  Shield,
  DollarSign,
  CircleCheck
} from "lucide-react";
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
  onboardingCompleted?: boolean;
}

export default function Onboarding() {
  const { user, authenticated, ready } = usePrivy();
  const { wallets } = useWallets();
  const { addSessionSigners } = useSessionSigners();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [step, setStep] = useState<"auto-trading" | "add-funds">("auto-trading");
  const [copied, setCopied] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);

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

  const { data: profile, isLoading: profileLoading } = useQuery<UserProfile>({
    queryKey: ["/api/user/profile"],
    enabled: authenticated && ready,
  });

  useEffect(() => {
    if (profile?.onboardingCompleted) {
      setLocation("/dashboard");
    }
  }, [profile?.onboardingCompleted, setLocation]);

  const enableSignerMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/user/enable-signer");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: async (data: { autoExecuteEnabled?: boolean; onboardingCompleted?: boolean }) => {
      return await apiRequest("PATCH", "/api/user/profile", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
    },
  });

  const handleEnableAutoTrading = async () => {
    if (!embeddedWallet || !embeddedWalletAddress) {
      toast({
        title: "No wallet found",
        description: "Please wait for your wallet to initialize.",
        variant: "destructive",
      });
      return;
    }

    if (!KEY_QUORUM_ID) {
      toast({
        title: "Configuration error",
        description: "Server signing is not configured.",
        variant: "destructive",
      });
      return;
    }

    setIsEnabling(true);
    try {
      const alreadyEnabled = profile?.signerEnabled;
      if (!alreadyEnabled) {
        try {
          await addSessionSigners({
            address: embeddedWalletAddress,
            signers: [
              {
                signerId: KEY_QUORUM_ID,
                policyIds: [],
              },
            ],
          });
        } catch (signerError: any) {
          if (!signerError?.message?.toLowerCase().includes('duplicate') &&
              !signerError?.message?.toLowerCase().includes('already')) {
            throw signerError;
          }
        }
      }

      await enableSignerMutation.mutateAsync();
      await updateProfileMutation.mutateAsync({ autoExecuteEnabled: true });

      toast({
        title: "Auto-trading enabled!",
        description: "You can now execute trades with one tap.",
      });

      setStep("add-funds");
    } catch (error: any) {
      console.error("Failed to enable auto-trading:", error);
      toast({
        title: "Setup failed",
        description: error.message || "Could not enable auto-trading.",
        variant: "destructive",
      });
    } finally {
      setIsEnabling(false);
    }
  };

  const handleSkipAutoTrading = () => {
    setStep("add-funds");
  };

  const handleCopyAddress = async () => {
    if (profile?.solanaPubkey) {
      await navigator.clipboard.writeText(profile.solanaPubkey);
      setCopied(true);
      toast({
        title: "Address copied",
        description: "Send USDC to this address to start trading.",
      });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleFinish = async () => {
    await updateProfileMutation.mutateAsync({ onboardingCompleted: true });
    setLocation("/dashboard");
  };

  if (!ready || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const stepNumber = step === "auto-trading" ? 1 : 2;
  const totalSteps = 2;

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background p-4 overflow-hidden">
      <div className="absolute inset-0 bg-grid fade-grid pointer-events-none" />

      <div className="relative w-full max-w-md space-y-8 rise-in">
        {/* Brand */}
        <div className="flex flex-col items-center text-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center glow-volt">
            <Zap className="w-6 h-6 text-primary-foreground" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold">Welcome to Arena</h1>
            <p className="text-sm text-muted-foreground mt-1.5">
              Two quick steps and you're ready to trade the signal
            </p>
          </div>
        </div>

        {/* Progress */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center rounded-md bg-primary/15 text-primary px-2 py-0.5 text-num text-xs font-bold">
              {stepNumber}/{totalSteps}
            </span>
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
              {step === "auto-trading" ? "One-tap trading" : "Fund your wallet"}
            </span>
          </div>
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${(stepNumber / totalSteps) * 100}%` }}
            />
          </div>
        </div>

        {step === "auto-trading" && (
          <Card className="rounded-xl border-card-border">
            <CardHeader className="p-6 md:p-8 pb-0 md:pb-0">
              <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5">
                <Zap className="w-5 h-5 text-primary" />
              </div>
              <CardTitle className="font-display text-xl">Enable one-tap trading</CardTitle>
              <CardDescription className="leading-relaxed">
                Execute trades instantly from Telegram with a single tap. No signature
                required for each trade.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 md:p-8 space-y-6">
              <div className="p-4 rounded-lg border border-border bg-muted/30">
                <div className="flex items-start gap-3">
                  <Shield className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-sm">Secure &amp; convenient</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Your wallet remains secure. You can revoke access anytime from Settings.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <Button
                  onClick={handleEnableAutoTrading}
                  disabled={isEnabling || !embeddedWallet}
                  className="w-full glow-volt"
                  size="lg"
                  data-testid="button-enable-auto-trading"
                >
                  {isEnabling ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Enabling...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 mr-2" />
                      Enable Auto-Trading
                    </>
                  )}
                </Button>

                <Button
                  variant="ghost"
                  onClick={handleSkipAutoTrading}
                  className="w-full text-muted-foreground"
                  data-testid="button-skip-auto-trading"
                >
                  Skip for now
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "add-funds" && (
          <Card className="rounded-xl border-card-border">
            <CardHeader className="p-6 md:p-8 pb-0 md:pb-0">
              <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5">
                <Wallet className="w-5 h-5 text-primary" />
              </div>
              <CardTitle className="font-display text-xl">Fund your wallet</CardTitle>
              <CardDescription className="leading-relaxed">
                Send USDC (Solana) to your wallet address to start trading tokenized stocks.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 md:p-8 space-y-6">
              {profile?.signerEnabled && (
                <div className="flex items-center gap-2 rounded-lg border border-bull/30 bg-bull/10 px-3 py-2">
                  <CircleCheck className="w-4 h-4 text-bull shrink-0" />
                  <span className="text-sm font-medium text-bull">Auto-trading enabled</span>
                </div>
              )}

              <div className="p-4 rounded-lg border border-border bg-muted/30">
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2">
                  Your wallet address
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-num text-xs md:text-sm break-all" data-testid="text-wallet-address">
                    {profile?.solanaPubkey || "Loading..."}
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleCopyAddress}
                    disabled={!profile?.solanaPubkey}
                    data-testid="button-copy-address"
                  >
                    {copied ? <Check className="w-4 h-4 text-bull" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              <div className="p-4 rounded-lg border border-primary/20 bg-primary/5">
                <div className="flex items-start gap-3">
                  <DollarSign className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-sm">How to add funds</p>
                    <ol className="text-xs text-muted-foreground mt-2 space-y-1 list-decimal list-inside leading-relaxed">
                      <li>Copy your wallet address above</li>
                      <li>Send USDC (Solana network) from any exchange or wallet</li>
                      <li>Minimum <span className="text-num">$10</span> for your first trade</li>
                    </ol>
                  </div>
                </div>
              </div>

              <Button
                onClick={handleFinish}
                className="w-full glow-volt"
                size="lg"
                disabled={updateProfileMutation.isPending}
                data-testid="button-continue-to-dashboard"
              >
                {updateProfileMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <ArrowRight className="w-4 h-4 mr-2" />
                )}
                Continue to Dashboard
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
