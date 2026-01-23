import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation, useSearch } from "wouter";
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
  Wallet
} from "lucide-react";
import { SiSolana } from "react-icons/si";
import { AppLayout } from "@/components/layout/AppLayout";

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

  const { data: orderDetails, isLoading } = useQuery({
    queryKey: ["/api/trade/prepare", alertId, amount],
    enabled: !!alertId,
  });

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
              Trade Details
            </CardTitle>
            <CardDescription>
              Swap USDC to tokenized stock via Jupiter
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border border-border">
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground">You Pay</p>
                    <p className="text-2xl font-bold">${amount}</p>
                    <Badge variant="secondary">USDC</Badge>
                  </div>
                  <ArrowRight className="w-6 h-6 text-muted-foreground" />
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground">You Receive</p>
                    <p className="text-2xl font-bold">~{orderDetails?.estimatedOutput || "—"}</p>
                    <Badge variant="default">{orderDetails?.outputSymbol || "Token"}</Badge>
                  </div>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground mb-3">Select Amount</p>
                  <div className="flex gap-2">
                    {amountOptions.map((opt) => (
                      <Button
                        key={opt}
                        variant={amount === opt ? "default" : "outline"}
                        className="flex-1"
                        onClick={() => setAmount(opt)}
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
                      data-testid="input-custom-amount"
                    />
                  </div>
                </div>

                {orderDetails && (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between py-2 border-b border-border">
                      <span className="text-muted-foreground">Route</span>
                      <span>Jupiter Aggregator</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-border">
                      <span className="text-muted-foreground">Slippage</span>
                      <span>0.5%</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-border">
                      <span className="text-muted-foreground">Network Fee</span>
                      <span>~$0.001</span>
                    </div>
                    {orderDetails?.priceImpact && (
                      <div className="flex justify-between py-2">
                        <span className="text-muted-foreground">Price Impact</span>
                        <span className={orderDetails.priceImpact > 1 ? "text-destructive" : ""}>
                          {orderDetails.priceImpact.toFixed(2)}%
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {txStatus === "idle" && (
                  <Button 
                    className="w-full" 
                    size="lg"
                    onClick={handleTrade}
                    data-testid="button-execute-trade"
                  >
                    <SiSolana className="w-5 h-5 mr-2" />
                    Swap ${amount} USDC
                  </Button>
                )}

                {txStatus === "preparing" && (
                  <Button className="w-full" size="lg" disabled>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Preparing Transaction...
                  </Button>
                )}

                {txStatus === "signing" && (
                  <Button className="w-full" size="lg" disabled>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Waiting for Signature...
                  </Button>
                )}

                {txStatus === "confirming" && (
                  <Button className="w-full" size="lg" disabled>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Confirming on Solana...
                  </Button>
                )}

                {txStatus === "success" && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center gap-3 p-4 rounded-lg bg-primary/10 border border-primary/20">
                      <Check className="w-6 h-6 text-primary" />
                      <span className="font-semibold text-primary">Trade Executed Successfully!</span>
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
                    <div className="flex items-center justify-center gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                      <AlertCircle className="w-6 h-6 text-destructive" />
                      <span className="font-semibold text-destructive">Trade Failed</span>
                    </div>
                    <Button 
                      className="w-full"
                      onClick={() => setTxStatus("idle")}
                    >
                      Try Again
                    </Button>
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
