import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Redirect } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Trash2,
  Edit,
  Shield,
  Database,
  Copy,
  Check,
  Loader2
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";

interface UserProfile {
  isAdmin?: boolean;
}

interface Asset {
  id: number;
  underlyingTicker: string;
  ondoSymbol: string;
  solanaMint: string;
  tokenProgram: "SPL" | "TOKEN_2022";
  decimals: number;
  isActive: boolean;
}

const assetSchema = z.object({
  underlyingTicker: z.string().min(1, "Ticker is required").max(10),
  ondoSymbol: z.string().min(1, "Ondo symbol is required"),
  solanaMint: z.string().min(32, "Invalid Solana mint address"),
  tokenProgram: z.enum(["SPL", "TOKEN_2022"]),
  decimals: z.coerce.number().min(0).max(18),
  isActive: z.boolean(),
});

type AssetForm = z.infer<typeof assetSchema>;

const emptyForm: AssetForm = {
  underlyingTicker: "",
  ondoSymbol: "",
  solanaMint: "",
  tokenProgram: "SPL",
  decimals: 6,
  isActive: true,
};

function truncateMint(mint: string): string {
  if (mint.length <= 12) return mint;
  return `${mint.slice(0, 6)}...${mint.slice(-4)}`;
}

export default function Admin() {
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [copiedMint, setCopiedMint] = useState<number | null>(null);
  const { toast } = useToast();

  const { data: profile, isLoading: profileLoading } = useQuery<UserProfile>({
    queryKey: ["/api/user/profile"],
  });

  const { data: assets, isLoading } = useQuery<Asset[]>({
    queryKey: ["/api/admin/assets"],
    enabled: profile?.isAdmin,
  });

  const form = useForm<AssetForm>({
    resolver: zodResolver(assetSchema),
    defaultValues: emptyForm,
  });

  const addMutation = useMutation({
    mutationFn: (data: AssetForm) =>
      editingAsset
        ? apiRequest("PUT", `/api/admin/assets/${editingAsset.id}`, data)
        : apiRequest("POST", "/api/admin/assets", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/assets"] });
      setEditingAsset(null);
      form.reset(emptyForm);
      toast({
        title: editingAsset ? "Asset updated" : "Asset added",
        description: "The asset registry has been updated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to save asset",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/assets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/assets"] });
      toast({
        title: "Asset removed",
        description: "The asset has been removed from the registry",
      });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiRequest("PATCH", `/api/admin/assets/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/assets"] });
    },
  });

  if (profileLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!profile?.isAdmin) {
    return <Redirect to="/dashboard" />;
  }

  const openEditDialog = (asset: Asset) => {
    setEditingAsset(asset);
    form.reset({
      underlyingTicker: asset.underlyingTicker,
      ondoSymbol: asset.ondoSymbol,
      solanaMint: asset.solanaMint,
      tokenProgram: asset.tokenProgram,
      decimals: asset.decimals,
      isActive: asset.isActive,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEdit = () => {
    setEditingAsset(null);
    form.reset(emptyForm);
  };

  const startAdd = () => {
    setEditingAsset(null);
    form.reset(emptyForm);
    form.setFocus("underlyingTicker");
  };

  const onSubmit = (data: AssetForm) => {
    addMutation.mutate(data);
  };

  const copyMint = (asset: Asset) => {
    navigator.clipboard.writeText(asset.solanaMint);
    setCopiedMint(asset.id);
    toast({ title: "Mint copied", description: asset.solanaMint });
    setTimeout(() => setCopiedMint(null), 2000);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Page header */}
        <div className="rise-in flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="font-display text-2xl font-bold" data-testid="text-admin-title">Asset Registry</h1>
            <p className="text-sm text-muted-foreground">Ondo tokenized assets available for trading</p>
          </div>
          <Button variant="outline" onClick={startAdd} data-testid="button-add-asset">
            <Plus className="w-4 h-4 mr-2" />
            Add Asset
          </Button>
        </div>

        {/* Add / edit form */}
        <Card className={`rise-in rounded-xl ${editingAsset ? "border-primary/30" : ""}`}>
          <CardHeader className="pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              {editingAsset ? <Edit className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4 text-primary" />}
              {editingAsset ? (
                <>
                  Edit asset
                  <span className="font-mono font-bold text-primary">${editingAsset.underlyingTicker}</span>
                </>
              ) : (
                "Add asset"
              )}
            </CardTitle>
            <CardDescription>
              {editingAsset
                ? "Update the asset details, then save"
                : "Register a new Ondo tokenized asset for trading"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="underlyingTicker"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[11px] uppercase tracking-widest text-muted-foreground">
                          Underlying ticker
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="TSLA" className="font-mono" {...field} data-testid="input-ticker" />
                        </FormControl>
                        <FormDescription>Stock ticker (e.g., TSLA, AAPL)</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="ondoSymbol"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[11px] uppercase tracking-widest text-muted-foreground">
                          Ondo symbol
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="TSLAon" className="font-mono" {...field} data-testid="input-ondo-symbol" />
                        </FormControl>
                        <FormDescription>Tokenized version (e.g., TSLAon)</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="solanaMint"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[11px] uppercase tracking-widest text-muted-foreground">
                        Solana mint address
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="Enter mint address" className="font-mono" {...field} data-testid="input-mint" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="tokenProgram"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[11px] uppercase tracking-widest text-muted-foreground">
                          Token program
                        </FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-token-program">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="SPL">SPL</SelectItem>
                            <SelectItem value="TOKEN_2022">Token 2022</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="decimals"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[11px] uppercase tracking-widest text-muted-foreground">
                          Decimals
                        </FormLabel>
                        <FormControl>
                          <Input type="number" className="text-num" {...field} data-testid="input-decimals" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="isActive"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-lg border border-border px-3 py-2 sm:mt-[22px]">
                        <FormLabel className="text-sm font-medium">Active</FormLabel>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-active"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  {editingAsset && (
                    <Button type="button" variant="ghost" onClick={cancelEdit} data-testid="button-cancel-edit">
                      Cancel
                    </Button>
                  )}
                  <Button type="submit" disabled={addMutation.isPending} data-testid="button-save-asset">
                    {addMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : editingAsset ? (
                      <Edit className="w-4 h-4 mr-2" />
                    ) : (
                      <Plus className="w-4 h-4 mr-2" />
                    )}
                    {addMutation.isPending ? "Saving..." : editingAsset ? "Update" : "Add Asset"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* Registry table */}
        <Card className="rise-in rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <div className="flex items-center gap-3">
              <Database className="w-4 h-4 text-muted-foreground" />
              <div>
                <CardTitle className="text-base">Registered assets</CardTitle>
                <CardDescription>
                  <span className="text-num">{assets?.length ?? 0}</span> in registry
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : assets && assets.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-[11px] uppercase tracking-widest">Ticker</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest">Ondo symbol</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest">Mint</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest">Program</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest text-right">Decimals</TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest">Active</TableHead>
                      <TableHead className="text-right"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assets.map((asset) => (
                      <TableRow key={asset.id} data-testid={`asset-row-${asset.id}`}>
                        <TableCell className="font-mono font-bold">
                          ${asset.underlyingTicker}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {asset.ondoSymbol}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <code className="font-mono text-xs text-foreground/80">
                              {truncateMint(asset.solanaMint)}
                            </code>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="w-6 h-6 text-muted-foreground"
                              onClick={() => copyMint(asset)}
                              data-testid={`button-copy-mint-${asset.id}`}
                            >
                              {copiedMint === asset.id ? (
                                <Check className="w-3 h-3 text-bull" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {asset.tokenProgram}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-num text-right">{asset.decimals}</TableCell>
                        <TableCell>
                          <Switch
                            checked={asset.isActive}
                            onCheckedChange={(isActive) => toggleMutation.mutate({ id: asset.id, isActive })}
                            data-testid={`switch-toggle-${asset.id}`}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-muted-foreground"
                              onClick={() => openEditDialog(asset)}
                              data-testid={`button-edit-${asset.id}`}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-bear"
                              onClick={() => deleteMutation.mutate(asset.id)}
                              data-testid={`button-delete-${asset.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="w-12 h-12 mx-auto rounded-xl bg-muted flex items-center justify-center mb-4">
                  <Database className="w-5 h-5 text-muted-foreground" />
                </div>
                <p className="font-medium">No assets in the registry</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Add your first tokenized asset with the form above
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
