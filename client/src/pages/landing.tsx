import { Link } from "wouter";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Zap, 
  TrendingUp, 
  Bell, 
  Wallet,
  ArrowRight,
  Shield,
  Globe,
  Bot
} from "lucide-react";
import { SiSolana, SiTelegram, SiX } from "react-icons/si";

export default function Landing() {
  const { login, authenticated } = usePrivy();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center glow-green">
              <Zap className="w-6 h-6 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold">Arena</span>
          </div>
          
          {authenticated ? (
            <Link href="/dashboard">
              <Button data-testid="button-go-dashboard">
                Go to Dashboard
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          ) : (
            <Button onClick={login} data-testid="button-login">
              Get Started
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}
        </div>
      </header>

      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <Badge variant="secondary" className="text-sm px-4 py-1">
            Powered by Solana & Ondo Finance
          </Badge>
          
          <h1 className="text-5xl md:text-6xl font-bold leading-tight">
            Trade Tokenized Stocks
            <span className="text-primary block">From X Influencer Signals</span>
          </h1>
          
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Follow your favorite X influencers, get AI-powered trading signals via Telegram, 
            and execute onchain trades in one tap. No more missing calls.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            {authenticated ? (
              <Link href="/dashboard">
                <Button size="lg" className="text-lg px-8" data-testid="button-dashboard-hero">
                  Open Dashboard
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link>
            ) : (
              <Button size="lg" className="text-lg px-8" onClick={login} data-testid="button-start-hero">
                Start Trading
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            )}
            <Button size="lg" variant="outline" className="text-lg px-8" data-testid="button-learn-more">
              Learn More
            </Button>
          </div>

          <div className="flex items-center justify-center gap-8 pt-8 text-muted-foreground">
            <div className="flex items-center gap-2">
              <SiX className="w-5 h-5" />
              <span className="text-sm">X Integration</span>
            </div>
            <div className="flex items-center gap-2">
              <SiTelegram className="w-5 h-5" />
              <span className="text-sm">Telegram Alerts</span>
            </div>
            <div className="flex items-center gap-2">
              <SiSolana className="w-5 h-5" />
              <span className="text-sm">Solana Trades</span>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">How It Works</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Three simple steps to start trading on influencer signals
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <Card className="border-border bg-card">
              <CardContent className="pt-8 text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <Globe className="w-8 h-8 text-primary" />
                </div>
                <div className="text-4xl font-bold text-primary">1</div>
                <h3 className="text-xl font-semibold">Add Influencers</h3>
                <p className="text-muted-foreground">
                  Paste X profile URLs of influencers you want to follow for stock calls
                </p>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardContent className="pt-8 text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <Bot className="w-8 h-8 text-primary" />
                </div>
                <div className="text-4xl font-bold text-primary">2</div>
                <h3 className="text-xl font-semibold">Get AI Alerts</h3>
                <p className="text-muted-foreground">
                  AI classifies tweets and sends actionable buy/sell signals to your Telegram
                </p>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardContent className="pt-8 text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <TrendingUp className="w-8 h-8 text-primary" />
                </div>
                <div className="text-4xl font-bold text-primary">3</div>
                <h3 className="text-xl font-semibold">Execute Trades</h3>
                <p className="text-muted-foreground">
                  One-tap swap USDC to tokenized stocks via Jupiter on Solana
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-20 px-6 border-t border-border bg-card/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Why Arena?</h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-6 rounded-lg bg-background border border-border space-y-3">
              <Shield className="w-8 h-8 text-primary" />
              <h3 className="font-semibold">Non-Custodial</h3>
              <p className="text-sm text-muted-foreground">
                Your keys, your coins. We never hold your funds.
              </p>
            </div>

            <div className="p-6 rounded-lg bg-background border border-border space-y-3">
              <Zap className="w-8 h-8 text-primary" />
              <h3 className="font-semibold">Instant Execution</h3>
              <p className="text-sm text-muted-foreground">
                Trade directly from Telegram with prepared transactions.
              </p>
            </div>

            <div className="p-6 rounded-lg bg-background border border-border space-y-3">
              <Bell className="w-8 h-8 text-primary" />
              <h3 className="font-semibold">Smart Alerts</h3>
              <p className="text-sm text-muted-foreground">
                AI filters noise and sends only high-confidence signals.
              </p>
            </div>

            <div className="p-6 rounded-lg bg-background border border-border space-y-3">
              <Wallet className="w-8 h-8 text-primary" />
              <h3 className="font-semibold">Ondo Assets</h3>
              <p className="text-sm text-muted-foreground">
                Trade tokenized stocks like TSLAon, AMZNon on Solana.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-3xl mx-auto text-center space-y-8">
          <h2 className="text-3xl font-bold">Ready to Start?</h2>
          <p className="text-muted-foreground text-lg">
            Join traders who never miss an opportunity
          </p>
          {authenticated ? (
            <Link href="/dashboard">
              <Button size="lg" className="text-lg px-12" data-testid="button-cta-dashboard">
                Go to Dashboard
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
          ) : (
            <Button size="lg" className="text-lg px-12" onClick={login} data-testid="button-cta-start">
              Get Started Free
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          )}
        </div>
      </section>

      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-semibold">Arena</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Trade tokenized assets on Solana. Not financial advice.
          </p>
        </div>
      </footer>
    </div>
  );
}
