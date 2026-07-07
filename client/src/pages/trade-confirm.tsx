import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation, useSearch, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight,
  Loader2,
  Check,
  AlertCircle,
  ExternalLink,
  Wallet,
  Zap
} from "lucide-react";
import { SiSolana } from "react-icons/si";
import { AppLayout } from "@/components/layout/AppLayout";

interface TradeQuote {
  ticker: string;
  outputSymbol: string;
  estimatedOutput: string;
  pricePerShare: string | null;
  priceImpactPct: string;
}

interface UserProfile {
  signerEnabled?: boolean;
  usdcBalance?: string;
}

export default function TradeConfirm() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const params = new URLSearchParams(search);
  const alertId = params.get("alertId");
  const ticker = params.get("ticker");
  const initialAmount = params.get("amount") || "10";

  const [amount, setAmount] = useState(initialAmount);
  const [quote, setQuote] = useState<TradeQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [txStatus, setTxStatus] = useState<"idle" | "executing" | "success" | "error">("idle");
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [txResult, setTxResult] = useState<{ tokensReceived?: string; ticker?: string } | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/user/profile"],
  });

  // Fetch a fresh quote whenever the amount changes (debounced)
  useEffect(() => {
    const amountNum = parseFloat(amount);
    if (!alertId && !ticker) return;
    if (isNaN(amountNum) || amountNum <= 0) {
      setQuote(null);
      return;
    }

    let cancelled = false;
    setIsQuoting(true);
    setQuoteError(null);

    const timer = setTimeout(async () => {
      try {
        const data = await apiRequest("POST", "/api/trade/quote", { alertId, ticker, amount });
        if (!cancelled) setQuote(data);
      } catch (error: any) {
        if (!cancelled) {
          setQuote(null);
          setQuoteError(error.message?.replace(/^\d+:\s*/, "") || "Couldn't fetch a quote");
        }
      } finally {
        if (!cancelled) setIsQuoting(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [alertId, ticker, amount]);

  const executeMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/trade/execute-server", { alertId, ticker, amount, side: "BUY" }),
    onMutate: () => {
      setTxStatus("executing");
      setTxError(null);
    },
    onSuccess: (data) => {
      setTxStatus("success");
      setTxSignature(data.signature);
      setTxResult({ tokensReceived: data.tokensReceived, ticker: data.ticker });
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/holdings"] });
      toast({
        title: "Trade executed",
        description: "Your trade has been confirmed on-chain",
      });
    },
    onError: (error: any) => {
      setTxStatus("error");
      setTxError(error.message?.replace(/^\d+:\s*/, "") || "Please try again");
    },
  });

  const canExecute = !!profile?.signerEnabled;
  const amountOptions = ["10", "25", "50", "100"];

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-confirm-title">Confirm Trade</h1>
          <p className="text-muted-foreground mt-1">Review and execute your swap</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="w-5 h-5" />
              {quote ? `Buy ${quote.ticker}` : "Trade Details"}
            </CardTitle>
            <CardDescription>
              Swap USDC to tokenized stock via Jupiter
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border border-border">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">You Pay</p>
                <p className="text-2xl font-bold">${amount || "0"}</p>
                <Badge variant="secondary">USDC</Badge>
              </div>
              <ArrowRight className="w-6 h-6 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm text-muted-foreground">You Receive</p>
                <p className="text-2xl font-bold">
                  {isQuoting ? (
                    <Loader2 className="w-5 h-5 animate-spin inline" />
                  ) : (
                    `~${quote?.estimatedOutput || "—"}`
                  )}
                </p>
                <Badge variant="default">{quote?.ticker || "Stock"}</Badge>
              </div>
            </div>

            {quoteError && (
              <div className="flex items-start gap-3 p-3 rounded-lg border border-destructive/30 bg-destructive/10">
                <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-destructive">{quoteError}</p>
              </div>
            )}

            <div>
              <p className="text-sm text-muted-foreground mb-3">Select Amount</p>
              <div className="flex gap-2">
                {amountOptions.map((opt) => (
                  <Button
                    key={opt}
                    variant={amount === opt ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setAmount(opt)}
                    disabled={txStatus === "executing"}
                    data-testid={`button-amount-${opt}`}
                  >
                    ${opt}
                  </Button>
                ))}
              </div>
              <div className="mt-3">
                <Input
                  type="number"
                  placeholder="Custom amount"
                  value={!amountOptions.includes(amount) ? amount : ""}
                  onChange={(e) => setAmount(e.target.value)}
                  className="text-center"
                  disabled={txStatus === "executing"}
                  data-testid="input-custom-amount"
                />
              </div>
            </div>

            {quote && (
              <div className="space-y-2 text-sm">
                {quote.pricePerShare && (
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className="text-muted-foreground">Price per share</span>
                    <span>${quote.pricePerShare}</span>
                  </div>
                )}
                <div className="flex justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground">Route</span>
                  <span>Jupiter Ultra</span>
                </div>
                {quote.priceImpactPct && (
                  <div className="flex justify-between py-2">
                    <span className="text-muted-foreground">Price Impact</span>
                    <span className={parseFloat(quote.priceImpactPct) > 1 ? "text-destructive" : ""}>
                      {parseFloat(quote.priceImpactPct).toFixed(2)}%
                    </span>
                  </div>
                )}
              </div>
            )}

            {!canExecute && txStatus === "idle" && (
              <div className="flex items-start gap-3 p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10">
                <Zap className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Enable one-tap trading to execute</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Trades are executed securely by your session signer. Set it up once in Settings — takes a few seconds.
                  </p>
                  <Link href="/settings">
                    <Button size="sm" className="mt-3" data-testid="button-goto-settings">
                      <Zap className="w-4 h-4 mr-2" />
                      Enable in Settings
                    </Button>
                  </Link>
                </div>
              </div>
            )}

            {txStatus === "idle" && canExecute && (
              <Button
                className="w-full"
                size="lg"
                onClick={() => executeMutation.mutate()}
                disabled={!quote || isQuoting}
                data-testid="button-execute-trade"
              >
                <SiSolana className="w-5 h-5 mr-2" />
                Buy {quote ? `~${quote.estimatedOutput} ${quote.ticker}` : ""} for ${amount}
              </Button>
            )}

            {txStatus === "executing" && (
              <Button className="w-full" size="lg" disabled>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Executing Trade...
              </Button>
            )}

            {txStatus === "success" && (
              <div className="space-y-4">
                <div className="flex items-center justify-center gap-3 p-4 rounded-lg bg-primary/10 border border-primary/20">
                  <Check className="w-6 h-6 text-primary" />
                  <span className="font-semibold text-primary">
                    {txResult?.tokensReceived
                      ? `Bought ${txResult.tokensReceived} ${txResult.ticker}!`
                      : "Trade Executed Successfully!"}
                  </span>
                </div>
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
                  variant="outline"
                  className="w-full"
                  onClick={() => setLocation("/portfolio")}
                >
                  View Portfolio
                </Button>
              </div>
            )}

            {txStatus === "error" && (
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                  <AlertCircle className="w-6 h-6 text-destructive shrink-0" />
                  <div>
                    <p className="font-semibold text-destructive">Trade Failed</p>
                    {txError && <p className="text-sm text-muted-foreground mt-1">{txError}</p>}
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={() => setTxStatus("idle")}
                >
                  Try Again
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
