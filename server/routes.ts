import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { z } from "zod";
import { Connection, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { createTransferInstruction, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAccount, getMint } from "@solana/spl-token";
import { PrivyClient } from "@privy-io/server-auth";
import { randomBytes } from "crypto";
import { tweetProvider, isNewerTweetId } from "./services/tweetProvider";
import { syncFilterRules } from "./services/tweetFilterRules";
import { classifyTweet, shouldCreateAlert, getClassifierModel } from "./services/classifier";
import * as jupiter from "./services/jupiter";
import * as telegram from "./services/telegram";
import * as privyService from "./services/privy";
import * as performanceService from "./services/performance";
import { pollInfluencerTweets, sendBackfillAlerts, classifyAndAlertTweet } from "./workers";

const privy = new PrivyClient(
  process.env.PRIVY_APP_ID!,
  process.env.PRIVY_APP_SECRET!
);

// Use Helius RPC if available for better rate limits
const getRpcUrl = () => {
  if (process.env.HELIUS_API_KEY) {
    return `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
  }
  return process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
};
const connection = new Connection(getRpcUrl());

const USDC_MINT = process.env.USDC_MINT || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Last authenticated push from twitterapi.io (in-memory; resets on restart)
let lastTwitterWebhookAt: Date | null = null;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.slice(7);
    const verifiedClaims = await privy.verifyAuthToken(token);
    
    let user = await storage.getUserByPrivyId(verifiedClaims.userId);
    
    try {
      const privyUser = await privy.getUser(verifiedClaims.userId);
      const email = privyUser?.email?.address || null;
      
      // Get Solana wallet - check linked accounts for embedded Solana wallet
      let solanaPubkey: string | null = null;
      if (privyUser?.linkedAccounts) {
        const solanaWallet: any = privyUser.linkedAccounts.find(
          (account: any) => account.type === 'wallet' && account.chainType === 'solana'
        );
        solanaPubkey = solanaWallet?.address || null;
      }
      // Fallback to legacy wallet field
      if (!solanaPubkey && privyUser?.wallet?.address) {
        solanaPubkey = privyUser.wallet.address;
      }
      
      if (!user) {
        try {
          user = await storage.createUser({ 
            privyId: verifiedClaims.userId,
            email,
            solanaPubkey,
          });
        } catch (createError: any) {
          if (createError?.code === '23505') {
            user = await storage.getUserByPrivyId(verifiedClaims.userId);
          } else {
            throw createError;
          }
        }
      } else {
        const needsUpdate = 
          (email && email !== user.email) || 
          (solanaPubkey && solanaPubkey !== user.solanaPubkey);
        
        if (needsUpdate) {
          user = await storage.updateUser(user.id, {
            ...(email && email !== user.email ? { email } : {}),
            ...(solanaPubkey && solanaPubkey !== user.solanaPubkey ? { solanaPubkey } : {}),
          }) || user;
        }
      }
    } catch (privyError) {
      console.error("[Auth] Privy user fetch error:", privyError);
      if (!user) {
        try {
          user = await storage.createUser({ 
            privyId: verifiedClaims.userId,
            email: null,
            solanaPubkey: null,
          });
        } catch (createError: any) {
          if (createError?.code === '23505') {
            user = await storage.getUserByPrivyId(verifiedClaims.userId);
          } else {
            throw createError;
          }
        }
      }
    }
    
    if (!user) {
      return res.status(401).json({ error: "Failed to get or create user" });
    }
    
    (req as any).user = user;
    (req as any).privyUserId = verifiedClaims.userId;
    next();
  } catch (error) {
    console.error("[Auth] Error:", error);
    return res.status(401).json({ error: "Invalid token" });
  }
}

async function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user?.email || user.email !== ADMIN_EMAIL) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Public config endpoint for frontend - returns non-sensitive configuration
  app.get("/api/config", (req: Request, res: Response) => {
    res.json({
      keyQuorumId: process.env.VITE_PRIVY_KEY_QUORUM_ID || null,
      authKeyConfigured: !!process.env.PRIVY_AUTHORIZATION_KEY,
    });
  });

  // Public, aggregate-only pipeline diagnostics — answers "is ingestion
  // alive?" without exposing any user data.
  app.get("/api/health", async (_req: Request, res: Response) => {
    try {
      const stats = await storage.getIngestionStats();
      res.json({
        status: "ok",
        now: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        classifier: getClassifierModel(),
        telegramConfigured: !!process.env.TELEGRAM_BOT_TOKEN,
        twitterApiConfigured: !!process.env.X_API_BEARER_TOKEN,
        lastTwitterWebhookAt,
        ...stats,
      });
    } catch (error) {
      console.error("[API] Health error:", error);
      res.status(500).json({ status: "error", error: String(error) });
    }
  });

  app.get("/api/user/profile", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      
      const privyUser = await privy.getUser((req as any).privyUserId);
      const walletAddress = privyUser?.wallet?.address || user.solanaPubkey;
      
      if (walletAddress && walletAddress !== user.solanaPubkey) {
        await storage.updateUser(user.id, { solanaPubkey: walletAddress });
      }

      const userEmail = user.email || privyUser?.email?.address;
      res.json({
        id: user.id,
        email: userEmail,
        solanaPubkey: walletAddress,
        telegramChatId: user.telegramChatId,
        telegramUsername: user.telegramUsername,
        defaultBuyAmountUsd: user.defaultBuyAmountUsd,
        dailySpendCapUsd: user.dailySpendCapUsd,
        autoExecuteEnabled: user.autoExecuteEnabled,
        signerEnabled: user.signerEnabled,
        privyWalletId: user.privyWalletId,
        onboardingCompleted: user.onboardingCompleted,
        isAdmin: userEmail === ADMIN_EMAIL,
      });
    } catch (error) {
      console.error("[API] Profile error:", error);
      res.status(500).json({ error: "Failed to get profile" });
    }
  });

  app.patch("/api/user/profile", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { defaultBuyAmountUsd, dailySpendCapUsd, autoExecuteEnabled, onboardingCompleted } = req.body;

      const updateData: { defaultBuyAmountUsd?: string; dailySpendCapUsd?: string | null; autoExecuteEnabled?: boolean; onboardingCompleted?: boolean } = {};

      if (defaultBuyAmountUsd !== undefined) {
        const amount = parseFloat(defaultBuyAmountUsd);
        if (isNaN(amount) || amount <= 0 || amount > 10000) {
          res.status(400).json({ error: "Invalid amount. Must be between $1 and $10,000" });
          return;
        }
        updateData.defaultBuyAmountUsd = amount.toString();
      }

      if (dailySpendCapUsd !== undefined) {
        if (dailySpendCapUsd === null || dailySpendCapUsd === "") {
          updateData.dailySpendCapUsd = null;
        } else {
          const cap = parseFloat(dailySpendCapUsd);
          if (isNaN(cap) || cap <= 0 || cap > 100000) {
            res.status(400).json({ error: "Invalid daily cap. Must be between $1 and $100,000, or empty to disable" });
            return;
          }
          updateData.dailySpendCapUsd = cap.toString();
        }
      }
      
      if (autoExecuteEnabled !== undefined) {
        if (typeof autoExecuteEnabled !== 'boolean') {
          res.status(400).json({ error: "Invalid autoExecuteEnabled value" });
          return;
        }
        updateData.autoExecuteEnabled = autoExecuteEnabled;
      }
      
      if (onboardingCompleted !== undefined) {
        if (typeof onboardingCompleted !== 'boolean') {
          res.status(400).json({ error: "Invalid onboardingCompleted value" });
          return;
        }
        updateData.onboardingCompleted = onboardingCompleted;
      }
      
      const updated = await storage.updateUser(user.id, updateData);
      
      res.json(updated);
    } catch (error) {
      console.error("[API] Update profile error:", error);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  app.get("/api/user/signer-status", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      res.json({
        signerEnabled: user.signerEnabled || false,
        privyWalletId: user.privyWalletId,
        autoExecuteEnabled: user.autoExecuteEnabled || false,
        authKeyConfigured: !!process.env.PRIVY_AUTHORIZATION_KEY,
      });
    } catch (error) {
      console.error("[API] Signer status error:", error);
      res.status(500).json({ error: "Failed to get signer status" });
    }
  });

  app.post("/api/user/enable-signer", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      
      if (!process.env.PRIVY_AUTHORIZATION_KEY) {
        res.status(400).json({ error: "Server-side signing not configured. Please contact support." });
        return;
      }
      
      const walletId = await privyService.getEmbeddedWalletId((req as any).privyUserId);
      
      if (!walletId) {
        res.status(400).json({ error: "No embedded wallet found. Please create a wallet first." });
        return;
      }
      
      await storage.updateUser(user.id, { 
        signerEnabled: true,
        privyWalletId: walletId,
        autoExecuteEnabled: true,
      });
      
      res.json({ 
        success: true, 
        signerEnabled: true,
        privyWalletId: walletId,
      });
    } catch (error) {
      console.error("[API] Enable signer error:", error);
      res.status(500).json({ error: "Failed to enable signer" });
    }
  });

  app.get("/api/user/stats", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      
      const subscriptions = await storage.getSubscriptionsByUser(user.id);
      const alerts = await storage.getUserAlertsByUser(user.id, 100);
      const trades = await storage.getTradesByUser(user.id);
      
      let usdcBalance = "0.00";
      if (user.solanaPubkey) {
        try {
          const balance = await jupiter.getTokenBalance(connection, user.solanaPubkey, USDC_MINT);
          usdcBalance = (parseInt(balance.balance) / 1000000).toFixed(2);
        } catch (e) {
          console.error("[API] Balance error:", e);
        }
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const alertsToday = alerts.filter(a => new Date(a.createdAt) >= today).length;

      res.json({
        usdcBalance,
        influencerCount: subscriptions.length,
        alertsToday,
        tradeCount: trades.length,
      });
    } catch (error) {
      console.error("[API] Stats error:", error);
      res.status(500).json({ error: "Failed to get stats" });
    }
  });

  app.get("/api/subscriptions", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const subs = await storage.getSubscriptionsByUser(user.id);
      
      const enriched = await Promise.all(subs.map(async (sub) => {
        const influencer = await storage.getInfluencer(sub.influencerId);
        let performance = null;
        try {
          performance = await performanceService.computeInfluencerPerformance(sub.influencerId);
        } catch (e) {
          console.error(`[API] Performance calc error for influencer ${sub.influencerId}:`, e);
        }
        return { ...sub, influencer, performance };
      }));

      res.json(enriched);
    } catch (error) {
      console.error("[API] Subscriptions error:", error);
      res.status(500).json({ error: "Failed to get subscriptions" });
    }
  });

  app.post("/api/influencers", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { profileUrl } = req.body;

      const urlPattern = /(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/;
      const match = profileUrl.match(urlPattern);
      if (!match) {
        return res.status(400).json({ error: "Invalid X profile URL" });
      }

      const handle = match[1].toLowerCase();
      
      let influencer = await storage.getInfluencerByHandle(handle);
      if (!influencer) {
        const userInfo = await tweetProvider.getUserInfo(handle);
        influencer = await storage.createInfluencer({
          platform: "X",
          handle,
          profileUrl,
          platformUserId: userInfo?.userId,
          displayName: userInfo?.displayName,
          avatarUrl: userInfo?.avatarUrl,
        });
      }

      const existing = await storage.getSubscriptionByUserAndInfluencer(user.id, influencer.id);
      if (existing) {
        return res.status(400).json({ error: "Already subscribed to this influencer" });
      }

      const subscription = await storage.createSubscription({
        userId: user.id,
        influencerId: influencer.id,
        enabled: true,
      });

      // Trigger instant tweet poll for this influencer (don't await - run in background)
      pollInfluencerTweets(influencer.id).catch(err =>
        console.error(`[API] Background poll error for influencer ${influencer.id}:`, err)
      );

      // Keep twitterapi.io push rules in sync with who we track
      syncFilterRules().catch(err => console.error("[API] Filter rule sync error:", err));

      // Send backfill alerts to the user for recent signals from this influencer
      sendBackfillAlerts(user.id, influencer.id).catch(err =>
        console.error(`[API] Backfill alerts error for user ${user.id}:`, err)
      );

      res.status(201).json({ subscription, influencer });
    } catch (error) {
      console.error("[API] Add influencer error:", error);
      res.status(500).json({ error: "Failed to add influencer" });
    }
  });

  app.get("/api/influencers/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      const influencer = await storage.getInfluencer(id);
      if (!influencer) {
        return res.status(404).json({ error: "Influencer not found" });
      }
      let performance = null;
      try {
        performance = await performanceService.computeInfluencerPerformance(id);
      } catch (e) {
        console.error(`[API] Performance calc error for influencer ${id}:`, e);
      }
      const tweets = await storage.getTweetsByInfluencer(id, 500);
      const alertEvents = await storage.getAlertEventsByInfluencer(id, 500);
      res.json({
        ...influencer,
        performance,
        tweetCount: tweets.length,
        alertCount: alertEvents.length,
      });
    } catch (error) {
      console.error("[API] Get influencer error:", error);
      res.status(500).json({ error: "Failed to get influencer" });
    }
  });

  app.get("/api/influencers/:id/tweets", authMiddleware, async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      const tweets = await storage.getTweetsByInfluencer(id, 100);
      
      // Get all Ondo tickers for filtering
      const assets = await storage.getAssetRegistry();
      const ondoTickers = new Set(assets.map(a => a.underlyingTicker.toUpperCase()));
      
      const enriched = await Promise.all(tweets.map(async (tweet) => {
        const classification = await storage.getClassificationByTweetId(tweet.id);
        const tickers = (classification?.resultJson as any)?.tickers || [];
        return {
          ...tweet,
          classification: classification ? {
            isActionable: classification.isActionable,
            tickers,
          } : null,
        };
      }));
      
      // Filter to only tweets with Ondo-supported tickers
      const filtered = enriched.filter(tweet => {
        if (!tweet.classification?.tickers) return false;
        return tweet.classification.tickers.some((t: any) => 
          ondoTickers.has(t.ticker?.toUpperCase())
        );
      });
      
      // Return last 10 matching tweets
      res.json(filtered.slice(0, 10));
    } catch (error) {
      console.error("[API] Get tweets error:", error);
      res.status(500).json({ error: "Failed to get tweets" });
    }
  });

  // The user's subscription for a given influencer (used by the trader
  // detail page's signals toggle).
  app.get("/api/subscriptions/influencer/:influencerId", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const influencerId = parseInt(String(req.params.influencerId));
      const subscription = await storage.getSubscriptionByUserAndInfluencer(user.id, influencerId);
      if (!subscription) {
        return res.status(404).json({ error: "Not subscribed to this influencer" });
      }
      res.json(subscription);
    } catch (error) {
      console.error("[API] Get subscription error:", error);
      res.status(500).json({ error: "Failed to get subscription" });
    }
  });

  app.patch("/api/subscriptions/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      const { enabled, amountOverrideUsd } = req.body;
      
      const updated = await storage.updateSubscription(id, { enabled, amountOverrideUsd });
      syncFilterRules().catch(err => console.error("[API] Filter rule sync error:", err));
      res.json(updated);
    } catch (error) {
      console.error("[API] Update subscription error:", error);
      res.status(500).json({ error: "Failed to update subscription" });
    }
  });

  app.delete("/api/subscriptions/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      await storage.deleteSubscription(id);
      syncFilterRules().catch(err => console.error("[API] Filter rule sync error:", err));
      res.status(204).send();
    } catch (error) {
      console.error("[API] Delete subscription error:", error);
      res.status(500).json({ error: "Failed to delete subscription" });
    }
  });

  app.get("/api/alerts", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const userAlerts = await storage.getUserAlertsByUser(user.id, 100);
      
      const enriched = await Promise.all(userAlerts.map(async (ua) => {
        const alertEvent = await storage.getAlertEvent(ua.alertEventId);
        if (!alertEvent) return null;

        const tweet = await storage.getTweet(alertEvent.tweetId);
        const influencer = tweet ? await storage.getInfluencer(tweet.influencerId) : null;
        const classification = await storage.getClassification(alertEvent.classificationId);

        return {
          id: ua.id,
          status: ua.status,
          createdAt: ua.createdAt,
          ticker: alertEvent.ticker,
          sentiment: alertEvent.sentiment,
          action: alertEvent.action,
          confidence: alertEvent.confidence,
          priceUsdAtEvent: alertEvent.priceUsdAtEvent,
          reason: (classification?.resultJson as any)?.reason ?? null,
          tweetText: tweet?.text,
          tweetUrl: tweet?.url,
          tweetCreatedAt: tweet?.tweetCreatedAt,
          influencerHandle: influencer?.handle,
        };
      }));
      
      res.json(enriched.filter(Boolean));
    } catch (error) {
      console.error("[API] Alerts error:", error);
      res.status(500).json({ error: "Failed to get alerts" });
    }
  });

  app.get("/api/trades", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const trades = await storage.getTradesByUser(user.id);
      const assets = await storage.getAssetRegistry();
      
      // Create a mint to asset lookup
      const mintToAsset: Record<string, any> = {};
      for (const asset of assets) {
        mintToAsset[asset.solanaMint] = asset;
      }
      
      // Calculate prices from sell trades (token -> USDC)
      const tradePrices: Record<string, number> = {};
      for (const trade of trades) {
        if (trade.outputMint === USDC_MINT && trade.amountIn && trade.amountOut) {
          const inputAsset = mintToAsset[trade.inputMint || ""];
          const inputDecimals = inputAsset?.decimals || 9;
          const tokenAmount = parseFloat(trade.amountIn) / Math.pow(10, inputDecimals);
          const usdcAmount = parseFloat(trade.amountOut) / Math.pow(10, 6);
          if (tokenAmount > 0) {
            tradePrices[trade.inputMint!] = usdcAmount / tokenAmount;
          }
        }
      }
      
      // Enrich trades with token info
      const enrichedTrades = trades.map(trade => {
        const inputAsset = mintToAsset[trade.inputMint || ""];
        const outputAsset = mintToAsset[trade.outputMint || ""];
        const isUsdcInput = trade.inputMint === USDC_MINT;
        const isUsdcOutput = trade.outputMint === USDC_MINT;
        
        // Calculate display amounts
        const inputDecimals = isUsdcInput ? 6 : (inputAsset?.decimals || 9);
        const outputDecimals = isUsdcOutput ? 6 : (outputAsset?.decimals || 9);
        
        const inputAmount = trade.amountIn ? parseFloat(trade.amountIn) / Math.pow(10, inputDecimals) : 0;
        let outputAmount = trade.amountOut ? parseFloat(trade.amountOut) / Math.pow(10, outputDecimals) : null;
        
        // For buy trades without amountOut, estimate from price
        if (isUsdcInput && outputAmount === null && trade.outputMint) {
          const price = tradePrices[trade.outputMint];
          if (price && price > 0) {
            outputAmount = inputAmount / price;
          }
        }
        
        return {
          ...trade,
          inputSymbol: isUsdcInput ? "USDC" : (inputAsset?.ondoSymbol || inputAsset?.underlyingTicker || "Unknown"),
          outputSymbol: isUsdcOutput ? "USDC" : (outputAsset?.ondoSymbol || outputAsset?.underlyingTicker || "Unknown"),
          inputTicker: isUsdcInput ? "USDC" : (inputAsset?.underlyingTicker || "Unknown"),
          outputTicker: isUsdcOutput ? "USDC" : (outputAsset?.underlyingTicker || "Unknown"),
          inputAmountDisplay: inputAmount.toFixed(isUsdcInput ? 2 : 6),
          outputAmountDisplay: outputAmount?.toFixed(isUsdcOutput ? 2 : 6) || null,
          isBuy: isUsdcInput, // Buying tokens with USDC
        };
      });
      
      res.json(enrichedTrades);
    } catch (error) {
      console.error("[API] Trades error:", error);
      res.status(500).json({ error: "Failed to get trades" });
    }
  });

  app.get("/api/portfolio/holdings", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user.solanaPubkey) {
        return res.json({ holdings: [], usdcBalance: 0, totalValue: 0 });
      }

      // Get USDC balance
      const usdcBalance = await jupiter.getTokenBalance(connection, user.solanaPubkey, USDC_MINT);
      const usdcDisplayBalance = parseFloat(jupiter.rawAmountToDisplay(usdcBalance.balance, 6));

      const assets = await storage.getAssetRegistry();
      const activeAssets = assets.filter(a => a.isActive && a.solanaMint !== USDC_MINT);
      
      // First, get all balances
      const holdingsWithBalance = await Promise.all(activeAssets.map(async (asset) => {
        try {
          const balance = await jupiter.getTokenBalance(connection, user.solanaPubkey, asset.solanaMint);
          const displayBalance = jupiter.rawAmountToDisplay(balance.balance, balance.decimals);
          
          if (parseFloat(displayBalance) === 0) return null;
          
          return {
            mint: asset.solanaMint,
            symbol: asset.ondoSymbol,
            underlyingTicker: asset.underlyingTicker,
            balance: displayBalance,
            balanceNum: parseFloat(displayBalance),
          };
        } catch (e) {
          return null;
        }
      }));
      
      const validHoldings = holdingsWithBalance.filter(Boolean) as Array<{
        mint: string;
        symbol: string;
        underlyingTicker: string;
        balance: string;
        balanceNum: number;
      }>;
      
      // Fetch live prices using Jupiter Ultra quote API (most accurate for trading)
      const prices: Record<string, number> = {};
      const quoteAmount = "1000000000"; // 1 token (9 decimals for Ondo tokens)
      
      // Fetch quotes in parallel for all holdings (sell 1 token -> get USDC value)
      const pricePromises = validHoldings.map(async (holding, index) => {
        // Stagger requests slightly to avoid rate limits
        await new Promise(r => setTimeout(r, index * 50));
        
        try {
          const url = `https://api.jup.ag/ultra/v1/order?inputMint=${holding.mint}&outputMint=${USDC_MINT}&amount=${quoteAmount}`;
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (process.env.JUPITER_API_KEY) {
            headers["x-api-key"] = process.env.JUPITER_API_KEY;
          }
          
          const res = await fetch(url, { 
            headers,
            signal: AbortSignal.timeout(8000),
          });
          
          if (res.ok) {
            const data = await res.json();
            // outAmount is USDC (6 decimals) for selling 1 token
            if (data.outAmount) {
              const usdcOut = parseFloat(data.outAmount) / 1_000_000;
              prices[holding.mint] = usdcOut; // Price = USDC received for 1 token
              console.log(`[Portfolio] Live price for ${holding.underlyingTicker}: $${usdcOut.toFixed(2)}`);
            }
          }
        } catch (e) {
          // Silently skip failed quotes
        }
      });
      
      await Promise.all(pricePromises);
      
      // Get trades for cost basis calculation
      const trades = await storage.getTradesByUser(user.id);
      
      // Calculate cost basis from trades for each token
      const costBasisByMint: Record<string, { totalCost: number; totalTokens: number }> = {};
      
      for (const trade of trades) {
        // Buy trades (USDC -> Token): add to cost basis
        if (trade.inputMint === USDC_MINT && trade.outputMint && trade.amountIn && trade.amountOut) {
          const usdcSpent = parseFloat(trade.amountIn) / 1_000_000;
          const tokensReceived = parseFloat(trade.amountOut) / 1_000_000_000;
          
          if (!costBasisByMint[trade.outputMint]) {
            costBasisByMint[trade.outputMint] = { totalCost: 0, totalTokens: 0 };
          }
          costBasisByMint[trade.outputMint].totalCost += usdcSpent;
          costBasisByMint[trade.outputMint].totalTokens += tokensReceived;
        }
        // Sell trades (Token -> USDC): reduce position proportionally
        if (trade.outputMint === USDC_MINT && trade.inputMint && trade.amountIn && trade.amountOut) {
          const tokensSold = parseFloat(trade.amountIn) / 1_000_000_000;
          
          if (costBasisByMint[trade.inputMint] && costBasisByMint[trade.inputMint].totalTokens > 0) {
            const proportionSold = tokensSold / costBasisByMint[trade.inputMint].totalTokens;
            costBasisByMint[trade.inputMint].totalCost *= (1 - proportionSold);
            costBasisByMint[trade.inputMint].totalTokens -= tokensSold;
          }
        }
      }
      
      // Add USD values using live Jupiter quote prices
      const holdingsWithValue = validHoldings.map(h => {
        const price = prices[h.mint] || null;
        const currentValue = price ? h.balanceNum * price : null;
        
        const costData = costBasisByMint[h.mint];
        const avgCostBasis = costData && costData.totalTokens > 0 
          ? costData.totalCost / costData.totalTokens 
          : null;
        const totalCostBasis = costData?.totalCost || null;
        
        let profitLoss = null;
        let profitLossPct = null;
        
        if (currentValue !== null && totalCostBasis !== null && totalCostBasis > 0) {
          profitLoss = currentValue - totalCostBasis;
          profitLossPct = ((currentValue - totalCostBasis) / totalCostBasis) * 100;
        }
        
        return {
          mint: h.mint,
          symbol: h.symbol,
          underlyingTicker: h.underlyingTicker,
          balance: h.balance,
          usdValue: currentValue,
          price: price,
          avgCostBasis: avgCostBasis,
          totalCostBasis: totalCostBasis,
          profitLoss: profitLoss,
          profitLossPct: profitLossPct,
        };
      });
      
      // Calculate total: USDC + stock holdings
      const stocksValue = holdingsWithValue.reduce((acc, h) => acc + (h.usdValue || 0), 0);
      const totalValue = usdcDisplayBalance + stocksValue;
      
      res.json({ 
        holdings: holdingsWithValue, 
        usdcBalance: usdcDisplayBalance,
        totalValue: totalValue
      });
    } catch (error) {
      console.error("[API] Holdings error:", error);
      res.status(500).json({ error: "Failed to get holdings" });
    }
  });

  app.post("/api/trade/prepare", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { alertId, amount, ticker } = req.body;

      if (!user.solanaPubkey) {
        return res.status(400).json({ error: "Wallet not connected" });
      }

      let outputMint: string | undefined;
      let outputSymbol: string | undefined;

      if (ticker) {
        const asset = await storage.getAssetByTicker(ticker);
        if (!asset || !asset.isActive) {
          return res.status(400).json({ error: "Asset not available for trading" });
        }
        outputMint = asset.solanaMint;
        outputSymbol = asset.ondoSymbol;
      } else if (alertId) {
        const userAlert = await storage.getUserAlert(parseInt(alertId));
        if (!userAlert) {
          return res.status(404).json({ error: "Alert not found" });
        }
        const alertEvent = await storage.getAlertEvent(userAlert.alertEventId);
        if (!alertEvent) {
          return res.status(404).json({ error: "Alert event not found" });
        }
        const asset = await storage.getAssetByTicker(alertEvent.ticker);
        if (!asset || !asset.isActive) {
          return res.status(400).json({ error: "Asset not available for trading" });
        }
        outputMint = asset.solanaMint;
        outputSymbol = asset.ondoSymbol;
      }

      if (!outputMint) {
        return res.status(400).json({ error: "No valid ticker or alert provided" });
      }

      const amountRaw = jupiter.usdToRawAmount(parseFloat(amount), 6);
      
      const quote = await jupiter.getQuote(USDC_MINT, outputMint, amountRaw);
      const swapResponse = await jupiter.getSwapTransaction(quote, user.solanaPubkey);

      const preparedOrder = await storage.createPreparedOrder({
        userId: user.id,
        userAlertId: alertId ? parseInt(alertId) : null,
        inputMint: USDC_MINT,
        outputMint,
        amountIn: amountRaw,
        quoteJson: quote,
        swapTxBase64: swapResponse.swapTransaction,
        expiresAt: new Date(Date.now() + 60000),
        status: "PENDING",
      });

      const estimatedOutput = jupiter.rawAmountToDisplay(quote.outAmount, 6);
      const priceImpact = parseFloat(quote.priceImpactPct);

      res.json({
        preparedOrderId: preparedOrder.id,
        estimatedOutput,
        outputSymbol,
        priceImpact,
        swapTransaction: swapResponse.swapTransaction,
      });
    } catch (error) {
      console.error("[API] Prepare trade error:", error);
      res.status(500).json({ error: "Failed to prepare trade" });
    }
  });

  app.post("/api/trade/execute", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { preparedOrderId, txSignature } = req.body;

      const order = await storage.getPreparedOrder(preparedOrderId);
      if (!order || order.userId !== user.id) {
        return res.status(404).json({ error: "Order not found" });
      }

      if (order.status !== "PENDING") {
        return res.status(400).json({ error: "Order already processed" });
      }

      const trade = await storage.createTrade({
        userId: user.id,
        userAlertId: order.userAlertId,
        preparedOrderId: order.id,
        txSig: txSignature,
        inputMint: order.inputMint,
        outputMint: order.outputMint,
        amountIn: order.amountIn,
        status: "COMPLETED",
      });

      await storage.updatePreparedOrder(order.id, { status: "EXECUTED" });

      if (order.userAlertId) {
        await storage.updateUserAlert(order.userAlertId, { status: "EXECUTED" });
      }

      res.json({ trade, txSig: txSignature });
    } catch (error) {
      console.error("[API] Execute trade error:", error);
      res.status(500).json({ error: "Failed to execute trade" });
    }
  });

  // Get sell quote (preview without executing)
  app.post("/api/trade/sell-quote", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { ticker } = req.body;
      
      if (!user.solanaPubkey) {
        return res.status(400).json({ error: "Wallet not configured" });
      }
      
      const asset = await storage.getAssetByTicker(ticker);
      if (!asset) {
        return res.status(404).json({ error: `Asset ${ticker} not found` });
      }
      
      // Get actual token balance from chain
      const tokenBalance = await jupiter.getTokenBalance(connection, user.solanaPubkey, asset.solanaMint);
      if (tokenBalance.balance === "0") {
        return res.status(400).json({ error: `No ${ticker} balance to sell` });
      }
      
      console.log(`[SellQuote] Getting quote to sell ${tokenBalance.balance} raw of ${ticker}`);
      
      // Get quote from Jupiter Ultra
      const quote = await jupiter.getQuote(asset.solanaMint, USDC_MINT, tokenBalance.balance, user.solanaPubkey);
      
      // Convert raw amounts to display values
      const inputDecimals = asset.decimals || 9;
      const inputAmount = parseFloat(tokenBalance.balance) / Math.pow(10, inputDecimals);
      const outputAmount = parseFloat(quote.outAmount) / Math.pow(10, 6); // USDC has 6 decimals
      
      res.json({
        ticker,
        symbol: asset.ondoSymbol,
        inputMint: asset.solanaMint,
        outputMint: USDC_MINT,
        inputAmount: inputAmount.toFixed(6),
        outputAmount: outputAmount.toFixed(2),
        rawInputAmount: tokenBalance.balance,
        rawOutputAmount: quote.outAmount,
        priceImpactPct: quote.priceImpactPct,
        hasTransaction: !!quote.transaction,
      });
    } catch (error: any) {
      console.error("[API] Sell quote error:", error);
      res.status(500).json({ error: error.message || "Failed to get sell quote" });
    }
  });

  // Sell tokens back to USDC
  app.post("/api/trade/sell", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { ticker, amount } = req.body;
      
      if (!user.solanaPubkey || !user.privyWalletId) {
        return res.status(400).json({ error: "Wallet not configured for trading" });
      }
      
      const asset = await storage.getAssetByTicker(ticker);
      if (!asset) {
        return res.status(404).json({ error: `Asset ${ticker} not found` });
      }
      
      // Get actual token balance from chain
      const tokenBalance = await jupiter.getTokenBalance(connection, user.solanaPubkey, asset.solanaMint);
      if (tokenBalance.balance === "0") {
        return res.status(400).json({ error: `No ${ticker} balance to sell` });
      }
      
      console.log(`[Sell] Getting quote to sell ${tokenBalance.balance} raw of ${ticker}`);
      
      const quote = await jupiter.getQuote(asset.solanaMint, USDC_MINT, tokenBalance.balance, user.solanaPubkey);
      
      if (!quote.transaction || !quote.requestId) {
        return res.status(400).json({ error: "Failed to get quote" });
      }
      
      // Sign and execute
      const signResult = await privyService.signSolanaTransaction(user.privyWalletId, quote.transaction);
      
      if ("error" in signResult) {
        return res.status(400).json({ error: signResult.error });
      }
      
      const executeResult = await jupiter.executeUltraOrder(quote.requestId, signResult.signedTransaction, 2);
      
      if (executeResult.status === "Success" && executeResult.signature) {
        // Save trade
        const trade = await storage.createTrade({
          userId: user.id,
          userAlertId: null,
          preparedOrderId: null,
          txSig: executeResult.signature,
          inputMint: asset.solanaMint,
          outputMint: USDC_MINT,
          amountIn: tokenBalance.balance,
          amountOut: executeResult.outputAmountResult,
          status: "COMPLETED",
        });
        
        res.json({ success: true, signature: executeResult.signature, trade });
      } else {
        res.status(400).json({ error: executeResult.error || "Trade failed" });
      }
    } catch (error: any) {
      console.error("[API] Sell trade error:", error);
      res.status(500).json({ error: error.message || "Failed to execute sell" });
    }
  });

  // Transfer tokens to another address
  app.post("/api/transfer", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { tokenMint, recipientAddress, amount } = req.body;
      
      if (!user.solanaPubkey || !user.privyWalletId) {
        return res.status(400).json({ error: "Wallet not configured" });
      }
      
      if (!tokenMint || !recipientAddress || !amount) {
        return res.status(400).json({ error: "Missing required fields: tokenMint, recipientAddress, amount" });
      }
      
      // Validate amount
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return res.status(400).json({ error: "Invalid amount - must be a positive number" });
      }
      
      // Validate recipient address
      let recipientPubkey: PublicKey;
      try {
        recipientPubkey = new PublicKey(recipientAddress);
      } catch {
        return res.status(400).json({ error: "Invalid recipient address" });
      }
      
      // Validate token mint
      let mintPubkey: PublicKey;
      try {
        mintPubkey = new PublicKey(tokenMint);
      } catch {
        return res.status(400).json({ error: "Invalid token mint address" });
      }
      
      const senderPubkey = new PublicKey(user.solanaPubkey);
      
      // Determine decimals and token program
      const isUsdc = tokenMint === USDC_MINT;
      let decimals = isUsdc ? 6 : 9;
      let tokenProgramId = TOKEN_PROGRAM_ID;
      
      // Check if it's a known asset for accurate decimals and program
      const assets = await storage.getAssetRegistry();
      const asset = assets.find(a => a.solanaMint === tokenMint);
      if (asset) {
        decimals = asset.decimals || 9;
        // Ondo tokens use Token-2022 program
        tokenProgramId = TOKEN_2022_PROGRAM_ID;
      }
      
      // USDC uses standard Token program
      if (isUsdc) {
        tokenProgramId = TOKEN_PROGRAM_ID;
      }
      
      // Convert amount to raw using BigInt for precision
      const multiplier = BigInt(10 ** decimals);
      const [wholePart, fracPart = ""] = amount.split(".");
      const paddedFrac = fracPart.padEnd(decimals, "0").slice(0, decimals);
      const rawAmount = BigInt(wholePart || "0") * multiplier + BigInt(paddedFrac || "0");
      
      if (rawAmount <= BigInt(0)) {
        return res.status(400).json({ error: "Amount too small" });
      }
      
      // Check balance
      const tokenBalance = await jupiter.getTokenBalance(connection, user.solanaPubkey, tokenMint);
      if (BigInt(tokenBalance.balance) < rawAmount) {
        return res.status(400).json({ error: "Insufficient balance" });
      }
      
      // Get sender's token account (with correct program ID)
      const senderAta = await getAssociatedTokenAddress(
        mintPubkey, 
        senderPubkey, 
        false,
        tokenProgramId
      );
      
      // Get or create recipient's token account
      const recipientAta = await getAssociatedTokenAddress(
        mintPubkey, 
        recipientPubkey,
        false,
        tokenProgramId
      );
      
      // Build transaction
      const transaction = new Transaction();
      
      // Check if recipient ATA exists, if not add create instruction
      try {
        await getAccount(connection, recipientAta, "confirmed", tokenProgramId);
      } catch {
        // Account doesn't exist, add create instruction
        transaction.add(
          createAssociatedTokenAccountInstruction(
            senderPubkey,    // payer
            recipientAta,    // ata address
            recipientPubkey, // owner
            mintPubkey,      // mint
            tokenProgramId   // token program
          )
        );
      }
      
      // Add transfer instruction with correct program ID
      transaction.add(
        createTransferInstruction(
          senderAta,
          recipientAta,
          senderPubkey,
          rawAmount,
          [],
          tokenProgramId
        )
      );
      
      // Get recent blockhash
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = senderPubkey;
      
      // Serialize to base64
      const txBase64 = transaction.serialize({ requireAllSignatures: false }).toString("base64");
      
      // Sign with Privy
      const signResult = await privyService.signSolanaTransaction(user.privyWalletId, txBase64);
      
      if ("error" in signResult) {
        return res.status(400).json({ error: signResult.error });
      }
      
      // Deserialize and send
      const signedTx = Transaction.from(Buffer.from(signResult.signedTransaction, "base64"));
      const signature = await connection.sendRawTransaction(signedTx.serialize());
      
      // Wait for confirmation
      await connection.confirmTransaction(signature, "confirmed");
      
      console.log(`[Transfer] Sent ${amount} tokens to ${recipientAddress}, tx: ${signature}`);
      
      // Determine symbol for the transfer
      let symbol = "USDC";
      if (!isUsdc && asset) {
        symbol = asset.ondoSymbol;
      }
      
      // Save transfer to database
      await storage.createTransfer({
        userId: user.id,
        txSig: signature,
        tokenMint,
        amount: rawAmount.toString(),
        fromAddress: user.solanaPubkey,
        toAddress: recipientAddress,
        direction: "outgoing",
        symbol,
      });
      
      res.json({ 
        success: true, 
        signature,
        explorerUrl: `https://solscan.io/tx/${signature}`
      });
    } catch (error: any) {
      console.error("[API] Transfer error:", error);
      res.status(500).json({ error: error.message || "Failed to transfer tokens" });
    }
  });

  // Get user's transfers
  app.get("/api/transfers", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const transfersList = await storage.getTransfersByUser(user.id);
      
      // Enrich with display amounts
      const assets = await storage.getAssetRegistry();
      const enrichedTransfers = transfersList.map((t) => {
        const asset = assets.find(a => a.solanaMint === t.tokenMint);
        const isUsdc = t.tokenMint === USDC_MINT;
        const decimals = isUsdc ? 6 : (asset?.decimals || 9);
        const amountDisplay = (parseFloat(t.amount) / Math.pow(10, decimals)).toFixed(isUsdc ? 2 : 6);
        
        return {
          ...t,
          amountDisplay,
          symbol: t.symbol || (isUsdc ? "USDC" : asset?.ondoSymbol || "Unknown"),
        };
      });
      
      res.json(enrichedTransfers);
    } catch (error: any) {
      console.error("[API] Get transfers error:", error);
      res.status(500).json({ error: error.message || "Failed to get transfers" });
    }
  });

  app.get("/api/telegram/link", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      
      const token = randomBytes(16).toString("hex");
      await storage.createTelegramLinkToken({
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      const botUsername = process.env.TELEGRAM_BOT_USERNAME || "arenastocksbot";
      const deepLink = `https://t.me/${botUsername}?start=${token}`;
      
      res.json({ deepLink, token });
    } catch (error) {
      console.error("[API] Telegram link error:", error);
      res.status(500).json({ error: "Failed to generate link" });
    }
  });

  app.post("/api/telegram/webhook", async (req: Request, res: Response) => {
    try {
      const { message, callback_query } = req.body;
      
      console.log("[Telegram Webhook] Received:", JSON.stringify({ 
        hasMessage: !!message, 
        hasCallback: !!callback_query,
        messageText: message?.text?.slice(0, 50),
        callbackData: callback_query?.data 
      }));

      if (message?.text?.startsWith("/start ")) {
        const token = message.text.split(" ")[1];
        const linkToken = await storage.getTelegramLinkToken(token);
        
        if (linkToken && !linkToken.used && new Date(linkToken.expiresAt) > new Date()) {
          await storage.updateUser(linkToken.userId, {
            telegramChatId: message.chat.id.toString(),
            telegramUsername: message.from?.username,
          });
          await storage.markTelegramLinkTokenUsed(linkToken.id);
          
          await telegram.sendMessage({
            chatId: message.chat.id.toString(),
            text: "✅ Successfully connected! You'll now receive trading alerts here.",
          });
        } else {
          await telegram.sendMessage({
            chatId: message.chat.id.toString(),
            text: "❌ Invalid or expired link. Please try again from the app.",
          });
        }
      }

      if (message?.text === "/start") {
        await telegram.sendMessage({
          chatId: message.chat.id.toString(),
          text: "Welcome to Arena! To connect your account, please use the link from the app.",
        });
      }

      if (message?.text === "/help") {
        await telegram.sendMessage({
          chatId: message.chat.id.toString(),
          text: `📊 <b>Arena Bot Commands</b>

/help - Show this message
/balance - Show your wallet balance
/portfolio - Show your holdings and trade history
/sell - Sell stock tokens (shows selection menu)
/mute TICKER - Mute alerts for a ticker
/unmute TICKER - Unmute alerts for a ticker
/amount NUMBER - Set default buy amount (e.g., /amount 50)`,
          parseMode: "HTML",
        });
      }
      
      // Handle /sell command - show stock selection menu or sell specific ticker
      if (message?.text === "/sell" || message?.text?.startsWith("/sell ")) {
        const chatId = message.chat.id.toString();
        const ticker = message.text.split(" ")[1]?.toUpperCase();
        
        const user = await storage.getUserByTelegramChatId(chatId);
        if (!user || !user.solanaPubkey || !user.privyWalletId) {
          await telegram.sendMessage({
            chatId,
            text: "❌ Wallet not configured. Please set up one-tap trading in the app first.",
          });
          return res.sendStatus(200);
        }
        
        // If no ticker specified, show stock selection menu
        if (!ticker) {
          try {
            const pubkey = new PublicKey(user.solanaPubkey);
            const assets = await storage.getAssetRegistry();
            const assetsByMint = new Map(assets.map(a => [a.solanaMint, a]));
            const holdings: { ticker: string; balance: string; mint: string }[] = [];
            
            const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
            const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
            
            const processAccounts = (accounts: any[]) => {
              for (const { account } of accounts) {
                const info = account.data.parsed.info;
                const mint = info.mint;
                const asset = assetsByMint.get(mint);
                
                if (asset && asset.underlyingTicker !== "USDC" && parseFloat(info.tokenAmount.uiAmountString) > 0) {
                  holdings.push({
                    ticker: asset.underlyingTicker,
                    balance: parseFloat(info.tokenAmount.uiAmountString).toFixed(6),
                    mint: mint
                  });
                }
              }
            };
            
            try {
              const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM });
              processAccounts(tokenAccounts.value);
            } catch (e) {}
            
            try {
              const token2022Accounts = await connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_2022_PROGRAM });
              processAccounts(token2022Accounts.value);
            } catch (e) {}
            
            if (holdings.length === 0) {
              await telegram.sendMessage({
                chatId,
                text: "📊 You don't have any stock tokens to sell.\n\nBuy some first by responding to an alert!",
              });
              return res.sendStatus(200);
            }
            
            const buttons = holdings.map(h => ([
              { text: `${h.ticker} (${h.balance})`, callback_data: `sell_stock:${h.ticker}` }
            ]));
            buttons.push([{ text: "❌ Cancel", callback_data: "sell_cancel" }]);
            
            await telegram.sendMessage({
              chatId,
              text: "📈 <b>Select a stock to sell:</b>\n\nTap a stock below to sell your entire position.",
              parseMode: "HTML",
              replyMarkup: { inline_keyboard: buttons },
            });
            return res.sendStatus(200);
          } catch (err: any) {
            console.error("[Telegram] Error fetching holdings:", err);
            await telegram.sendMessage({
              chatId,
              text: "❌ Error fetching your holdings. Please try again.",
            });
            return res.sendStatus(200);
          }
        }
        
        const asset = await storage.getAssetByTicker(ticker);
        if (!asset) {
          await telegram.sendMessage({
            chatId,
            text: `❌ Unknown ticker: ${ticker}`,
          });
          return res.sendStatus(200);
        }
        
        await telegram.sendMessage({
          chatId,
          text: `⏳ Getting your ${ticker} balance and preparing sale...`,
        });
        
        try {
          // Get token balance
          const balance = await jupiter.getTokenBalance(connection, user.solanaPubkey, asset.solanaMint);
          const displayBalance = jupiter.rawAmountToDisplay(balance.balance, balance.decimals);
          
          if (parseFloat(displayBalance) === 0) {
            await telegram.sendMessage({
              chatId,
              text: `❌ You don't have any ${ticker} tokens to sell.`,
            });
            return res.sendStatus(200);
          }
          
          await telegram.sendMessage({
            chatId,
            text: `📊 Found ${displayBalance} ${ticker}. Selling to USDC...`,
          });
          
          // Get quote and execute
          const quote = await jupiter.getQuote(asset.solanaMint, USDC_MINT, balance.balance, user.solanaPubkey);
          
          if (!quote.transaction || !quote.requestId) {
            await telegram.sendMessage({
              chatId,
              text: `❌ Failed to get quote. Market may be unavailable.`,
            });
            return res.sendStatus(200);
          }
          
          const signResult = await privyService.signSolanaTransaction(user.privyWalletId, quote.transaction);
          
          if ("error" in signResult) {
            await telegram.sendMessage({
              chatId,
              text: `❌ Signing failed: ${signResult.error}`,
            });
            return res.sendStatus(200);
          }
          
          const executeResult = await jupiter.executeUltraOrder(quote.requestId, signResult.signedTransaction, 2);
          
          if (executeResult.status === "Success" && executeResult.signature) {
            const outputAmount = jupiter.rawAmountToDisplay(executeResult.outputAmountResult || "0", 6);
            
            await storage.createTrade({
              userId: user.id,
              userAlertId: null,
              preparedOrderId: null,
              txSig: executeResult.signature,
              inputMint: asset.solanaMint,
              outputMint: USDC_MINT,
              amountIn: balance.balance,
              amountOut: executeResult.outputAmountResult,
              status: "COMPLETED",
            });
            
            await telegram.sendMessage({
              chatId,
              text: `✅ <b>Sold ${displayBalance} ${ticker}!</b>\n\nReceived: $${outputAmount} USDC\n\n<a href="https://explorer.solana.com/tx/${executeResult.signature}">View Transaction</a>`,
              parseMode: "HTML",
            });
          } else {
            await telegram.sendMessage({
              chatId,
              text: `❌ Trade failed: ${executeResult.error || "Unknown error"}`,
            });
          }
        } catch (err: any) {
          console.error("[Telegram] Sell error:", err);
          await telegram.sendMessage({
            chatId,
            text: `❌ Error: ${err.message || "Unknown error"}`,
          });
        }
      }

      if (message?.text === "/balance" || message?.text === "/portfolio") {
        const user = await storage.getUserByTelegramChatId(message.chat.id.toString());
        
        if (!user) {
          await telegram.sendMessage({
            chatId: message.chat.id.toString(),
            text: "❌ Please connect your account first using the link from the app.",
          });
        } else if (!user.solanaPubkey) {
          await telegram.sendMessage({
            chatId: message.chat.id.toString(),
            text: "❌ No wallet connected. Please connect a Solana wallet in the app first.",
          });
        } else {
          try {
            const pubkey = new PublicKey(user.solanaPubkey);
            
            const solBalance = await connection.getBalance(pubkey);
            const solAmount = (solBalance / 1e9).toFixed(4);
            
            let usdcBalance = "0.00";
            try {
              const usdcMint = new PublicKey(USDC_MINT);
              const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, { mint: usdcMint });
              if (tokenAccounts.value.length > 0) {
                const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
                usdcBalance = balance?.toFixed(2) || "0.00";
              }
            } catch (e) {
              console.error("[Telegram] Error fetching USDC balance:", e);
            }

            // Fetch all token holdings - check both Token and Token-2022 programs
            const assets = await storage.getAssetRegistry();
            const assetsByMint = new Map(assets.map(a => [a.solanaMint, a]));
            const holdings: { ticker: string; balance: string }[] = [];
            
            const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
            const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
            
            const processAccounts = (accounts: any[]) => {
              for (const { account } of accounts) {
                const info = account.data.parsed.info;
                const mint = info.mint;
                const asset = assetsByMint.get(mint);
                
                if (asset && asset.underlyingTicker !== "USDC" && parseFloat(info.tokenAmount.uiAmountString) > 0) {
                  holdings.push({
                    ticker: asset.underlyingTicker,
                    balance: parseFloat(info.tokenAmount.uiAmountString).toFixed(2)
                  });
                }
              }
            };
            
            try {
              // Check regular Token program
              const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM });
              processAccounts(tokenAccounts.value);
            } catch (e) {
              console.error("[Telegram] Error fetching Token accounts:", e);
            }
            
            try {
              // Check Token-2022 program (Ondo tokens may use this)
              const token2022Accounts = await connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_2022_PROGRAM });
              processAccounts(token2022Accounts.value);
            } catch (e) {
              console.error("[Telegram] Error fetching Token-2022 accounts:", e);
            }

            const trades = await storage.getTradesByUser(user.id);
            const recentTrades = trades.slice(0, 5);

            let portfolioText = `💰 <b>Your Wallet Balance</b>

🟣 SOL: ${solAmount}
💵 USDC: $${usdcBalance}`;

            if (holdings.length > 0) {
              portfolioText += `\n\n📊 <b>Stock Tokens</b>`;
              for (const h of holdings) {
                portfolioText += `\n• ${h.ticker}: ${h.balance}`;
              }
            }

            portfolioText += `\n\n📍 Wallet: <code>${user.solanaPubkey.slice(0, 8)}...${user.solanaPubkey.slice(-6)}</code>`;

            if (message?.text === "/portfolio") {
              if (recentTrades.length > 0) {
                portfolioText += `\n\n📈 <b>Recent Trades</b>`;
                const allAssets = await storage.getAssetRegistry();
                const assetByMint = new Map(allAssets.map(a => [a.solanaMint, a]));
                
                for (const trade of recentTrades) {
                  const date = new Date(trade.createdAt!).toLocaleDateString();
                  const inputAsset = assetByMint.get(trade.inputMint);
                  const outputAsset = assetByMint.get(trade.outputMint);
                  
                  const inputSymbol = inputAsset?.underlyingTicker || (trade.inputMint === USDC_MINT ? "USDC" : trade.inputMint?.slice(0, 6) + "...");
                  const outputSymbol = outputAsset?.underlyingTicker || (trade.outputMint === USDC_MINT ? "USDC" : trade.outputMint?.slice(0, 6) + "...");
                  
                  const inputAmount = trade.inputMint === USDC_MINT 
                    ? `$${jupiter.rawAmountToDisplay(trade.amountIn || "0", 6)}`
                    : jupiter.rawAmountToDisplay(trade.amountIn || "0", 9);
                  const outputAmount = trade.outputMint === USDC_MINT 
                    ? `$${jupiter.rawAmountToDisplay(trade.amountOut || "0", 6)}`
                    : jupiter.rawAmountToDisplay(trade.amountOut || "0", 9);
                  
                  portfolioText += `\n• ${inputAmount} ${inputSymbol} → ${outputAmount} ${outputSymbol} (${date})`;
                }
              } else {
                portfolioText += `\n\n📈 <b>Recent Trades</b>\nNo trades yet.`;
              }
            }

            await telegram.sendMessage({
              chatId: message.chat.id.toString(),
              text: portfolioText,
              parseMode: "HTML",
            });
          } catch (error) {
            console.error("[Telegram] Balance fetch error:", error);
            await telegram.sendMessage({
              chatId: message.chat.id.toString(),
              text: "❌ Error fetching balance. Please try again later.",
            });
          }
        }
      }

      // Handle /trades command - show recent trades only
      if (message?.text === "/trades") {
        const user = await storage.getUserByTelegramChatId(message.chat.id.toString());
        
        if (!user) {
          await telegram.sendMessage({
            chatId: message.chat.id.toString(),
            text: "Please connect your account first using the link from the app.",
          });
        } else {
          const trades = await storage.getTradesByUser(user.id);
          const recentTrades = trades.slice(0, 10);
          
          if (recentTrades.length === 0) {
            await telegram.sendMessage({
              chatId: message.chat.id.toString(),
              text: "No trades yet. Execute your first trade from an alert!",
            });
          } else {
            const allAssets = await storage.getAssetRegistry();
            const assetByMint = new Map(allAssets.map(a => [a.solanaMint, a]));
            
            let tradesText = `<b>Recent Trades</b>\n`;
            
            for (const trade of recentTrades) {
              const date = new Date(trade.createdAt!).toLocaleDateString();
              const inputAsset = assetByMint.get(trade.inputMint);
              const outputAsset = assetByMint.get(trade.outputMint);
              
              const inputSymbol = inputAsset?.underlyingTicker || (trade.inputMint === USDC_MINT ? "USDC" : trade.inputMint?.slice(0, 6) + "...");
              const outputSymbol = outputAsset?.underlyingTicker || (trade.outputMint === USDC_MINT ? "USDC" : trade.outputMint?.slice(0, 6) + "...");
              
              const inputAmount = trade.inputMint === USDC_MINT 
                ? `$${jupiter.rawAmountToDisplay(trade.amountIn || "0", 6)}`
                : jupiter.rawAmountToDisplay(trade.amountIn || "0", 9);
              const outputAmount = trade.outputMint === USDC_MINT 
                ? `$${jupiter.rawAmountToDisplay(trade.amountOut || "0", 6)}`
                : jupiter.rawAmountToDisplay(trade.amountOut || "0", 9);
              
              const status = trade.status === "completed" ? "Done" : trade.status === "failed" ? "Fail" : trade.status;
              tradesText += `\n${inputAmount} ${inputSymbol} -> ${outputAmount} ${outputSymbol} (${date}) [${status}]`;
            }
            
            await telegram.sendMessage({
              chatId: message.chat.id.toString(),
              text: tradesText,
              parseMode: "HTML",
            });
          }
        }
      }

      if (message?.text?.startsWith("/amount ")) {
        const amountStr = message.text.split(" ")[1];
        const amount = parseFloat(amountStr);
        
        if (isNaN(amount) || amount <= 0 || amount > 10000) {
          await telegram.sendMessage({
            chatId: message.chat.id.toString(),
            text: "❌ Please provide a valid amount between $1 and $10,000. Example: /amount 50",
          });
        } else {
          const user = await storage.getUserByTelegramChatId(message.chat.id.toString());
          if (user) {
            await storage.updateUser(user.id, { defaultBuyAmountUsd: amount.toString() });
            await telegram.sendMessage({
              chatId: message.chat.id.toString(),
              text: `✅ Default trade amount set to $${amount}. Your quick-trade buttons will now show this amount.`,
            });
          } else {
            await telegram.sendMessage({
              chatId: message.chat.id.toString(),
              text: "❌ Please connect your account first using the link from the app.",
            });
          }
        }
      }

      if (callback_query) {
        await telegram.answerCallbackQuery(callback_query.id);
        
        const parts = callback_query.data.split(":");
        const action = parts[0];
        const userAlertId = parts[1];
        const amount = parts[2];
        const tradeAction = parts[3] || "BUY";
        
        if (action === "trade") {
          const actionText = tradeAction === "SELL" ? "Sell" : "Buy";
          const chatId = callback_query.message.chat.id.toString();
          const messageId = callback_query.message.message_id;
          
          try {
            const userAlert = await storage.getUserAlert(parseInt(userAlertId));
            if (!userAlert) throw new Error("Alert not found");
            
            const alertEvent = await storage.getAlertEvent(userAlert.alertEventId);
            if (!alertEvent) throw new Error("Alert event not found");
            
            const user = await storage.getUser(userAlert.userId);
            if (!user?.solanaPubkey) throw new Error("No wallet connected");
            
            const asset = await storage.getAssetByTicker(alertEvent.ticker);
            if (!asset) throw new Error("Asset not found");

            // Daily spend cap guards the one-tap path: sum today's buys
            // (completed or in flight) before letting another one through.
            if (tradeAction === "BUY" && user.dailySpendCapUsd) {
              const cap = parseFloat(user.dailySpendCapUsd);
              const tradeAmountUsd = parseFloat(amount);
              const todayStart = new Date();
              todayStart.setUTCHours(0, 0, 0, 0);
              const recentTrades = await storage.getTradesByUser(user.id, 200);
              const spentToday = recentTrades
                .filter(t => t.inputMint === USDC_MINT &&
                             (t.status === "COMPLETED" || t.status === "PENDING") &&
                             new Date(t.createdAt) >= todayStart)
                .reduce((sum, t) => sum + parseInt(t.amountIn) / 1e6, 0);

              if (spentToday + tradeAmountUsd > cap) {
                await telegram.editMessageText(
                  chatId,
                  messageId,
                  `${callback_query.message.text}\n\n🛑 Daily spend cap reached ($${spentToday.toFixed(2)} of $${cap.toFixed(2)} used today). Adjust it in Settings if you want to keep trading.`,
                );
                return res.status(200).send("OK");
              }
            }

            const canAutoExecute = user.signerEnabled &&
                                   user.autoExecuteEnabled && 
                                   user.privyWalletId &&
                                   privyService.isAuthorizationKeyConfigured();
            
            console.log("[Trade] canAutoExecute:", canAutoExecute, {
              signerEnabled: user.signerEnabled,
              autoExecuteEnabled: user.autoExecuteEnabled,
              privyWalletId: user.privyWalletId,
              authKeyConfigured: privyService.isAuthorizationKeyConfigured()
            });
            
            if (canAutoExecute) {
              await telegram.editMessageText(
                chatId,
                messageId,
                `${callback_query.message.text}\n\n⚡ Executing ${actionText.toLowerCase()} for $${amount}...`,
              );
            } else {
              await telegram.editMessageText(
                chatId,
                messageId,
                `${callback_query.message.text}\n\n⏳ Preparing ${actionText.toLowerCase()} for $${amount}...`,
              );
            }
            
            const amountUsd = parseFloat(amount);
            const amountRaw = jupiter.usdToRawAmount(amountUsd);
            
            let inputMint: string, outputMint: string;
            if (tradeAction === "BUY") {
              inputMint = USDC_MINT;
              outputMint = asset.solanaMint;
            } else {
              inputMint = asset.solanaMint;
              outputMint = USDC_MINT;
            }
            
            const quote = await jupiter.getQuote(inputMint, outputMint, amountRaw, user.solanaPubkey);
            
            const preparedOrder = await storage.createPreparedOrder({
              userId: user.id,
              userAlertId: parseInt(userAlertId),
              inputMint,
              outputMint,
              amountIn: amountRaw,
              quoteJson: quote,
              swapTxBase64: quote.transaction || undefined,
              expiresAt: new Date(Date.now() + 60000),
              status: "PENDING",
            });
            
            if (canAutoExecute && user.privyWalletId) {
              // Ultra API flow with retry: Get quote, sign, execute - retry with fresh quote on failure
              const maxTradeAttempts = 3;
              let lastError: string = "Unknown error";
              let signature: string | null = null;
              let outputAmountResult: string | null = null;
              
              for (let attempt = 1; attempt <= maxTradeAttempts; attempt++) {
                console.log(`[Trade] Attempt ${attempt}/${maxTradeAttempts}`);
                
                try {
                  // Get fresh quote for each attempt
                  const freshQuote = attempt === 1 ? quote : await jupiter.getQuote(
                    inputMint, outputMint, amountRaw, user.solanaPubkey!
                  );
                  
                  if (!freshQuote.transaction || !freshQuote.requestId) {
                    throw new Error("No transaction in quote");
                  }
                  
                  // Sign transaction
                  const signResult = await privyService.signSolanaTransaction(
                    user.privyWalletId!,
                    freshQuote.transaction
                  );
                  
                  if ("error" in signResult) {
                    throw new Error(signResult.error);
                  }
                  
                  // Execute (this has its own internal retry for -2005 errors)
                  const executeResult = await jupiter.executeUltraOrder(
                    freshQuote.requestId,
                    signResult.signedTransaction,
                    1 // Only 1 internal retry, we handle outer retry with fresh quote
                  );
                  
                  console.log("[Trade] Jupiter execute result:", executeResult);
                  
                  if (executeResult.status === "Success" || executeResult.signature) {
                    signature = executeResult.signature || "";
                    outputAmountResult = executeResult.outputAmountResult || null;
                    break; // Success!
                  }
                  
                  lastError = executeResult.error || "Trade execution failed";
                  console.log(`[Trade] Attempt ${attempt} failed: ${lastError}`);
                  
                  if (attempt < maxTradeAttempts) {
                    console.log(`[Trade] Retrying with fresh quote in ${attempt}s...`);
                    await new Promise(resolve => setTimeout(resolve, attempt * 1000));
                  }
                } catch (err: any) {
                  lastError = err.message || "Unknown error";
                  console.log(`[Trade] Attempt ${attempt} threw error: ${lastError}`);
                  
                  if (attempt < maxTradeAttempts) {
                    await new Promise(resolve => setTimeout(resolve, attempt * 1000));
                  }
                }
              }
              
              if (signature) {
                const trade = await storage.createTrade({
                  userId: user.id,
                  userAlertId: parseInt(userAlertId),
                  preparedOrderId: preparedOrder.id,
                  txSig: signature,
                  inputMint,
                  outputMint,
                  amountIn: amountRaw,
                  amountOut: outputAmountResult,
                  status: "COMPLETED",
                });
                
                await storage.updatePreparedOrder(preparedOrder.id, { status: "EXECUTED" });
                await storage.updateUserAlert(parseInt(userAlertId), { status: "EXECUTED" });
                
                const explorerUrl = `https://solscan.io/tx/${signature}`;
                await telegram.editMessageText(
                  chatId,
                  messageId,
                  `${callback_query.message.text}\n\n✅ Trade executed!\n\n💰 ${actionText} $${amount} of $${alertEvent.ticker}\n\n<a href="${explorerUrl}">View on Solscan</a>`,
                );
              } else {
                throw new Error(lastError);
              }
            } else {
              const appUrl = process.env.REPLIT_DEV_DOMAIN 
                ? `https://${process.env.REPLIT_DEV_DOMAIN}`
                : `${req.protocol}://${req.get("host")}`;
              
              await telegram.editMessageText(
                chatId,
                messageId,
                `${callback_query.message.text}\n\n✅ Order prepared!\n\n💰 ${actionText} $${amount} of $${alertEvent.ticker}\n\n<a href="${appUrl}/trade/execute?orderId=${preparedOrder.id}">Tap to sign & execute</a>`,
              );
              
              await storage.updateUserAlert(parseInt(userAlertId), { status: "PREPARED" });
            }
          } catch (error: any) {
            console.error("[Telegram] Trade error:", error);
            await telegram.editMessageText(
              chatId,
              messageId,
              `${callback_query.message.text}\n\n❌ Failed: ${error.message || "Unknown error"}`,
            );
          }
        }
        
        if (action === "ignore") {
          await storage.updateUserAlert(parseInt(userAlertId), { status: "IGNORED" });
          await telegram.editMessageText(
            callback_query.message.chat.id.toString(),
            callback_query.message.message_id,
            `${callback_query.message.text}\n\n❌ Alert ignored`,
          );
        }
        
        if (action === "sell_stock") {
          const ticker = userAlertId; // In this case, parts[1] is the ticker
          const chatId = callback_query.message.chat.id.toString();
          const messageId = callback_query.message.message_id;
          
          const user = await storage.getUserByTelegramChatId(chatId);
          if (!user || !user.solanaPubkey || !user.privyWalletId) {
            await telegram.editMessageText(chatId, messageId, "❌ Wallet not configured.");
            return res.sendStatus(200);
          }
          
          const asset = await storage.getAssetByTicker(ticker);
          if (!asset) {
            await telegram.editMessageText(chatId, messageId, `❌ Unknown ticker: ${ticker}`);
            return res.sendStatus(200);
          }
          
          await telegram.editMessageText(chatId, messageId, `⏳ Selling your ${ticker} position...`);
          
          try {
            const balance = await jupiter.getTokenBalance(connection, user.solanaPubkey, asset.solanaMint);
            const displayBalance = jupiter.rawAmountToDisplay(balance.balance, balance.decimals);
            
            if (parseFloat(displayBalance) === 0) {
              await telegram.editMessageText(chatId, messageId, `❌ You don't have any ${ticker} tokens to sell.`);
              return res.sendStatus(200);
            }
            
            const quote = await jupiter.getQuote(asset.solanaMint, USDC_MINT, balance.balance, user.solanaPubkey);
            
            if (!quote.transaction || !quote.requestId) {
              await telegram.editMessageText(chatId, messageId, `❌ Failed to get quote. Market may be unavailable.`);
              return res.sendStatus(200);
            }
            
            const signResult = await privyService.signSolanaTransaction(user.privyWalletId, quote.transaction);
            
            if ("error" in signResult) {
              await telegram.editMessageText(chatId, messageId, `❌ Signing failed: ${signResult.error}`);
              return res.sendStatus(200);
            }
            
            const executeResult = await jupiter.executeUltraOrder(quote.requestId, signResult.signedTransaction, 2);
            
            if (executeResult.status === "Success" && executeResult.signature) {
              const outputAmount = jupiter.rawAmountToDisplay(executeResult.outputAmountResult || "0", 6);
              
              await storage.createTrade({
                userId: user.id,
                userAlertId: null,
                preparedOrderId: null,
                txSig: executeResult.signature,
                inputMint: asset.solanaMint,
                outputMint: USDC_MINT,
                amountIn: balance.balance,
                amountOut: executeResult.outputAmountResult,
                status: "COMPLETED",
              });
              
              await telegram.editMessageText(
                chatId, 
                messageId, 
                `✅ <b>Sold ${displayBalance} ${ticker}!</b>\n\nReceived: $${outputAmount} USDC\n\n<a href="https://solscan.io/tx/${executeResult.signature}">View on Solscan</a>`
              );
            } else {
              await telegram.editMessageText(chatId, messageId, `❌ Trade failed: ${executeResult.error || "Unknown error"}`);
            }
          } catch (err: any) {
            console.error("[Telegram] Sell callback error:", err);
            await telegram.editMessageText(chatId, messageId, `❌ Error: ${err.message || "Unknown error"}`);
          }
        }
        
        if (action === "sell_cancel") {
          await telegram.editMessageText(
            callback_query.message.chat.id.toString(),
            callback_query.message.message_id,
            "❌ Sell cancelled."
          );
        }
      }

      res.status(200).send("OK");
    } catch (error) {
      console.error("[Telegram] Webhook error:", error);
      res.status(200).send("OK");
    }
  });

  // Push delivery from twitterapi.io tweet-filter rules. Much cheaper than
  // polling: only matched tweets are billed, and they arrive in near real time.
  app.post("/api/twitter/webhook", async (req: Request, res: Response) => {
    try {
      const configuredKey = process.env.X_API_BEARER_TOKEN;
      const receivedKey = req.headers["x-api-key"];
      if (!configuredKey || receivedKey !== configuredKey) {
        console.warn("[TwitterWebhook] Rejected request: X-API-Key header does not match X_API_BEARER_TOKEN");
        return res.status(401).json({ error: "Unauthorized" });
      }

      lastTwitterWebhookAt = new Date();

      const { event_type, tweets: incomingTweets } = req.body || {};
      if (event_type !== "tweet" || !Array.isArray(incomingTweets)) {
        return res.status(200).send("OK");
      }

      const influencers = await storage.getAllInfluencers();
      const byHandle = new Map(influencers.map(i => [i.handle.toLowerCase(), i]));
      let savedCount = 0;

      for (const tweet of incomingTweets) {
        const handle = (tweet.author?.userName || tweet.author?.username || "").toLowerCase();
        const influencer = handle ? byHandle.get(handle) : undefined;
        if (!influencer || !tweet.id || !tweet.text) continue;

        const existing = await storage.getTweetByTweetId(tweet.id);
        if (existing) continue;

        const savedTweet = await storage.createTweet({
          influencerId: influencer.id,
          tweetId: tweet.id,
          text: tweet.text,
          url: tweet.url || `https://x.com/${influencer.handle}/status/${tweet.id}`,
          rawJson: tweet,
          tweetCreatedAt: tweet.created_at ? new Date(tweet.created_at) : undefined,
        });
        savedCount++;

        // Classify inline so alerts go out even if the cron worker is asleep
        // (serverless deployments only run while handling requests)
        try {
          await classifyAndAlertTweet(savedTweet);
        } catch (e) {
          console.error(`[TwitterWebhook] Inline classification failed for tweet ${savedTweet.id} (cron will retry):`, e);
        }

        if (isNewerTweetId(tweet.id, influencer.lastTweetId)) {
          await storage.updateInfluencer(influencer.id, {
            lastTweetId: tweet.id,
            lastPolledAt: new Date(),
          });
          influencer.lastTweetId = tweet.id;
        }
      }

      if (savedCount > 0) {
        console.log(`[TwitterWebhook] Saved ${savedCount} pushed tweet(s); classification worker will pick them up`);
      }
      res.status(200).send("OK");
    } catch (error) {
      console.error("[TwitterWebhook] Error:", error);
      res.status(200).send("OK");
    }
  });

  app.get("/api/admin/assets", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
    try {
      const assets = await storage.getAssetRegistry();
      res.json(assets);
    } catch (error) {
      console.error("[API] Admin assets error:", error);
      res.status(500).json({ error: "Failed to get assets" });
    }
  });

  // Why did each recent tweet (not) become a signal? Surfaces the AI's
  // verdict and reasoning per tweet for the admin debug view.
  app.get("/api/admin/classifications", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
    try {
      const rows = await storage.getRecentClassificationsWithTweets(30);
      const influencers = await storage.getAllInfluencers();
      const handleById = new Map(influencers.map(i => [i.id, i.handle]));

      res.json(rows.map(row => {
        const result = row.resultJson as any;
        return {
          id: row.id,
          influencerHandle: handleById.get(row.influencerId) || "unknown",
          tweetText: row.tweetText,
          tweetUrl: row.tweetUrl,
          tweetCreatedAt: row.tweetCreatedAt,
          classifiedAt: row.createdAt,
          model: row.model,
          isActionable: row.isActionable,
          reason: result?.reason ?? null,
          tickers: result?.tickers ?? [],
        };
      }));
    } catch (error) {
      console.error("[API] Admin classifications error:", error);
      res.status(500).json({ error: "Failed to get classifications" });
    }
  });

  // Diff the asset registry against every tokenized equity tradeable on
  // Jupiter (Token API v2 "stocks" tag: Ondo, xStocks, ...).
  app.get("/api/admin/assets/discover", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
    try {
      const apiKey = process.env.JUPITER_API_KEY;
      const url = apiKey
        ? "https://api.jup.ag/tokens/v2/tag?query=stocks"
        : "https://lite-api.jup.ag/tokens/v2/tag?query=stocks";
      const response = await fetch(url, {
        headers: apiKey ? { "x-api-key": apiKey } : {},
      });
      if (!response.ok) {
        throw new Error(`Jupiter token API error ${response.status}: ${await response.text()}`);
      }
      const stocks: any[] = await response.json();

      const registry = await storage.getAssetRegistry();
      const registryMints = new Set(registry.map(a => a.solanaMint));
      const stockMints = new Set(stocks.map(s => s.id));

      // Best-effort underlying ticker from issuer naming conventions
      // (Ondo: "NVDAon", xStocks: "NVDAx"); admin can edit before saving.
      const suggestTicker = (symbol: string): string => {
        if (/on$/i.test(symbol) && symbol.length > 3) return symbol.slice(0, -2).toUpperCase();
        if (/x$/.test(symbol) && symbol.length > 2) return symbol.slice(0, -1).toUpperCase();
        return symbol.toUpperCase();
      };

      const missing = stocks
        .filter(s => !registryMints.has(s.id))
        .map(s => ({
          mint: s.id,
          symbol: s.symbol,
          name: s.name,
          decimals: s.decimals,
          isVerified: !!s.isVerified,
          usdPrice: s.usdPrice ?? null,
          holderCount: s.holderCount ?? null,
          suggestedTicker: suggestTicker(s.symbol || ""),
        }))
        .sort((a, b) => (b.holderCount ?? 0) - (a.holderCount ?? 0));

      // Registry entries Jupiter no longer tags as stocks — possibly
      // delisted or a mistyped mint
      const unknownInRegistry = registry
        .filter(a => !stockMints.has(a.solanaMint))
        .map(a => ({ id: a.id, underlyingTicker: a.underlyingTicker, solanaMint: a.solanaMint, isActive: a.isActive }));

      res.json({
        totalOnJupiter: stocks.length,
        inRegistry: registry.length,
        missing,
        unknownInRegistry,
      });
    } catch (error) {
      console.error("[API] Asset discovery error:", error);
      res.status(500).json({ error: "Failed to fetch Jupiter stock list" });
    }
  });

  app.post("/api/admin/assets", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
    try {
      const asset = await storage.createAsset(req.body);
      res.status(201).json(asset);
    } catch (error) {
      console.error("[API] Create asset error:", error);
      res.status(500).json({ error: "Failed to create asset" });
    }
  });

  app.put("/api/admin/assets/:id", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      const asset = await storage.updateAsset(id, req.body);
      res.json(asset);
    } catch (error) {
      console.error("[API] Update asset error:", error);
      res.status(500).json({ error: "Failed to update asset" });
    }
  });

  app.patch("/api/admin/assets/:id", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      const asset = await storage.updateAsset(id, req.body);
      res.json(asset);
    } catch (error) {
      console.error("[API] Patch asset error:", error);
      res.status(500).json({ error: "Failed to update asset" });
    }
  });

  app.delete("/api/admin/assets/:id", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      await storage.deleteAsset(id);
      res.status(204).send();
    } catch (error) {
      console.error("[API] Delete asset error:", error);
      res.status(500).json({ error: "Failed to delete asset" });
    }
  });

  app.post("/api/admin/telegram/setup-webhook", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
    try {
      const domain = process.env.APP_DOMAIN || process.env.REPLIT_DEPLOYMENT_DOMAIN || process.env.REPLIT_DEV_DOMAIN;
      if (!domain) {
        return res.status(400).json({ error: "No domain configured" });
      }
      
      const webhookUrl = `https://${domain}/api/telegram/webhook`;
      const success = await telegram.setWebhook(webhookUrl);
      
      if (success) {
        res.json({ success: true, webhookUrl });
      } else {
        res.status(500).json({ error: "Failed to set webhook" });
      }
    } catch (error) {
      console.error("[API] Setup webhook error:", error);
      res.status(500).json({ error: "Failed to setup webhook" });
    }
  });

  app.get("/api/admin/telegram/webhook-info", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return res.status(400).json({ error: "No bot token configured" });
      }
      
      const response = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("[API] Get webhook info error:", error);
      res.status(500).json({ error: "Failed to get webhook info" });
    }
  });

  // Test endpoint to simulate full trade flow (for development only)
  app.post("/api/dev/test-trade", async (req: Request, res: Response) => {
    try {
      const { ticker = "NVDA", amountUsd = 1, useSol = false } = req.body;
      
      // Get test user (the one with wallet configured)
      const user = await storage.getUserByPrivyId("did:privy:cmkqx8qwj01epjo0cecy20hfj");
      if (!user || !user.solanaPubkey || !user.privyWalletId) {
        return res.status(400).json({ error: "Test user not found or wallet not configured" });
      }
      
      console.log("[DevTest] Testing trade for", useSol ? "SOL" : ticker, "amount:", amountUsd);
      console.log("[DevTest] User:", { id: user.id, wallet: user.solanaPubkey, privyWalletId: user.privyWalletId });
      
      // Determine output mint
      let outputMint: string;
      if (useSol) {
        outputMint = "So11111111111111111111111111111111111111112"; // Native SOL
      } else {
        const asset = await storage.getAssetByTicker(ticker);
        if (!asset) {
          return res.status(400).json({ error: `Asset ${ticker} not found` });
        }
        outputMint = asset.solanaMint;
        console.log("[DevTest] Asset:", { ticker, mint: asset.solanaMint });
      }
      
      // Get quote
      const amountRaw = jupiter.usdToRawAmount(amountUsd);
      console.log("[DevTest] Getting quote for", amountRaw, "raw units, output:", outputMint);
      
      const quote = await jupiter.getQuote(USDC_MINT, outputMint, amountRaw, user.solanaPubkey);
      console.log("[DevTest] Quote received:", {
        outAmount: quote.outAmount,
        requestId: quote.requestId,
        hasTransaction: !!quote.transaction
      });
      
      if (!quote.transaction || !quote.requestId) {
        return res.status(400).json({ error: "No transaction in quote", quote });
      }
      
      // Sign transaction
      console.log("[DevTest] Signing with Privy wallet:", user.privyWalletId);
      const signResult = await privyService.signSolanaTransaction(user.privyWalletId, quote.transaction);
      
      if ("error" in signResult) {
        return res.status(400).json({ error: "Sign failed: " + signResult.error, details: signResult.details });
      }
      
      console.log("[DevTest] Signed successfully");
      
      // Execute
      console.log("[DevTest] Executing with requestId:", quote.requestId);
      const executeResult = await jupiter.executeUltraOrder(quote.requestId, signResult.signedTransaction, 2);
      
      console.log("[DevTest] Execute result:", executeResult);
      
      res.json({
        success: executeResult.status === "Success",
        signature: executeResult.signature,
        status: executeResult.status,
        error: executeResult.error,
        code: executeResult.code
      });
    } catch (error: any) {
      console.error("[DevTest] Error:", error);
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });

  return httpServer;
}
