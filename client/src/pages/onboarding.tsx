import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePrivy, useSessionSigners, useWallets } from "@privy-io/react-auth";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Zap, 
  Wallet, 
  Copy, 
  Check, 
  ArrowRight,
  Loader2,
  Shield,
  DollarSign
} from "lucide-react";
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
  
  const embeddedWallet = wallets.find(w => 
    w.walletClientType === "privy" && 
    (w as any).chainType === "solana"
  ) || wallets.find(w => w.walletClientType === "privy");
  
  const embeddedWalletAddress = embeddedWallet?.address;
  
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
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Welcome to StockPulse</h1>
          <p className="text-muted-foreground mt-2">Let's get you set up for trading</p>
        </div>
        
        <div className="flex justify-center gap-2">
          <div className={`w-3 h-3 rounded-full ${step === "auto-trading" ? "bg-primary" : "bg-muted"}`} />
          <div className={`w-3 h-3 rounded-full ${step === "add-funds" ? "bg-primary" : "bg-muted"}`} />
        </div>
        
        {step === "auto-trading" && (
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <Zap className="w-8 h-8 text-primary" />
              </div>
              <CardTitle>Enable One-Tap Trading</CardTitle>
              <CardDescription>
                Execute trades instantly from Telegram with a single tap. No signature required for each trade.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="p-4 rounded-lg border border-border bg-muted/30">
                <div className="flex items-start gap-3">
                  <Shield className="w-5 h-5 text-primary mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Secure & Convenient</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Your wallet remains secure. You can revoke access anytime from Settings.
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="space-y-3">
                <Button 
                  onClick={handleEnableAutoTrading} 
                  disabled={isEnabling || !embeddedWallet}
                  className="w-full"
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
                  className="w-full"
                  data-testid="button-skip-auto-trading"
                >
                  Skip for now
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        
        {step === "add-funds" && (
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <Wallet className="w-8 h-8 text-primary" />
              </div>
              <CardTitle>Fund Your Wallet</CardTitle>
              <CardDescription>
                Send USDC (Solana) to your wallet address to start trading tokenized stocks.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {profile?.signerEnabled && (
                <div className="flex items-center gap-2 justify-center">
                  <Badge variant="default" className="gap-1">
                    <Check className="w-3 h-3" />
                    Auto-Trading Enabled
                  </Badge>
                </div>
              )}
              
              <div className="p-4 rounded-lg border border-border bg-muted/30">
                <p className="text-xs text-muted-foreground mb-2">Your Wallet Address</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono break-all" data-testid="text-wallet-address">
                    {profile?.solanaPubkey || "Loading..."}
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleCopyAddress}
                    disabled={!profile?.solanaPubkey}
                    data-testid="button-copy-address"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              
              <div className="p-4 rounded-lg border border-primary/20 bg-primary/5">
                <div className="flex items-start gap-3">
                  <DollarSign className="w-5 h-5 text-primary mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">How to add funds</p>
                    <ol className="text-xs text-muted-foreground mt-2 space-y-1 list-decimal list-inside">
                      <li>Copy your wallet address above</li>
                      <li>Send USDC (Solana network) from any exchange or wallet</li>
                      <li>Minimum $10 for your first trade</li>
                    </ol>
                  </div>
                </div>
              </div>
              
              <Button 
                onClick={handleFinish}
                className="w-full"
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
