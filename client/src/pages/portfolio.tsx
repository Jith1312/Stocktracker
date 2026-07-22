import { useQuery, useMutation } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Wallet,
  ExternalLink,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRight,
  Clock,
  Loader2,
  Send,
  AlertCircle
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { SignalBadge } from "@/components/SignalBadge";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState, useEffect } from "react";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

interface SellQuote {
  ticker: string;
  symbol: string;
  inputAmount: string;
  outputAmount: string;
  priceImpactPct: string;
}

function shortAddress(addr?: string | null): string {
  if (!addr) return "—";
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function formatSignedUsd(value: number): string {
  return value >= 0 ? `+$${value.toFixed(2)}` : `-$${Math.abs(value).toFixed(2)}`;
}

function StatusChip({ status }: { status: string }) {
  const done = status === "COMPLETED";
  const pending = status === "PENDING";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide ${
        done
          ? "border-bull/30 bg-bull/10 text-bull"
          : pending
            ? "border-border bg-muted/50 text-muted-foreground"
            : "border-bear/30 bg-bear/10 text-bear"
      }`}
    >
      {status}
    </span>
  );
}

function EmptyState({ icon: Icon, title, description }: { icon: any; title: string; description: string }) {
  return (
    <div className="text-center py-12">
      <div className="w-12 h-12 mx-auto rounded-xl bg-muted flex items-center justify-center mb-4">
        <Icon className="w-5 h-5 text-muted-foreground" />
      </div>
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground mt-1">{description}</p>
    </div>
  );
}

function LoadingRows() {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Portfolio() {
  const { authenticated, ready } = usePrivy();
  const { toast } = useToast();
  const [sellingTicker, setSellingTicker] = useState<string | null>(null);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferToken, setTransferToken] = useState<string>(USDC_MINT);
  const [transferRecipient, setTransferRecipient] = useState("");
  const [transferAmount, setTransferAmount] = useState("");

  // Sell confirmation dialog state
  const [sellDialogOpen, setSellDialogOpen] = useState(false);
  const [sellQuote, setSellQuote] = useState<SellQuote | null>(null);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);

  const isReady = ready && authenticated;

  const { data: portfolioData, isLoading: holdingsLoading, refetch: refetchHoldings } = useQuery<{
    holdings: any[];
    usdcBalance: number;
    totalValue: number;
  }>({
    queryKey: ["/api/portfolio/holdings"],
    enabled: isReady,
    staleTime: 0,
  });

  const { data: trades, isLoading: tradesLoading, refetch: refetchTrades } = useQuery<any[]>({
    queryKey: ["/api/trades"],
    enabled: isReady,
    staleTime: 0,
  });

  const { data: transfersData, isLoading: transfersLoading, refetch: refetchTransfers } = useQuery<any[]>({
    queryKey: ["/api/transfers"],
    enabled: isReady,
    staleTime: 0,
  });

  // Refetch when auth becomes ready
  useEffect(() => {
    if (isReady) {
      refetchHoldings();
      refetchTrades();
      refetchTransfers();
    }
  }, [isReady]);

  const holdings = portfolioData?.holdings || [];
  const usdcBalance = portfolioData?.usdcBalance || 0;
  const totalValue = portfolioData?.totalValue || 0;

  const sellMutation = useMutation({
    mutationFn: async ({ ticker, amount }: { ticker: string; amount: string }) => {
      const res = await apiRequest("POST", "/api/trade/sell", { ticker, amount });
      const data = await res.json();
      // Check if response contains an error
      if (data.error) {
        throw new Error(data.error);
      }
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Sell successful!",
        description: `Transaction: ${data.signature?.slice(0, 12)}...`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/holdings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      setSellingTicker(null);
      setSellDialogOpen(false);
      setSellQuote(null);
    },
    onError: (error: any) => {
      toast({
        title: "Sell failed",
        description: error.message || "Unknown error",
        variant: "destructive",
      });
      setSellingTicker(null);
    },
  });

  // Open sell confirmation dialog and fetch quote
  const handleSellClick = async (ticker: string, balance: string) => {
    setSellDialogOpen(true);
    setIsLoadingQuote(true);
    setSellQuote(null);

    try {
      const data = await apiRequest("POST", "/api/trade/sell-quote", { ticker });

      if (data.error) {
        toast({
          title: "Failed to get quote",
          description: data.error,
          variant: "destructive",
        });
        setSellDialogOpen(false);
        return;
      }

      setSellQuote({
        ticker: data.ticker,
        symbol: data.symbol,
        inputAmount: data.inputAmount,
        outputAmount: data.outputAmount,
        priceImpactPct: data.priceImpactPct,
      });
    } catch (error: any) {
      toast({
        title: "Failed to get quote",
        description: error.message || "Unknown error",
        variant: "destructive",
      });
      setSellDialogOpen(false);
    } finally {
      setIsLoadingQuote(false);
    }
  };

  // Confirm and execute sell
  const handleConfirmSell = async () => {
    if (!sellQuote) return;
    setSellingTicker(sellQuote.ticker);
    sellMutation.mutate({ ticker: sellQuote.ticker, amount: sellQuote.inputAmount });
  };

  const transferMutation = useMutation({
    mutationFn: async ({ tokenMint, recipientAddress, amount }: { tokenMint: string; recipientAddress: string; amount: string }) => {
      const res = await apiRequest("POST", "/api/transfer", { tokenMint, recipientAddress, amount });
      const data = await res.json();
      // Check if response contains an error
      if (data.error) {
        throw new Error(data.error);
      }
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Transfer successful!",
        description: `Transaction: ${data.signature?.slice(0, 12)}...`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/holdings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transfers"] });
      setTransferDialogOpen(false);
      setTransferRecipient("");
      setTransferAmount("");
    },
    onError: (error: any) => {
      toast({
        title: "Transfer failed",
        description: error.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  const handleTransfer = () => {
    if (!transferRecipient || !transferAmount) {
      toast({
        title: "Missing fields",
        description: "Please enter recipient address and amount",
        variant: "destructive",
      });
      return;
    }
    transferMutation.mutate({
      tokenMint: transferToken,
      recipientAddress: transferRecipient,
      amount: transferAmount,
    });
  };

  // Get available tokens for transfer (USDC + holdings)
  const transferableTokens = [
    { mint: USDC_MINT, symbol: "USDC", balance: usdcBalance },
    ...(holdings || []).map((h: any) => ({ mint: h.mint, symbol: h.symbol, balance: parseFloat(h.balance) }))
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Value hero strip */}
        <div className="rise-in rounded-xl border border-card-border bg-gradient-to-br from-card to-background p-6 md:p-8 relative overflow-hidden">
          <div className="absolute inset-0 bg-grid fade-grid opacity-40 pointer-events-none" />
          <div className="relative flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground" data-testid="text-portfolio-title">
                Portfolio value
              </p>
              {holdingsLoading ? (
                <Skeleton className="h-12 w-48 mt-2" />
              ) : (
                <p className="text-num text-4xl md:text-5xl font-semibold mt-1" data-testid="text-total-value">
                  ${totalValue.toFixed(2)}
                </p>
              )}
              <p className="text-sm text-muted-foreground mt-2 flex items-center gap-2">
                <Wallet className="w-3.5 h-3.5" />
                <span className="text-num" data-testid="text-usdc-balance">
                  ${usdcBalance.toFixed(2)}
                </span>
                USDC available to trade
              </p>
            </div>

            <div className="flex items-end gap-6">
              <div>
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Assets</p>
                {holdingsLoading ? (
                  <Skeleton className="h-7 w-10 mt-1" />
                ) : (
                  <p className="text-num text-xl font-semibold mt-0.5" data-testid="text-asset-count">
                    {holdings?.length || 0}
                  </p>
                )}
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Trades</p>
                {tradesLoading ? (
                  <Skeleton className="h-7 w-10 mt-1" />
                ) : (
                  <p className="text-num text-xl font-semibold mt-0.5" data-testid="text-trade-total">
                    {trades?.length || 0}
                  </p>
                )}
              </div>

              <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" data-testid="button-send-tokens">
                    <Send className="w-4 h-4 mr-2" />
                    Send tokens
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Send tokens</DialogTitle>
                    <DialogDescription>
                      Transfer tokens to another Solana wallet address
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="token" className="text-[11px] uppercase tracking-widest text-muted-foreground">Token</Label>
                      <Select value={transferToken} onValueChange={setTransferToken}>
                        <SelectTrigger data-testid="select-transfer-token">
                          <SelectValue placeholder="Select token" />
                        </SelectTrigger>
                        <SelectContent>
                          {transferableTokens.map((token) => (
                            <SelectItem key={token.mint} value={token.mint} data-testid={`token-option-${token.symbol}`}>
                              {token.symbol} (Balance: {typeof token.balance === 'number' ? token.balance.toFixed(token.symbol === 'USDC' ? 2 : 6) : token.balance})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="recipient" className="text-[11px] uppercase tracking-widest text-muted-foreground">Recipient address</Label>
                      <Input
                        id="recipient"
                        placeholder="Enter Solana wallet address"
                        value={transferRecipient}
                        onChange={(e) => setTransferRecipient(e.target.value)}
                        className="font-mono text-sm"
                        data-testid="input-recipient-address"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="amount" className="text-[11px] uppercase tracking-widest text-muted-foreground">Amount</Label>
                      <div className="flex gap-2">
                        <Input
                          id="amount"
                          type="number"
                          placeholder="Enter amount"
                          value={transferAmount}
                          onChange={(e) => setTransferAmount(e.target.value)}
                          data-testid="input-transfer-amount"
                          className="flex-1 text-num"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const selectedToken = transferableTokens.find(t => t.mint === transferToken);
                            if (selectedToken) {
                              const maxAmount = selectedToken.symbol === 'USDC'
                                ? selectedToken.balance.toFixed(2)
                                : selectedToken.balance.toFixed(6);
                              setTransferAmount(maxAmount);
                            }
                          }}
                          data-testid="button-max-amount"
                        >
                          Max
                        </Button>
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setTransferDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleTransfer}
                      disabled={transferMutation.isPending}
                      data-testid="button-confirm-transfer"
                    >
                      {transferMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        "Send"
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>

        {/* Sell Confirmation Dialog */}
        <Dialog open={sellDialogOpen} onOpenChange={(open) => {
          if (!open) {
            setSellDialogOpen(false);
            setSellQuote(null);
          }
        }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Confirm sell</DialogTitle>
              <DialogDescription>
                Review your swap details before confirming
              </DialogDescription>
            </DialogHeader>

            {isLoadingQuote ? (
              <div className="py-8 flex flex-col items-center justify-center gap-4">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-muted-foreground">Getting best price...</p>
              </div>
            ) : sellQuote ? (
              <div className="space-y-6 py-4">
                {/* Swap Preview */}
                <div className="flex items-center justify-between gap-4 p-4 rounded-lg border border-border bg-muted/30">
                  <div className="text-center flex-1">
                    <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">You sell</p>
                    <p className="text-num text-2xl font-semibold text-bear">{sellQuote.inputAmount}</p>
                    <p className="font-mono font-bold text-sm mt-0.5">{sellQuote.symbol}</p>
                  </div>
                  <ArrowRight className="w-6 h-6 text-muted-foreground flex-shrink-0" />
                  <div className="text-center flex-1">
                    <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">You receive</p>
                    <p className="text-num text-2xl font-semibold text-bull">${sellQuote.outputAmount}</p>
                    <p className="font-mono font-bold text-sm mt-0.5">USDC</p>
                  </div>
                </div>

                {/* Price Impact Warning */}
                {parseFloat(sellQuote.priceImpactPct) > 1 && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                    <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                    <p className="text-sm text-yellow-500">
                      Price impact: <span className="text-num">{parseFloat(sellQuote.priceImpactPct).toFixed(2)}%</span>
                    </p>
                  </div>
                )}

                <div className="text-xs text-muted-foreground text-center">
                  Quote is valid for a limited time. Final amount may vary slightly.
                </div>
              </div>
            ) : null}

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setSellDialogOpen(false);
                  setSellQuote(null);
                }}
                disabled={sellMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmSell}
                disabled={!sellQuote || sellMutation.isPending || isLoadingQuote}
                data-testid="button-confirm-sell"
              >
                {sellMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Selling...
                  </>
                ) : (
                  "Confirm sell"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Tabs defaultValue="holdings" className="w-full rise-in">
          <TabsList>
            <TabsTrigger value="holdings" data-testid="tab-holdings">Holdings</TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">Trade history</TabsTrigger>
            <TabsTrigger value="transfers" data-testid="tab-transfers">Transfers</TabsTrigger>
          </TabsList>

          <TabsContent value="holdings" className="mt-4">
            {holdingsLoading ? (
              <LoadingRows />
            ) : holdings?.length > 0 ? (
              <Card>
                <CardContent className="p-2 md:p-3">
                  <div className="divide-y divide-border">
                    {holdings.map((holding: any) => {
                      const isProfit = holding.profitLoss !== null && holding.profitLoss >= 0;
                      const hasData = holding.profitLoss !== null;

                      return (
                        <div
                          key={holding.mint}
                          className="flex items-center gap-3 md:gap-4 px-2 md:px-3 py-3.5 hover-elevate rounded-lg"
                          data-testid={`holding-row-${holding.symbol}`}
                        >
                          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <span className="font-mono text-sm font-bold text-primary">
                              {holding.symbol?.slice(0, 2)}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-mono font-bold text-sm">
                              ${holding.underlyingTicker || holding.symbol}
                            </p>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              <span className="text-num">{holding.balance}</span> {holding.symbol}
                              {holding.price ? (
                                <span className="hidden sm:inline">
                                  {" "}· <span className="text-num">${holding.price.toFixed(2)}</span> each
                                </span>
                              ) : null}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-num text-sm font-semibold">
                              {holding.usdValue ? `$${holding.usdValue.toFixed(2)}` : "—"}
                            </p>
                            {hasData ? (
                              <p className={`text-num text-xs mt-0.5 ${isProfit ? "text-bull" : "text-bear"}`}>
                                {formatSignedUsd(holding.profitLoss)}
                                <span className="hidden sm:inline">
                                  {" "}({isProfit ? "+" : ""}{holding.profitLossPct?.toFixed(1)}%)
                                </span>
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground mt-0.5">—</p>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                            data-testid={`button-sell-${holding.symbol}`}
                            onClick={() => handleSellClick(holding.underlyingTicker, holding.balance)}
                          >
                            Sell
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent>
                  <EmptyState
                    icon={Wallet}
                    title="No holdings yet"
                    description="Execute trades to see your tokenized stock holdings here"
                  />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            {tradesLoading ? (
              <LoadingRows />
            ) : trades && trades.length > 0 ? (
              <Card>
                <CardContent className="p-2 md:p-3">
                  <div className="divide-y divide-border">
                    {trades.map((trade: any) => (
                      <div
                        key={trade.id}
                        className="flex items-center gap-3 md:gap-4 px-2 md:px-3 py-3.5"
                        data-testid={`trade-row-${trade.id}`}
                      >
                        <SignalBadge action={trade.isBuy ? "BUY" : "SELL"} size="sm" className="shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">
                            <span className="text-num text-bear">-{trade.inputAmountDisplay}</span>{" "}
                            <span className="font-mono font-bold">{trade.inputTicker}</span>
                            <ArrowRight className="w-3 h-3 inline mx-1.5 text-muted-foreground" />
                            <span className="text-num text-bull">
                              {trade.outputAmountDisplay ? `+${trade.outputAmountDisplay}` : "—"}
                            </span>{" "}
                            <span className="font-mono font-bold">{trade.outputTicker}</span>
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatDistanceToNow(new Date(trade.createdAt), { addSuffix: true })}
                          </p>
                        </div>
                        <StatusChip status={trade.status} />
                        {trade.txSig && (
                          <a
                            href={`https://solscan.io/tx/${trade.txSig}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-1 text-xs shrink-0"
                            data-testid={`link-tx-${trade.id}`}
                          >
                            <ExternalLink className="w-3 h-3" />
                            View
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent>
                  <EmptyState
                    icon={Clock}
                    title="No trades yet"
                    description="Your trade history will appear here"
                  />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="transfers" className="mt-4">
            {transfersLoading ? (
              <LoadingRows />
            ) : transfersData && transfersData.length > 0 ? (
              <Card>
                <CardContent className="p-2 md:p-3">
                  <div className="divide-y divide-border">
                    {transfersData.map((transfer: any) => {
                      const incoming = transfer.direction === "incoming";
                      return (
                        <div
                          key={transfer.id}
                          className="flex items-center gap-3 md:gap-4 px-2 md:px-3 py-3.5"
                          data-testid={`transfer-row-${transfer.id}`}
                        >
                          <div
                            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                              incoming ? "bg-bull/10 text-bull" : "bg-bear/10 text-bear"
                            }`}
                          >
                            {incoming ? (
                              <ArrowDownLeft className="w-4 h-4" />
                            ) : (
                              <ArrowUpRight className="w-4 h-4" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm">
                              <span className={`text-num font-semibold ${incoming ? "text-bull" : "text-bear"}`}>
                                {incoming ? "+" : "-"}{transfer.amountDisplay ?? transfer.amount}
                              </span>{" "}
                              <span className="font-mono font-bold">{transfer.symbol || "TOKEN"}</span>
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                              {incoming ? "from " : "to "}
                              <span className="text-num">
                                {shortAddress(incoming ? transfer.fromAddress : transfer.toAddress)}
                              </span>
                              {" "}· {formatDistanceToNow(new Date(transfer.createdAt), { addSuffix: true })}
                            </p>
                          </div>
                          {transfer.txSig && (
                            <a
                              href={`https://solscan.io/tx/${transfer.txSig}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline inline-flex items-center gap-1 text-xs shrink-0"
                              data-testid={`link-transfer-tx-${transfer.id}`}
                            >
                              <ExternalLink className="w-3 h-3" />
                              View
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent>
                  <EmptyState
                    icon={Send}
                    title="No transfers yet"
                    description="Deposits and withdrawals from your wallet will appear here"
                  />
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
