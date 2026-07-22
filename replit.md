# Arena - X Influencer Trading Alert App

## Overview
Arena is a trading alert application that monitors X (Twitter) influencer accounts for stock trading signals, uses AI (GPT-5.1) to classify tweets and identify actionable buy/sell recommendations, sends real-time Telegram alerts to subscribed users, and enables one-tap execution of Solana onchain trades via Jupiter (USDC → Ondo tokenized stocks).

## Tech Stack
- **Frontend**: React + TypeScript + Vite + TanStack Query + shadcn/ui + Tailwind CSS
- **Backend**: Express.js + TypeScript + Drizzle ORM
- **Database**: PostgreSQL (Neon)
- **Authentication**: Privy with Solana embedded wallets
- **AI**: OpenAI GPT-5.1 via Replit AI Integrations
- **Trading**: Jupiter Ultra API (RFQ-based) for Ondo tokenized stock swaps
- **Notifications**: Telegram Bot API
- **Tweet Source**: X API (optional - stub provider as fallback)

## Project Structure
```
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/AppLayout.tsx    # Main app layout with sidebar
│   │   │   └── ui/                     # shadcn components
│   │   ├── lib/
│   │   │   ├── privy.tsx               # Privy auth provider
│   │   │   └── queryClient.ts          # TanStack Query setup with auth
│   │   ├── pages/
│   │   │   ├── landing.tsx             # Landing page
│   │   │   ├── dashboard.tsx           # Main dashboard
│   │   │   ├── influencers.tsx         # Influencer management
│   │   │   ├── influencer-detail.tsx   # Influencer detail view
│   │   │   ├── alerts.tsx              # Alerts feed
│   │   │   ├── portfolio.tsx           # Holdings & trade history
│   │   │   ├── settings.tsx            # User settings (one-tap trading)
│   │   │   ├── admin.tsx               # Asset registry admin
│   │   │   └── trade-confirm.tsx       # Trade confirmation flow
│   │   └── App.tsx                     # Router setup
├── server/
│   ├── services/
│   │   ├── tweetProvider.ts            # X API / stub provider
│   │   ├── classifier.ts               # AI tweet classification
│   │   ├── jupiter.ts                  # Jupiter swap integration
│   │   ├── telegram.ts                 # Telegram bot service
│   │   └── privy.ts                    # Privy auth & wallet API service
│   ├── workers/
│   │   └── index.ts                    # Background workers (polling, classification)
│   ├── routes.ts                       # API routes
│   ├── storage.ts                      # Database storage layer
│   └── index.ts                        # Server entry point
└── shared/
    └── schema.ts                       # Drizzle schema & types
```

## Database Schema
- **users**: User accounts linked to Privy with Solana wallet and Telegram
- **influencers**: X influencer profiles being tracked
- **subscriptions**: User subscriptions to influencers
- **tweets**: Ingested tweets from influencers
- **classifications**: AI classification results for tweets
- **alert_events**: Actionable signals extracted from classifications
- **user_alerts**: Per-user alert instances
- **prepared_orders**: Jupiter swap quotes ready for execution
- **trades**: Executed trades with transaction signatures
- **asset_registry**: Ondo tokenized stock mappings (ticker → Solana mint)
- **telegram_link_tokens**: One-time tokens for Telegram account linking
- **muted_tickers**: User ticker mute preferences

## Environment Variables Required
- `PRIVY_APP_ID` / `PRIVY_APP_SECRET`: Privy authentication
- `VITE_PRIVY_APP_ID`: Frontend Privy App ID
- `TELEGRAM_BOT_TOKEN`: Telegram bot for notifications
- `SOLANA_RPC_URL`: Solana RPC endpoint
- `USDC_MINT`: USDC token mint address
- `ADMIN_EMAIL`: Email for admin access
- `SESSION_SECRET`: Session encryption
- `X_API_BEARER_TOKEN`: (Optional) TwitterAPI.io key for real tweet polling
- `JUPITER_API_KEY`: Jupiter API key for Ultra API access
- `AI_INTEGRATIONS_OPENAI_API_KEY` / `AI_INTEGRATIONS_OPENAI_BASE_URL`: OpenAI access for tweet classification (falls back to `OPENAI_API_KEY`/`OPENAI_BASE_URL`; without any key the classifier degrades to regex cashtag matching and mention-only alerts)
- `CLASSIFIER_MODEL`: (Optional) model for classification, default `gpt-5.1`
- `MIN_ALERT_CONFIDENCE`: (Optional) per-ticker confidence threshold for alerts, default `0.6`
- `TWEET_POLL_MINUTES`: (Optional) tweet polling cadence, default `15`

## Key Features
1. **Privy Authentication**: Email, wallet, Google, Twitter login with embedded Solana wallets
2. **Influencer Management**: Add X profiles via URL, enable/disable alerts
3. **AI Classification**: GPT-5.1 analyzes tweets for BUY/SELL signals with confidence scores
4. **Telegram Alerts**: Real-time notifications with inline trade buttons
5. **Jupiter Swaps**: Prepare and execute USDC → Ondo token swaps
6. **Portfolio Tracking**: View token balances and trade history
7. **Admin Panel**: Manage asset registry (ticker → mint mappings)
8. **One-Tap Trading**: Server-side trade execution via Privy delegated actions (optional)

## Trader Performance & Guardrails
- Alert events snapshot the token's USD price at signal time (Jupiter-quote derived, `alert_events.price_usd_at_event`); per-trader track records (avg return per call, win rate, hypothetical $10-per-call P&L) are computed on demand and exposed on `/api/subscriptions` and `/api/influencers/:id`
- An hourly worker sends a Telegram "24h check-in" with real P&L for each completed buy (`trades.performance_notified_at` marks sent)
- `users.daily_spend_cap_usd` (settable in Settings) hard-limits Telegram one-tap buys per UTC day
- After schema changes run `npm run db:push` (adds the three columns above)

## Background Workers
- **Tweet Polling**: Every 15 minutes, polls new tweets from tracked influencers
- **Classification**: Every 1 minute, classifies unprocessed tweets via GPT (structured output: per-ticker sentiment BULLISH/BEARISH/NEUTRAL, action BUY/SELL/NONE, confidence). Only directional signals ≥ MIN_ALERT_CONFIDENCE become alert events; without an AI key, cashtag mentions alert as neutral "MENTION"s
- **Alert Distribution**: Sends action-aware Telegram alerts (BUY/SELL signal headline, confidence, AI reason) with direction-ordered trade buttons

## Design Theme
"Signal terminal" design system (see client/src/index.css): near-black graphite base, volt-lime brand accent (`--primary`), emerald/red reserved strictly for buy/sell semantics (`--bull`/`--bear`), Space Grotesk display headings, Inter body, JetBrains Mono tabular numerals for all figures (`text-num`). Signals always render via the shared `SignalBadge` component.
