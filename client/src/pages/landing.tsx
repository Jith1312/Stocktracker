import { Link, Redirect } from "wouter";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { SignalBadge, ConfidenceMeter } from "@/components/SignalBadge";
import {
  Zap,
  Bell,
  Wallet,
  ArrowRight,
  Shield,
  Bot
} from "lucide-react";
import { SiSolana, SiTelegram, SiX } from "react-icons/si";

const steps = [
  {
    icon: SiX,
    step: "01",
    title: "A trader posts",
    description:
      "Follow the X accounts whose calls you trust. We watch every post, so you don't have to.",
  },
  {
    icon: Bot,
    step: "02",
    title: "AI classifies the signal",
    description:
      "Our engine reads the post, extracts the ticker, and scores it BUY, SELL, or noise — in seconds.",
  },
  {
    icon: Zap,
    step: "03",
    title: "You trade in one tap",
    description:
      "The signal lands in your Telegram with a trade button. Tap it and the swap executes on Solana.",
  },
];

const features = [
  {
    icon: Shield,
    title: "Non-custodial",
    description: "Your keys, your coins. Funds live in your own embedded Solana wallet.",
  },
  {
    icon: Zap,
    title: "Instant execution",
    description: "Prepared transactions mean one tap in Telegram is all it takes.",
  },
  {
    icon: Bell,
    title: "Smart signals",
    description: "AI filters the noise and surfaces only high-confidence calls.",
  },
  {
    icon: Wallet,
    title: "Tokenized stocks",
    description: "Trade Ondo assets like TSLAon and AMZNon directly on Solana.",
  },
];

function Wordmark() {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center glow-volt">
        <Zap className="w-5 h-5 text-primary-foreground" strokeWidth={2.5} />
      </div>
      <div>
        <span className="font-display text-lg font-bold leading-none text-foreground block">ARENA</span>
        <span className="text-[11px] text-muted-foreground tracking-wide uppercase hidden sm:block">
          Trade the signal
        </span>
      </div>
    </div>
  );
}

export default function Landing() {
  const { login, authenticated, ready } = usePrivy();

  if (ready && authenticated) {
    return <Redirect to="/dashboard" />;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Sticky glass nav */}
      <header className="glass sticky top-0 z-50 border-b border-border">
        <div className="max-w-6xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <Wordmark />
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

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-grid fade-grid pointer-events-none" />
        <div className="relative max-w-6xl mx-auto px-4 md:px-6 pt-20 pb-16 md:pt-28 md:pb-24">
          <div className="grid lg:grid-cols-[1.2fr_1fr] gap-12 lg:gap-16 items-center">
            <div className="rise-in space-y-7">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3.5 py-1.5 text-xs font-medium text-primary">
                <span className="w-1.5 h-1.5 rounded-full bg-primary pulse-dot" />
                Powered by Solana &amp; Ondo Finance
              </div>

              <h1 className="font-display text-5xl md:text-6xl lg:text-7xl font-bold leading-[0.95] tracking-tight">
                Trade the
                <span className="block text-primary">signal.</span>
              </h1>

              <p className="text-lg md:text-xl text-muted-foreground max-w-xl leading-relaxed">
                Follow the traders you trust on X. Our AI reads their calls, pings
                your Telegram, and you buy tokenized stocks on Solana — in one tap.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                {authenticated ? (
                  <Link href="/dashboard">
                    <Button size="lg" className="px-8 glow-volt w-full sm:w-auto" data-testid="button-dashboard-hero">
                      Open Dashboard
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </Button>
                  </Link>
                ) : (
                  <Button size="lg" className="px-8 glow-volt w-full sm:w-auto" onClick={login} data-testid="button-start-hero">
                    Start Trading
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                )}
                <Button size="lg" variant="outline" className="px-8 w-full sm:w-auto" asChild data-testid="button-learn-more">
                  <a href="#how-it-works">How it works</a>
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-x-8 gap-y-3 pt-4 text-muted-foreground">
                <div className="flex items-center gap-2">
                  <SiX className="w-4 h-4" />
                  <span className="text-sm">X signals</span>
                </div>
                <div className="flex items-center gap-2">
                  <SiTelegram className="w-4 h-4" />
                  <span className="text-sm">Telegram alerts</span>
                </div>
                <div className="flex items-center gap-2">
                  <SiSolana className="w-4 h-4" />
                  <span className="text-sm">Solana trades</span>
                </div>
              </div>
            </div>

            {/* Mock signal alert card */}
            <div className="rise-in relative">
              <div className="absolute -inset-8 bg-primary/5 blur-3xl rounded-full pointer-events-none" />
              <div className="relative rounded-xl border border-card-border bg-card p-5 shadow-2xl">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                    Signal detected
                  </p>
                  <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground">
                    <span className="w-1.5 h-1.5 rounded-full bg-bull pulse-dot" />
                    Live
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <span className="font-mono font-bold text-lg">$TSLA</span>
                  <SignalBadge action="BUY" confidence={0.92} />
                  <span className="text-xs text-muted-foreground">@techtrader · 12s</span>
                </div>

                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  "Tesla delivery numbers just crushed estimates. Loading up here
                  before the market wakes up. This is the move."
                </p>

                <ConfidenceMeter action="BUY" confidence={0.92} className="mb-4" />

                <div className="rounded-lg border border-border bg-muted/30 p-3 mb-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">You buy</span>
                    <span className="text-num font-semibold">$50.00 USDC</span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-1.5">
                    <span className="text-muted-foreground">You receive</span>
                    <span className="text-num font-semibold">
                      ~0.1156 <span className="font-mono">TSLAon</span>
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button className="flex-1 pointer-events-none" tabIndex={-1} aria-hidden="true">
                    <Zap className="w-4 h-4 mr-2" />
                    Trade now
                  </Button>
                  <Button variant="outline" className="pointer-events-none" tabIndex={-1} aria-hidden="true">
                    Dismiss
                  </Button>
                </div>

                <p className="flex items-center gap-1.5 justify-center text-[11px] text-muted-foreground mt-4">
                  <SiTelegram className="w-3 h-3" />
                  Delivered to your Telegram
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-t border-border py-20 md:py-24 px-4 md:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3">
              How it works
            </p>
            <h2 className="font-display text-3xl md:text-4xl font-bold">
              From post to position in seconds
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-4 md:gap-6 relative">
            {steps.map((s, i) => (
              <div
                key={s.step}
                className="rise-in relative rounded-xl border border-card-border bg-card p-6 md:p-8"
              >
                <div className="flex items-center justify-between mb-6">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <s.icon className="w-5 h-5 text-primary" />
                  </div>
                  <span className="text-num text-sm text-muted-foreground">{s.step}</span>
                </div>
                <h3 className="font-display text-xl font-semibold mb-2">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.description}</p>
                {i < steps.length - 1 && (
                  <div className="hidden md:flex absolute top-1/2 -right-5 z-10 w-8 h-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
                    <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Arena */}
      <section className="border-t border-border py-20 md:py-24 px-4 md:px-6 bg-card/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3">
              Why Arena
            </p>
            <h2 className="font-display text-3xl md:text-4xl font-bold">
              Built for speed, kept in your control
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {features.map((f) => (
              <div
                key={f.title}
                className="rise-in rounded-xl border border-card-border bg-card p-6 hover-elevate"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                  <f.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-display font-semibold mb-1.5">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative border-t border-border overflow-hidden">
        <div className="absolute inset-0 bg-grid fade-grid pointer-events-none" />
        <div className="relative max-w-3xl mx-auto text-center px-4 md:px-6 py-20 md:py-28 space-y-6">
          <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight">
            Never miss the call.
          </h2>
          <p className="text-lg text-muted-foreground">
            Join the traders who turn signals into positions before the crowd.
          </p>
          <div className="pt-2">
            {authenticated ? (
              <Link href="/dashboard">
                <Button size="lg" className="px-10 glow-volt" data-testid="button-cta-dashboard">
                  Go to Dashboard
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link>
            ) : (
              <Button size="lg" className="px-10 glow-volt" onClick={login} data-testid="button-cta-start">
                Get Started Free
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-4 md:px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="w-4 h-4 text-primary-foreground" strokeWidth={2.5} />
            </div>
            <span className="font-display font-bold">ARENA</span>
          </div>
          <p className="text-sm text-muted-foreground text-center md:text-right">
            Trade tokenized assets on Solana. Not financial advice.
          </p>
        </div>
      </footer>
    </div>
  );
}
