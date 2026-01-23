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
- `X_API_BEARER_TOKEN`: (Optional) X API for real tweet polling
- `JUPITER_API_KEY`: Jupiter API key for Ultra API access

## Key Features
1. **Privy Authentication**: Email, wallet, Google, Twitter login with embedded Solana wallets
2. **Influencer Management**: Add X profiles via URL, enable/disable alerts
3. **AI Classification**: GPT-5.1 analyzes tweets for BUY/SELL signals with confidence scores
4. **Telegram Alerts**: Real-time notifications with inline trade buttons
5. **Jupiter Swaps**: Prepare and execute USDC → Ondo token swaps
6. **Portfolio Tracking**: View token balances and trade history
7. **Admin Panel**: Manage asset registry (ticker → mint mappings)
8. **One-Tap Trading**: Server-side trade execution via Privy delegated actions (optional)

## Background Workers
- **Tweet Polling**: Every 2 minutes, polls new tweets from tracked influencers
- **Classification**: Every 1 minute, classifies unprocessed tweets via AI
- **Alert Distribution**: Sends Telegram alerts to subscribers for actionable signals

## Design Theme
Dark trading theme with green (#22c55e) primary color for bullish signals. Uses shadcn/ui components with custom trading-focused styling.
