import { useQuery, useMutation } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  Wallet, 
  TrendingUp, 
  TrendingDown,
  ExternalLink,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Loader2
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState } from "react";

export default function Portfolio() {
  const { authenticated } = usePrivy();
  const { toast } = useToast();
  const [sellingTicker, setSellingTicker] = useState<string | null>(null);
  
  const { data: holdings, isLoading: holdingsLoading } = useQuery({
    queryKey: ["/api/portfolio/holdings"],
    enabled: authenticated,
  });

  const { data: trades, isLoading: tradesLoading } = useQuery({
    queryKey: ["/api/trades"],
    enabled: authenticated,
  });

  const sellMutation = useMutation({
    mutationFn: async ({ ticker, amount }: { ticker: string; amount: string }) => {
      const res = await apiRequest("POST", "/api/trade/sell", { ticker, amount });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Sell successful!",
        description: `Transaction: ${data.signature?.slice(0, 12)}...`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/holdings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      setSellingTicker(null);
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

  const handleSell = async (ticker: string, balance: string) => {
    setSellingTicker(ticker);
    sellMutation.mutate({ ticker, amount: balance });
  };

  const totalValue = holdings?.reduce((acc: number, h: any) => acc + (h.usdValue || 0), 0) || 0;

  return (
    <AppLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-portfolio-title">Portfolio</h1>
          <p className="text-muted-foreground mt-1">View your holdings and trade history</p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Holdings</CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {holdingsLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <>
                  <div className="text-2xl font-bold" data-testid="text-total-value">
                    ${totalValue.toFixed(2)}
                  </div>
                  <p className="text-xs text-muted-foreground">Estimated USD value</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Assets</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {holdingsLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <div className="text-2xl font-bold" data-testid="text-asset-count">
                    {holdings?.length || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">Tokenized stocks</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Trades</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {tradesLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <div className="text-2xl font-bold" data-testid="text-trade-total">
                    {trades?.length || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">All time</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="holdings" className="w-full">
          <TabsList>
            <TabsTrigger value="holdings" data-testid="tab-holdings">Holdings</TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">Trade History</TabsTrigger>
          </TabsList>

          <TabsContent value="holdings" className="mt-6">
            {holdingsLoading ? (
              <Card>
                <CardContent className="pt-6">
                  <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : holdings?.length > 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Asset</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                        <TableHead className="text-right">USD Value</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {holdings.map((holding: any) => (
                        <TableRow key={holding.mint} data-testid={`holding-row-${holding.symbol}`}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                <span className="text-sm font-bold text-primary">
                                  {holding.symbol?.slice(0, 2)}
                                </span>
                              </div>
                              <div>
                                <p className="font-medium">{holding.symbol}</p>
                                <p className="text-sm text-muted-foreground">{holding.underlyingTicker}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {holding.balance}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            ${holding.usdValue?.toFixed(2) || "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button 
                              size="sm" 
                              variant="outline" 
                              data-testid={`button-sell-${holding.symbol}`}
                              onClick={() => handleSell(holding.underlyingTicker, holding.balance)}
                              disabled={sellingTicker === holding.underlyingTicker}
                            >
                              {sellingTicker === holding.underlyingTicker ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                  Selling...
                                </>
                              ) : (
                                "Sell"
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-16 text-center">
                  <Wallet className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-xl font-semibold mb-2">No holdings yet</h3>
                  <p className="text-muted-foreground">
                    Execute trades to see your tokenized stock holdings here
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-6">
            {tradesLoading ? (
              <Card>
                <CardContent className="pt-6">
                  <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : trades?.length > 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Asset</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                        <TableHead className="text-right">Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {trades.map((trade: any) => {
                        const isBuy = trade.inputMint?.includes("USDC");
                        return (
                          <TableRow key={trade.id} data-testid={`trade-row-${trade.id}`}>
                            <TableCell>
                              <div className={`flex items-center gap-2 ${isBuy ? "text-green-500" : "text-red-500"}`}>
                                {isBuy ? (
                                  <ArrowUpRight className="w-4 h-4" />
                                ) : (
                                  <ArrowDownRight className="w-4 h-4" />
                                )}
                                <span className="font-medium">{isBuy ? "Buy" : "Sell"}</span>
                              </div>
                            </TableCell>
                            <TableCell className="font-medium">
                              {trade.outputSymbol || trade.outputMint?.slice(0, 8)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              ${(parseFloat(trade.amountIn) / 1000000).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge 
                                variant={trade.status === "COMPLETED" ? "default" : 
                                        trade.status === "PENDING" ? "secondary" : "destructive"}
                              >
                                {trade.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground">
                              {formatDistanceToNow(new Date(trade.createdAt), { addSuffix: true })}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-16 text-center">
                  <Clock className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-xl font-semibold mb-2">No trades yet</h3>
                  <p className="text-muted-foreground">
                    Your trade history will appear here
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
