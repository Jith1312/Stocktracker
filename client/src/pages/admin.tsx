import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { 
  Plus, 
  Settings,
  Trash2,
  Edit,
  Shield,
  Database
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";

const assetSchema = z.object({
  underlyingTicker: z.string().min(1, "Ticker is required").max(10),
  ondoSymbol: z.string().min(1, "Ondo symbol is required"),
  solanaMint: z.string().min(32, "Invalid Solana mint address"),
  tokenProgram: z.enum(["SPL", "TOKEN_2022"]),
  decimals: z.coerce.number().min(0).max(18),
  isActive: z.boolean(),
});

type AssetForm = z.infer<typeof assetSchema>;

export default function Admin() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<any>(null);
  const { toast } = useToast();

  const { data: assets, isLoading } = useQuery({
    queryKey: ["/api/admin/assets"],
  });

  const form = useForm<AssetForm>({
    resolver: zodResolver(assetSchema),
    defaultValues: {
      underlyingTicker: "",
      ondoSymbol: "",
      solanaMint: "",
      tokenProgram: "SPL",
      decimals: 6,
      isActive: true,
    },
  });

  const addMutation = useMutation({
    mutationFn: (data: AssetForm) => 
      editingAsset 
        ? apiRequest("PUT", `/api/admin/assets/${editingAsset.id}`, data)
        : apiRequest("POST", "/api/admin/assets", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/assets"] });
      setDialogOpen(false);
      setEditingAsset(null);
      form.reset();
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

  const openEditDialog = (asset: any) => {
    setEditingAsset(asset);
    form.reset({
      underlyingTicker: asset.underlyingTicker,
      ondoSymbol: asset.ondoSymbol,
      solanaMint: asset.solanaMint,
      tokenProgram: asset.tokenProgram,
      decimals: asset.decimals,
      isActive: asset.isActive,
    });
    setDialogOpen(true);
  };

  const openAddDialog = () => {
    setEditingAsset(null);
    form.reset({
      underlyingTicker: "",
      ondoSymbol: "",
      solanaMint: "",
      tokenProgram: "SPL",
      decimals: 6,
      isActive: true,
    });
    setDialogOpen(true);
  };

  const onSubmit = (data: AssetForm) => {
    addMutation.mutate(data);
  };

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold" data-testid="text-admin-title">Admin</h1>
              <p className="text-muted-foreground">Manage asset registry and system settings</p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-3">
              <Database className="w-5 h-5 text-muted-foreground" />
              <div>
                <CardTitle>Asset Registry</CardTitle>
                <CardDescription>Ondo tokenized assets available for trading</CardDescription>
              </div>
            </div>
            <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingAsset(null); }}>
              <DialogTrigger asChild>
                <Button onClick={openAddDialog} data-testid="button-add-asset">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Asset
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>{editingAsset ? "Edit Asset" : "Add Asset"}</DialogTitle>
                  <DialogDescription>
                    {editingAsset ? "Update the asset details" : "Add a new Ondo tokenized asset to the registry"}
                  </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="underlyingTicker"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Underlying Ticker</FormLabel>
                          <FormControl>
                            <Input placeholder="TSLA" {...field} data-testid="input-ticker" />
                          </FormControl>
                          <FormDescription>The stock ticker (e.g., TSLA, AAPL)</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="ondoSymbol"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Ondo Symbol</FormLabel>
                          <FormControl>
                            <Input placeholder="TSLAon" {...field} data-testid="input-ondo-symbol" />
                          </FormControl>
                          <FormDescription>The tokenized version (e.g., TSLAon)</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="solanaMint"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Solana Mint Address</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter mint address" {...field} data-testid="input-mint" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="tokenProgram"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Token Program</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                            <FormLabel>Decimals</FormLabel>
                            <FormControl>
                              <Input type="number" {...field} data-testid="input-decimals" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="isActive"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel>Active</FormLabel>
                            <FormDescription>
                              Enable trading for this asset
                            </FormDescription>
                          </div>
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
                    <div className="flex justify-end gap-3 pt-4">
                      <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={addMutation.isPending} data-testid="button-save-asset">
                        {addMutation.isPending ? "Saving..." : editingAsset ? "Update" : "Add Asset"}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : assets?.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticker</TableHead>
                    <TableHead>Ondo Symbol</TableHead>
                    <TableHead>Mint Address</TableHead>
                    <TableHead>Program</TableHead>
                    <TableHead>Decimals</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assets.map((asset: any) => (
                    <TableRow key={asset.id} data-testid={`asset-row-${asset.id}`}>
                      <TableCell className="font-semibold">{asset.underlyingTicker}</TableCell>
                      <TableCell>{asset.ondoSymbol}</TableCell>
                      <TableCell className="font-mono text-sm max-w-[200px] truncate">
                        {asset.solanaMint}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{asset.tokenProgram}</Badge>
                      </TableCell>
                      <TableCell>{asset.decimals}</TableCell>
                      <TableCell>
                        <Switch
                          checked={asset.isActive}
                          onCheckedChange={(isActive) => toggleMutation.mutate({ id: asset.id, isActive })}
                          data-testid={`switch-toggle-${asset.id}`}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button 
                            size="icon" 
                            variant="ghost"
                            onClick={() => openEditDialog(asset)}
                            data-testid={`button-edit-${asset.id}`}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            className="text-destructive"
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
            ) : (
              <div className="text-center py-12">
                <Database className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground mb-4">No assets in the registry</p>
                <Button onClick={openAddDialog}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add First Asset
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
