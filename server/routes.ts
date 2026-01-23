import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { z } from "zod";
import { Connection, PublicKey } from "@solana/web3.js";
import { PrivyClient } from "@privy-io/server-auth";
import { randomBytes } from "crypto";
import { tweetProvider } from "./services/tweetProvider";
import { classifyTweet, shouldCreateAlert } from "./services/classifier";
import * as jupiter from "./services/jupiter";
import * as telegram from "./services/telegram";

const privy = new PrivyClient(
  process.env.PRIVY_APP_ID!,
  process.env.PRIVY_APP_SECRET!
);

const connection = new Connection(
  process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com"
);

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
      const solanaPubkey = privyUser?.wallet?.address || null;
      
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

  app.get("/api/user/profile", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      
      const privyUser = await privy.getUser((req as any).privyUserId);
      const walletAddress = privyUser?.wallet?.address || user.solanaPubkey;
      
      if (walletAddress && walletAddress !== user.solanaPubkey) {
        await storage.updateUser(user.id, { solanaPubkey: walletAddress });
      }

      res.json({
        id: user.id,
        email: user.email || privyUser?.email?.address,
        solanaPubkey: walletAddress,
        telegramChatId: user.telegramChatId,
        telegramUsername: user.telegramUsername,
        defaultBuyAmountUsd: user.defaultBuyAmountUsd,
        autoExecuteEnabled: user.autoExecuteEnabled,
      });
    } catch (error) {
      console.error("[API] Profile error:", error);
      res.status(500).json({ error: "Failed to get profile" });
    }
  });

  app.patch("/api/user/profile", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { defaultBuyAmountUsd, autoExecuteEnabled } = req.body;
      
      const updated = await storage.updateUser(user.id, {
        defaultBuyAmountUsd,
        autoExecuteEnabled,
      });
      
      res.json(updated);
    } catch (error) {
      console.error("[API] Update profile error:", error);
      res.status(500).json({ error: "Failed to update profile" });
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
      const assets = await storage.getAllAssets();
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
      res.json(trades);
    } catch (error) {
      console.error("[API] Trades error:", error);
      res.status(500).json({ error: "Failed to get trades" });
    }
  });

  app.get("/api/portfolio/holdings", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user.solanaPubkey) {
        return res.json([]);
      }

      const assets = await storage.getAssetRegistry();
      const activeAssets = assets.filter(a => a.isActive);
      
      const holdings = await Promise.all(activeAssets.map(async (asset) => {
        try {
          const balance = await jupiter.getTokenBalance(connection, user.solanaPubkey, asset.solanaMint);
          const displayBalance = jupiter.rawAmountToDisplay(balance.balance, asset.decimals);
          
          if (parseFloat(displayBalance) === 0) return null;
          
          return {
            mint: asset.solanaMint,
            symbol: asset.ondoSymbol,
            underlyingTicker: asset.underlyingTicker,
            balance: displayBalance,
            usdValue: null,
          };
        } catch (e) {
          return null;
        }
      }));
      
      res.json(holdings.filter(Boolean));
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

  app.get("/api/telegram/link", authMiddleware, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      
      const token = randomBytes(16).toString("hex");
      await storage.createTelegramLinkToken({
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      const botUsername = "copeitbot";
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
          text: "Welcome to StockPulse! To connect your account, please use the link from the app.",
        });
      }

      if (message?.text === "/help") {
        await telegram.sendMessage({
          chatId: message.chat.id.toString(),
          text: `📊 <b>StockPulse Bot Commands</b>

/help - Show this message
/balance - Show your wallet balance
/portfolio - Show your holdings and trade history
/mute TICKER - Mute alerts for a ticker
/unmute TICKER - Unmute alerts for a ticker
/amount NUMBER - Set default trade amount (e.g., /amount 50)`,
          parseMode: "HTML",
        });
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

            const trades = await storage.getTradesForUser(user.id);
            const recentTrades = trades.slice(0, 5);

            let portfolioText = `💰 <b>Your Wallet Balance</b>

🟣 SOL: ${solAmount}
💵 USDC: $${usdcBalance}

📍 Wallet: <code>${user.solanaPubkey.slice(0, 8)}...${user.solanaPubkey.slice(-6)}</code>`;

            if (message?.text === "/portfolio") {
              if (recentTrades.length > 0) {
                portfolioText += `\n\n📈 <b>Recent Trades</b>`;
                for (const trade of recentTrades) {
                  const date = new Date(trade.executedAt!).toLocaleDateString();
                  portfolioText += `\n• ${trade.side} $${trade.amountUsd} → ${trade.outputMint?.slice(0, 6)}... (${date})`;
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
          const appUrl = `${req.protocol}://${req.get("host")}`;
          await telegram.editMessageText(
            callback_query.message.chat.id.toString(),
            callback_query.message.message_id,
            `${callback_query.message.text}\n\n⏳ Preparing ${actionText.toLowerCase()} for $${amount}...\n\n<a href="${appUrl}/trade/confirm?alertId=${userAlertId}&amount=${amount}&action=${tradeAction}">Click here to confirm</a>`,
          );
        }
        
        if (action === "ignore") {
          await storage.updateUserAlert(parseInt(userAlertId), { status: "IGNORED" });
          await telegram.editMessageText(
            callback_query.message.chat.id.toString(),
            callback_query.message.message_id,
            `${callback_query.message.text}\n\n❌ Alert ignored`,
          );
        }
      }

      res.status(200).send("OK");
    } catch (error) {
      console.error("[Telegram] Webhook error:", error);
      res.status(200).send("OK");
    }
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
      const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(",")[0];
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

  return httpServer;
}
