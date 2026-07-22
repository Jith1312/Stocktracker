import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight,
  Loader2,
  AlertCircle,
  ExternalLink,
  CircleCheck,
} from "lucide-react";
import { SiSolana } from "react-icons/si";
import { AppLayout } from "@/components/layout/AppLayout";
import { SignalBadge } from "@/components/SignalBadge";

interface OrderQuote {
  preparedOrderId?: number;
  estimatedOutput?: string;
  outputSymbol?: string;
  priceImpact?: number;
  swapTransaction?: string;
}

interface AlertItem {
  id: number;
  status?: string;
  createdAt?: string;
  ticker: string;
  sentiment?: string;
  action?: string;
  confidence?: string;
  tweetText?: string;
  tweetUrl?: string;
  influencerHandle?: string;
}

const statusCopy: Record<string, string> = {
  preparing: "Preparing transaction",
  signing: "Waiting for signature",
  confirming: "Confirming on Solana",
};

export default function TradeConfirm() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const params = new URLSearchParams(search);
  const alertId = params.get("alertId");
  const preparedOrderId = params.get("preparedOrderId");
  const initialAmount = params.get("amount") || "10";

  const [amount, setAmount] = useState(initialAmount);
  const [txStatus, setTxStatus] = useState<"idle" | "preparing" | "signing" | "confirming" | "success" | "error">("idle");
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const { data: orderDetails, isLoading } = useQuery<OrderQuote>({
    queryKey: ["/api/trade/prepare", alertId, amount],
    enabled: !!alertId,
  });

  // Signal context for the alert being traded (read-only, for display)
  const { data: alerts } = useQuery<AlertItem[]>({
    queryKey: ["/api/alerts"],
    enabled: !!alertId,
  });
  const signalAlert = alertId
    ? alerts?.find((a) => a.id === parseInt(alertId))
    : undefined;

  const prepareMutation = useMutation({
    mutationFn: (data: { alertId: string; amount: string }) =>
      apiRequest("POST", "/api/trade/prepare", data),
    onSuccess: (data) => {
      setTxStatus("signing");
    },
    onError: (error: any) => {
      setTxStatus("error");
      toast({
        title: "Failed to prepare trade",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const executeMutation = useMutation({
    mutationFn: (data: { preparedOrderId: number; signedTx?: string }) =>
      apiRequest("POST", "/api/trade/execute", data),
    onSuccess: (data) => {
      setTxStatus("success");
      setTxSignature(data.txSig);
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      toast({
        title: "Trade executed",
        description: "Your trade has been confirmed on-chain",
      });
    },
    onError: (error: any) => {
      setTxStatus("error");
      toast({
        title: "Trade failed",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const handleTrade = async () => {
    if (!alertId) return;

    setTxStatus("preparing");
    prepareMutation.mutate({ alertId, amount });
  };

  const amountOptions = ["10", "25", "50", "100"];
  const isBusy = txStatus === "preparing" || txStatus === "signing" || txStatus === "confirming";
  const priceImpact = orderDetails?.priceImpact;

  return (
    <AppLayout>
      <div className="max-w-lg mx-auto space-y-5">
        <div className="rise-in text-center">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">One-tap trade</p>
          <h1 className="font-display text-2xl md:text-3xl font-bold mt-1" data-testid="text-confirm-title">
            Confirm Trade
          </h1>
        </div>

        <Card className="rise-in rounded-xl overflow-hidden">
          {/* Signal context */}
          <div className="border-b border-card-border bg-gradient-to-br from-card to-background px-5 py-4 relative overflow-hidden">
            <div className="absolute inset-0 bg-grid fade-grid opacity-30 pointer-events-none" />
            <div className="relative flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="font-mono font-bold text-2xl">
                  {signalAlert?.ticker ? `$${signalAlert.ticker}` : orderDetails?.outputSymbol || "Signal"}
                </span>
                <SignalBadge action={signalAlert?.action} confidence={signalAlert?.confidence} />
              </div>
              {signalAlert?.influencerHandle && (
                <span className="text-xs text-muted-foreground font-mono">
                  @{signalAlert.influencerHandle}
                </span>
              )}
            </div>
            {signalAlert?.tweetText && (
              <p className="relative text-xs text-muted-foreground mt-2 line-clamp-2">
                {signalAlert.tweetText}
              </p>
            )}
          </div>

          <CardContent className="p-5 space-y-6">
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <>
                {/* Pay / receive */}
                <div className="flex items-center justify-between gap-3 p-4 rounded-lg bg-muted/50 border border-border">
                  <div className="text-center flex-1">
                    <p className="text-[11px] uppercase tracking-widest text-muted-foreground">You pay</p>
                    <p className="text-num text-2xl font-semibold mt-1">${amount}</p>
                    <p className="text-xs font-mono text-muted-foreground mt-0.5">USDC</p>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                    <ArrowRight className="w-4 h-4 text-primary" />
                  </div>
                  <div className="text-center flex-1">
                    <p className="text-[11px] uppercase tracking-widest text-muted-foreground">You receive</p>
                    <p className="text-num text-2xl font-semibold mt-1">
                      ~{orderDetails?.estimatedOutput || "—"}
                    </p>
                    <p className="text-xs font-mono text-primary mt-0.5">
                      {orderDetails?.outputSymbol || "Token"}
                    </p>
                  </div>
                </div>

                {/* Amount selection */}
                <div>
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3">Amount · USDC</p>
                  <div className="grid grid-cols-4 gap-2">
                    {amountOptions.map((opt) => (
                      <Button
                        key={opt}
                        variant={amount === opt ? "default" : "outline"}
                        className="text-num"
                        disabled={isBusy}
                        onClick={() => setAmount(opt)}
                        data-testid={`button-amount-${opt}`}
                      >
                        ${opt}
                      </Button>
                    ))}
                  </div>
                  <Input
                    type="number"
                    placeholder="Custom amount"
                    value={!amountOptions.includes(amount) ? amount : ""}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={isBusy}
                    className="mt-2 text-center text-num"
                    data-testid="input-custom-amount"
                  />
                </div>

                {/* Quote details */}
                {orderDetails && (
                  <div className="rounded-lg border border-border divide-y divide-border text-sm">
                    <div className="flex justify-between px-3 py-2.5">
                      <span className="text-muted-foreground">Route</span>
                      <span>Jupiter Aggregator</span>
                    </div>
                    <div className="flex justify-between px-3 py-2.5">
                      <span className="text-muted-foreground">Slippage</span>
                      <span className="text-num">0.5%</span>
                    </div>
                    <div className="flex justify-between px-3 py-2.5">
                      <span className="text-muted-foreground">Network fee</span>
                      <span className="text-num">~$0.001</span>
                    </div>
                    {priceImpact != null && (
                      <div className="flex justify-between px-3 py-2.5">
                        <span className="text-muted-foreground">Price impact</span>
                        <span
                          className={`text-num ${
                            priceImpact > 1
                              ? "text-bear"
                              : priceImpact > 0.5
                                ? "text-warning"
                                : ""
                          }`}
                        >
                          {priceImpact.toFixed(2)}%
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions per state */}
                {txStatus === "idle" && (
                  <div className="space-y-2">
                    <Button
                      className="w-full glow-volt"
                      size="lg"
                      onClick={handleTrade}
                      data-testid="button-execute-trade"
                    >
                      <SiSolana className="w-5 h-5 mr-2" />
                      Swap ${amount} USDC
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full text-muted-foreground"
                      onClick={() => setLocation("/alerts")}
                      data-testid="button-cancel-trade"
                    >
                      Cancel
                    </Button>
                  </div>
                )}

                {isBusy && (
                  <div className="space-y-3">
                    <Button className="w-full" size="lg" disabled>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      {statusCopy[txStatus]}...
                    </Button>
                    <div className="flex items-center justify-center gap-2">
                      {(["preparing", "signing", "confirming"] as const).map((step, i) => {
                        const activeIdx = ["preparing", "signing", "confirming"].indexOf(txStatus);
                        return (
                          <span
                            key={step}
                            className={`h-1 w-8 rounded-full transition-colors ${
                              i < activeIdx
                                ? "bg-primary"
                                : i === activeIdx
                                  ? "bg-primary pulse-dot"
                                  : "bg-muted"
                            }`}
                          />
                        );
                      })}
                    </div>
                    <p className="text-center text-[11px] uppercase tracking-widest text-muted-foreground">
                      Do not close this page
                    </p>
                  </div>
                )}

                {txStatus === "success" && (
                  <div className="space-y-4 rise-in">
                    <div className="rounded-xl border border-bull/30 bg-bull/10 p-6 text-center glow-green">
                      <div className="w-12 h-12 mx-auto rounded-xl bg-bull/15 flex items-center justify-center mb-3">
                        <CircleCheck className="w-6 h-6 text-bull" />
                      </div>
                      <p className="font-display font-semibold text-bull">Trade executed</p>
                      <p className="text-xs text-muted-foreground mt-1">Confirmed on Solana</p>
                      {txSignature && (
                        <a
                          href={`https://solscan.io/tx/${txSignature}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex items-center gap-1.5 font-mono text-xs text-foreground/80 hover:text-foreground"
                          data-testid="link-tx-signature"
                        >
                          {txSignature.slice(0, 8)}...{txSignature.slice(-8)}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {txSignature && (
                        <Button variant="outline" className="w-full" asChild>
                          <a
                            href={`https://solscan.io/tx/${txSignature}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="w-4 h-4 mr-2" />
                            View on Solscan
                          </a>
                        </Button>
                      )}
                      <Button
                        className={txSignature ? "w-full" : "w-full sm:col-span-2"}
                        onClick={() => setLocation("/portfolio")}
                      >
                        View Portfolio
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </div>
                  </div>
                )}

                {txStatus === "error" && (
                  <div className="space-y-4 rise-in">
                    <div className="rounded-xl border border-bear/30 bg-bear/10 p-5 text-center">
                      <div className="w-10 h-10 mx-auto rounded-lg bg-bear/15 flex items-center justify-center mb-2">
                        <AlertCircle className="w-5 h-5 text-bear" />
                      </div>
                      <p className="font-semibold text-bear">Trade failed</p>
                      <p className="text-xs text-muted-foreground mt-1">Nothing was charged. You can retry safely.</p>
                    </div>
                    <Button className="w-full" onClick={() => setTxStatus("idle")}>
                      Try Again
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <p className="rise-in text-center text-[11px] text-muted-foreground">
          Swaps USDC to tokenized stock via Jupiter on Solana
        </p>
      </div>
    </AppLayout>
  );
}
