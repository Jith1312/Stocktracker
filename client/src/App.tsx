import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PrivyProviderWrapper } from "@/lib/privy";
import { usePrivy } from "@privy-io/react-auth";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import Influencers from "@/pages/influencers";
import InfluencerDetail from "@/pages/influencer-detail";
import Alerts from "@/pages/alerts";
import Portfolio from "@/pages/portfolio";
import Admin from "@/pages/admin";
import TradeConfirm from "@/pages/trade-confirm";
import Settings from "@/pages/settings";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { authenticated, ready } = usePrivy();

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!authenticated) {
    return <Redirect to="/" />;
  }

  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/dashboard">
        {() => <ProtectedRoute component={Dashboard} />}
      </Route>
      <Route path="/influencers">
        {() => <ProtectedRoute component={Influencers} />}
      </Route>
      <Route path="/influencers/:id">
        {() => <ProtectedRoute component={InfluencerDetail} />}
      </Route>
      <Route path="/alerts">
        {() => <ProtectedRoute component={Alerts} />}
      </Route>
      <Route path="/portfolio">
        {() => <ProtectedRoute component={Portfolio} />}
      </Route>
      <Route path="/admin">
        {() => <ProtectedRoute component={Admin} />}
      </Route>
      <Route path="/trade/confirm">
        {() => <ProtectedRoute component={TradeConfirm} />}
      </Route>
      <Route path="/settings">
        {() => <ProtectedRoute component={Settings} />}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <PrivyProviderWrapper>
          <Router />
          <Toaster />
        </PrivyProviderWrapper>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
