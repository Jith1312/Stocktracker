import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { z } from "zod";
import { Connection, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { createTransferInstruction, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAccount, getMint } from "@solana/spl-token";
import { PrivyClient } from "@privy-io/server-auth";
import { randomBytes } from "crypto";
import { tweetProvider } from "./services/tweetProvider";
import { classifyTweet, shouldCreateAlert } from "./services/classifier";
import * as jupiter from "./services/jupiter";
import * as telegram from "./services/telegram";
import * as trading from "./services/trading";
import * as telegramBot from "./services/telegramBot";
import * as privyService from "./services/privy";
import { pollInfluencerTweets, sendBackfillAlerts } from "./workers";
import type { AssetRegistryEntry } from "@shared/schema";

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
        const solanaWallet = privyUser.linkedAccounts.find(
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

// Resolve the asset to trade from either an explicit ticker or a user alert id.
async function resolveTradableAsset(ticker?: string, alertId?: string | number): Promise<AssetRegistryEntry | null> {
  let symbol = typeof ticker === "string" && ticker.trim() ? ticker.trim().toUpperCase() : null;

  if (!symbol && alertId != null && alertId !== "") {
    const userAlert = await storage.getUserAlert(parseInt(String(alertId)));
    if (!userAlert) return null;
    const alertEvent = await storage.getAlertEvent(userAlert.alertEventId);
    if (!alertEvent) return null;
    symbol = alertEvent.ticker;
  }

  if (!symbol) return null;
  const asset = await storage.getAssetByTicker(symbol);
  return asset && asset.isActive ? asset : null;
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
      const { defaultBuyAmountUsd, autoExecuteEnabled, onboardingCompleted } = req.body;
      
      const updateData: { defaultBuyAmountUsd?: string; autoExecuteEnabled?: boolean; onboardingCompleted?: boolean } = {};
      
      if (defaultBuyAmountUsd !== undefined) {
        const amount = parseFloat(defaultBuyAmountUsd);
        if (isNaN(amount) || amount <= 0 || amount > 10000) {
          res.status(400).json({ error: "Invalid amount. Must be between $1 and $10,000" });
          return;
        }
        updateData.defaultBuyAmountUsd = amount.toString();
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
        return { ...sub, influencer };
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
      const id = parseInt(req.params.id);
      const influencer = await storage.getInfluencer(id);
      if (!influencer) {
        return res.status(404).json({ error: "Influencer not found" });
      }
      res.json(influencer);
    } catch (error) {
      console.error("[API] Get influencer error:", error);
      res.status(500).json({ error: "Failed to get influencer" });
    }
  });

  app.get("/api/influencers/:id/tweets", authMiddleware, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
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

  app.patch("/api/subscriptions/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { enabled, amountOverrideUsd } = req.body;
      
      const updated = await storage.updateSubscription(id, { enabled, amountOverrideUsd });
      res.json(updated);
    } catch (error) {
      console.error("[API] Update subscription error:", error);
      res.status(500).json({ error: "Failed to update subscription" });
    }
  });

  app.delete("/api/subscriptions/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteSubscription(id);
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
        
        return {
          id: ua.id,
          status: ua.status,
          createdAt: ua.createdAt,
          ticker: alertEvent.ticker,
          sentiment: alertEvent.sentiment,
          action: alertEvent.action,
          confidence: alertEvent.confidence,
          tweetText: tweet?.text,
          tweetUrl: tweet?.url,
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

      const asset = await resolveTradableAsset(ticker, alertId);
      if (!asset) {
        return res.status(400).json({ error: "Asset not available for trading" });
      }
      const outputMint = asset.solanaMint;
      const outputSymbol = asset.ondoSymbol;
      const outputDecimals = asset.decimals || 9;

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

      const estimatedOutput = jupiter.rawAmountToDisplay(quote.outAmount, outputDecimals);
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

  // Sell an entire position back to USDC
  app.post("/api/trade/sell", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { ticker } = req.body;

      if (!user.solanaPubkey || !user.privyWalletId) {
        return res.status(400).json({ error: "Wallet not configured for trading" });
      }

      const asset = await storage.getAssetByTicker(ticker);
      if (!asset) {
        return res.status(404).json({ error: `Asset ${ticker} not found` });
      }

      const result = await trading.sellEntirePosition(user, asset);
      res.json({
        success: true,
        signature: result.signature,
        tokensSold: result.tokensSold,
        usdcReceived: result.usdcReceived,
      });
    } catch (error: any) {
      console.error("[API] Sell trade error:", error);
      res.status(400).json({ error: trading.friendlyTradeError(error) });
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

      const botUsername = "arenastocksbot";
      const deepLink = `https://t.me/${botUsername}?start=${token}`;
      
      res.json({ deepLink, token });
    } catch (error) {
      console.error("[API] Telegram link error:", error);
      res.status(500).json({ error: "Failed to generate link" });
    }
  });

  // Muted ticker management (used by Settings and the /mute bot command)
  app.get("/api/muted-tickers", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const muted = await storage.getMutedTickers(user.id);
      res.json(muted);
    } catch (error) {
      console.error("[API] Get muted tickers error:", error);
      res.status(500).json({ error: "Failed to get muted tickers" });
    }
  });

  app.post("/api/muted-tickers", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const ticker = typeof req.body?.ticker === "string" ? req.body.ticker.toUpperCase().replace(/^\$/, "").trim() : "";
      if (!ticker || ticker.length > 10) {
        return res.status(400).json({ error: "Invalid ticker" });
      }
      const muted = await storage.getMutedTickers(user.id);
      if (muted.some((m) => m.ticker === ticker)) {
        return res.status(400).json({ error: `$${ticker} is already muted` });
      }
      const created = await storage.muteTicker(user.id, ticker);
      res.status(201).json(created);
    } catch (error) {
      console.error("[API] Mute ticker error:", error);
      res.status(500).json({ error: "Failed to mute ticker" });
    }
  });

  app.delete("/api/muted-tickers/:ticker", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      await storage.unmuteTicker(user.id, req.params.ticker.toUpperCase());
      res.status(204).send();
    } catch (error) {
      console.error("[API] Unmute ticker error:", error);
      res.status(500).json({ error: "Failed to unmute ticker" });
    }
  });

  // Live quote preview for the web trade page (no order is created)
  app.post("/api/trade/quote", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { alertId, ticker, amount } = req.body;

      if (!user.solanaPubkey) {
        return res.status(400).json({ error: "Wallet not connected" });
      }

      const amountUsd = parseFloat(amount);
      if (isNaN(amountUsd) || amountUsd <= 0 || amountUsd > 10000) {
        return res.status(400).json({ error: "Enter an amount between $1 and $10,000" });
      }

      const asset = await resolveTradableAsset(ticker, alertId);
      if (!asset) {
        return res.status(400).json({ error: "This stock isn't available for trading" });
      }

      const amountRaw = jupiter.usdToRawAmount(amountUsd);
      const quote = await jupiter.getQuote(USDC_MINT, asset.solanaMint, amountRaw, user.solanaPubkey);
      const decimals = asset.decimals || 9;
      const estimatedOutput = parseFloat(quote.outAmount) / Math.pow(10, decimals);

      res.json({
        ticker: asset.underlyingTicker,
        outputSymbol: asset.ondoSymbol,
        estimatedOutput: estimatedOutput.toFixed(4),
        pricePerShare: estimatedOutput > 0 ? (amountUsd / estimatedOutput).toFixed(2) : null,
        priceImpactPct: quote.priceImpactPct,
      });
    } catch (error: any) {
      console.error("[API] Trade quote error:", error);
      res.status(500).json({ error: trading.friendlyTradeError(error) });
    }
  });

  // Execute a trade server-side via the user's session signer (same path Telegram uses)
  app.post("/api/trade/execute-server", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { alertId, ticker, amount, side } = req.body;

      if (!user.signerEnabled || !user.privyWalletId) {
        return res.status(400).json({ error: "One-tap trading isn't enabled. Enable it in Settings first." });
      }

      const asset = await resolveTradableAsset(ticker, alertId);
      if (!asset) {
        return res.status(400).json({ error: "This stock isn't available for trading" });
      }

      const userAlertId = alertId ? parseInt(alertId) : null;

      if (side === "SELL") {
        const result = await trading.sellEntirePosition(user, asset, userAlertId);
        return res.json({
          success: true,
          signature: result.signature,
          tokensSold: result.tokensSold,
          usdcReceived: result.usdcReceived,
          ticker: asset.underlyingTicker,
        });
      }

      const amountUsd = parseFloat(amount);
      if (isNaN(amountUsd) || amountUsd <= 0 || amountUsd > 10000) {
        return res.status(400).json({ error: "Enter an amount between $1 and $10,000" });
      }

      const result = await trading.buyAsset(user, asset, amountUsd, userAlertId);
      res.json({
        success: true,
        signature: result.signature,
        tokensReceived: result.tokensReceived,
        ticker: asset.underlyingTicker,
      });
    } catch (error: any) {
      console.error("[API] Execute server trade error:", error);
      res.status(400).json({ error: trading.friendlyTradeError(error) });
    }
  });

  app.post("/api/telegram/webhook", (req: Request, res: Response) => {
    // Ack immediately: Telegram redelivers updates that don't get a fast 200,
    // and a redelivered trade callback would execute the trade twice.
    res.status(200).send("OK");
    telegramBot.handleTelegramUpdate(req.body).catch((error) => {
      console.error("[Telegram] Webhook error:", error);
    });
  });

  app.get("/api/admin/assets", authMiddleware, async (req: Request, res: Response) => {
    try {
      const assets = await storage.getAssetRegistry();
      res.json(assets);
    } catch (error) {
      console.error("[API] Admin assets error:", error);
      res.status(500).json({ error: "Failed to get assets" });
    }
  });

  app.post("/api/admin/assets", authMiddleware, async (req: Request, res: Response) => {
    try {
      const asset = await storage.createAsset(req.body);
      res.status(201).json(asset);
    } catch (error) {
      console.error("[API] Create asset error:", error);
      res.status(500).json({ error: "Failed to create asset" });
    }
  });

  app.put("/api/admin/assets/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const asset = await storage.updateAsset(id, req.body);
      res.json(asset);
    } catch (error) {
      console.error("[API] Update asset error:", error);
      res.status(500).json({ error: "Failed to update asset" });
    }
  });

  app.patch("/api/admin/assets/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const asset = await storage.updateAsset(id, req.body);
      res.json(asset);
    } catch (error) {
      console.error("[API] Patch asset error:", error);
      res.status(500).json({ error: "Failed to update asset" });
    }
  });

  app.delete("/api/admin/assets/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
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
