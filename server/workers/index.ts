import cron from "node-cron";
import { storage } from "../storage";
import { tweetProvider, isNewerTweetId } from "../services/tweetProvider";
import { syncFilterRules } from "../services/tweetFilterRules";
import { classifyTweet, getAlertableTickers, getClassifierModel } from "../services/classifier";
import * as telegram from "../services/telegram";
import * as jupiter from "../services/jupiter";
import * as prices from "../services/prices";
import { Connection } from "@solana/web3.js";
import type { ClassificationResult } from "@shared/schema";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC_URL);

function getAppDomain(): string {
  // Priority: custom APP_DOMAIN > deployment domain > dev domain
  if (process.env.APP_DOMAIN) return process.env.APP_DOMAIN;
  if (process.env.REPLIT_DEPLOYMENT_DOMAIN) return process.env.REPLIT_DEPLOYMENT_DOMAIN;
  if (process.env.REPLIT_DEV_DOMAIN) return process.env.REPLIT_DEV_DOMAIN;
  return "localhost:5000";
}

const APP_URL = getAppDomain().includes("localhost") 
  ? `http://${getAppDomain()}`
  : `https://${getAppDomain()}`;

// Send backfill alerts to a user for recent alert events from an influencer
// Called when a user subscribes to an influencer to catch up on recent signals
export async function sendBackfillAlerts(userId: number, influencerId: number): Promise<number> {
  try {
    const user = await storage.getUser(userId);
    if (!user?.telegramChatId) {
      console.log(`[Worker] Backfill skipped: user ${userId} has no Telegram connected`);
      return 0;
    }

    const influencer = await storage.getInfluencer(influencerId);
    if (!influencer) {
      console.log(`[Worker] Backfill skipped: influencer ${influencerId} not found`);
      return 0;
    }

    // Get recent alert events from this influencer's tweets (last 24 hours)
    const recentAlertEvents = await storage.getRecentAlertEventsForInfluencer(influencerId, 24);
    
    let sentCount = 0;
    const mutedTickers = await storage.getMutedTickers(userId);

    for (const alertEvent of recentAlertEvents) {
      // Skip if ticker is muted
      if (mutedTickers.some(m => m.ticker === alertEvent.ticker)) continue;

      // Skip if user already has an alert for this event
      const existingAlerts = await storage.getUserAlertsByEvent(alertEvent.id);
      if (existingAlerts.some(a => a.userId === userId)) continue;

      // Get the tweet for this alert
      const tweet = await storage.getTweet(alertEvent.tweetId);
      if (!tweet) continue;

      // Create user alert
      const userAlert = await storage.createUserAlert({
        userId,
        alertEventId: alertEvent.id,
        status: "SENT",
      });

      // Format and send message
      const message = telegram.formatAlertMessage(
        influencer.handle,
        alertEvent.ticker,
        alertEvent.action || "NONE",
        parseFloat(alertEvent.confidence || "1.0"),
        tweet.text,
        tweet.url,
        tweet.tweetCreatedAt || tweet.ingestedAt
      );

      const defaultAmount = parseFloat(user.defaultBuyAmountUsd || "10");
      
      let userHoldsStock = false;
      if (user.solanaPubkey) {
        try {
          const asset = await storage.getAssetByTicker(alertEvent.ticker);
          if (asset) {
            const balance = await jupiter.getTokenBalance(connection, user.solanaPubkey, asset.solanaMint);
            userHoldsStock = parseFloat(jupiter.rawAmountToDisplay(balance.balance, balance.decimals)) > 0;
          }
        } catch (e) {
          console.log(`[Worker] Backfill: error checking holdings for ${alertEvent.ticker}:`, e);
        }
      }
      
      const buttons = telegram.createTradeButtons(
        userAlert.id, 
        APP_URL, 
        (alertEvent.action || "NONE") as "BUY" | "SELL",
        defaultAmount,
        userHoldsStock
      );

      const sentMessage = await telegram.sendMessage({
        chatId: user.telegramChatId,
        text: message,
        replyMarkup: { inline_keyboard: buttons },
      });

      if (sentMessage) {
        await storage.updateUserAlert(userAlert.id, {
          telegramMessageId: sentMessage.message_id.toString(),
        });
        sentCount++;
      }
    }

    console.log(`[Worker] Backfill: sent ${sentCount} alerts to user ${userId} for @${influencer.handle}`);
    return sentCount;
  } catch (error) {
    console.error(`[Worker] Backfill error for user ${userId}, influencer ${influencerId}:`, error);
    return 0;
  }
}

// Poll tweets for a single influencer - used for instant polling when user adds an influencer
export async function pollInfluencerTweets(influencerId: number): Promise<number> {
  try {
    const influencer = await storage.getInfluencer(influencerId);
    if (!influencer) {
      console.log(`[Worker] Influencer ${influencerId} not found for instant poll`);
      return 0;
    }

    console.log(`[Worker] Instant poll for @${influencer.handle}...`);
    
    const tweets = await tweetProvider.fetchTweets(
      influencer.handle,
      influencer.lastTweetId || undefined,
      influencer.platformUserId || undefined
    );

    if (tweets.length === 0) {
      console.log(`[Worker] No new tweets for @${influencer.handle}`);
      return 0;
    }

    let latestTweetId = influencer.lastTweetId;
    let savedCount = 0;

    for (const tweetData of tweets) {
      const existing = await storage.getTweetByTweetId(tweetData.tweetId);
      if (existing) continue;

      await storage.createTweet({
        influencerId: influencer.id,
        tweetId: tweetData.tweetId,
        text: tweetData.text,
        url: tweetData.url,
        rawJson: tweetData.rawJson,
        tweetCreatedAt: tweetData.createdAt,
      });
      savedCount++;

      if (isNewerTweetId(tweetData.tweetId, latestTweetId)) {
        latestTweetId = tweetData.tweetId;
      }
    }

    await storage.updateInfluencer(influencer.id, {
      lastTweetId: latestTweetId,
      lastPolledAt: new Date(),
    });

    console.log(`[Worker] Instant poll: saved ${savedCount} tweets from @${influencer.handle}`);
    return savedCount;
  } catch (error) {
    console.error(`[Worker] Instant poll error for influencer ${influencerId}:`, error);
    return 0;
  }
}

async function pollTweetsWorker() {
  console.log("[Worker] Starting tweet poll...");
  
  try {
    // Only spend API credits on influencers someone actually subscribes to
    const influencers = await storage.getInfluencersWithActiveSubscribers();

    for (const influencer of influencers) {
      try {
        const tweets = await tweetProvider.fetchTweets(
          influencer.handle,
          influencer.lastTweetId || undefined,
          influencer.platformUserId || undefined
        );

        if (tweets.length === 0) continue;

        let latestTweetId = influencer.lastTweetId;

        for (const tweetData of tweets) {
          const existing = await storage.getTweetByTweetId(tweetData.tweetId);
          if (existing) continue;

          await storage.createTweet({
            influencerId: influencer.id,
            tweetId: tweetData.tweetId,
            text: tweetData.text,
            url: tweetData.url,
            rawJson: tweetData.rawJson,
            tweetCreatedAt: tweetData.createdAt,
          });

          if (isNewerTweetId(tweetData.tweetId, latestTweetId)) {
            latestTweetId = tweetData.tweetId;
          }
        }

        await storage.updateInfluencer(influencer.id, {
          lastTweetId: latestTweetId,
          lastPolledAt: new Date(),
        });

        console.log(`[Worker] Polled ${tweets.length} tweets from @${influencer.handle}`);
      } catch (error) {
        console.error(`[Worker] Error polling @${influencer.handle}:`, error);
      }
    }
  } catch (error) {
    console.error("[Worker] Poll tweets error:", error);
  }
}

// Classify one tweet and fan out alerts for any actionable signals. Called
// from the cron worker and directly from the twitter webhook so pushed tweets
// alert immediately (cron may not fire on serverless deployments that sleep
// between requests).
export async function classifyAndAlertTweet(tweet: { id: number; text: string; influencerId: number; url: string; tweetCreatedAt: Date | null; ingestedAt: Date }): Promise<void> {
  const existing = await storage.getClassificationByTweetId(tweet.id);
  if (existing) return;

  const result = await classifyTweet(tweet.text);

  const classification = await storage.createClassification({
    tweetId: tweet.id,
    isActionable: result.is_actionable,
    overallConfidence: result.overall_confidence.toString(),
    resultJson: result,
    model: getClassifierModel(),
  });

  console.log(`[Worker] Classified tweet ${tweet.id}: actionable=${result.is_actionable} (${result.reason})`);

  for (const ticker of getAlertableTickers(result)) {
    const tickerSymbol = ticker.symbol;
    const asset = await storage.getAssetByTicker(tickerSymbol);
    if (!asset?.isActive) continue;

    // Entry-price snapshot enables trader track records later
    let priceUsdAtEvent: string | undefined;
    try {
      const price = await prices.getTokenPriceUsd(asset.solanaMint, asset.decimals);
      if (price != null) priceUsdAtEvent = price.toFixed(8);
    } catch (e) {
      console.log(`[Worker] Price snapshot failed for ${tickerSymbol}:`, e);
    }

    const alertEvent = await storage.createAlertEvent({
      tweetId: tweet.id,
      classificationId: classification.id,
      ticker: tickerSymbol,
      sentiment: ticker.sentiment,
      action: ticker.action,
      confidence: ticker.confidence.toString(),
      priceUsdAtEvent,
    });

    console.log(`[Worker] Created alert event for $${tickerSymbol}: ${ticker.action} (${ticker.sentiment}, ${ticker.confidence})`);

    await sendAlertsForEvent(alertEvent.id, tweet, {
      symbol: tickerSymbol,
      action: ticker.action,
      confidence: ticker.confidence,
      reason: result.reason,
    });
  }
}

async function classifyTweetsWorker() {
  console.log("[Worker] Starting classification...");

  try {
    const unclassified = await storage.getUnclassifiedTweets(10);

    for (const tweet of unclassified) {
      try {
        await classifyAndAlertTweet(tweet);
      } catch (error) {
        console.error(`[Worker] Error classifying tweet ${tweet.id}:`, error);
      }
    }
  } catch (error) {
    console.error("[Worker] Classification error:", error);
  }
}

async function sendAlertsForEvent(
  alertEventId: number,
  tweet: any,
  ticker: { symbol: string; action: string; confidence: number; reason?: string }
) {
  try {
    const influencer = await storage.getInfluencer(tweet.influencerId);
    if (!influencer) return;

    const subscribers = await storage.getSubscribersForInfluencer(tweet.influencerId);

    for (const sub of subscribers) {
      const user = await storage.getUser(sub.userId);
      if (!user?.telegramChatId) continue;

      const mutedTickers = await storage.getMutedTickers(user.id);
      if (mutedTickers.some(m => m.ticker === ticker.symbol)) continue;

      const existingAlerts = await storage.getUserAlertsByEvent(alertEventId);
      if (existingAlerts.some(a => a.userId === user.id)) {
        console.log(`[Worker] Skipping duplicate alert for user ${user.id}`);
        continue;
      }

      const userAlert = await storage.createUserAlert({
        userId: user.id,
        alertEventId,
        status: "SENT",
      });

      const message = telegram.formatAlertMessage(
        influencer.handle,
        ticker.symbol,
        ticker.action,
        ticker.confidence,
        tweet.text,
        tweet.url,
        tweet.tweetCreatedAt || tweet.ingestedAt,
        ticker.reason
      );

      const defaultAmount = parseFloat(user.defaultBuyAmountUsd || "10");
      
      let userHoldsStock = false;
      if (user.solanaPubkey) {
        try {
          const asset = await storage.getAssetByTicker(ticker.symbol);
          if (asset) {
            const balance = await jupiter.getTokenBalance(connection, user.solanaPubkey, asset.solanaMint);
            userHoldsStock = parseFloat(jupiter.rawAmountToDisplay(balance.balance, balance.decimals)) > 0;
          }
        } catch (e) {
          console.log(`[Worker] Error checking holdings for ${ticker.symbol}:`, e);
        }
      }
      
      const buttons = telegram.createTradeButtons(
        userAlert.id, 
        APP_URL, 
        ticker.action as "BUY" | "SELL",
        defaultAmount,
        userHoldsStock
      );

      const sentMessage = await telegram.sendMessage({
        chatId: user.telegramChatId,
        text: message,
        replyMarkup: { inline_keyboard: buttons },
      });

      if (sentMessage) {
        await storage.updateUserAlert(userAlert.id, {
          telegramMessageId: sentMessage.message_id.toString(),
        });
      }

      console.log(`[Worker] Sent alert to user ${user.id} for ${ticker.symbol}`);
    }
  } catch (error) {
    console.error("[Worker] Send alerts error:", error);
  }
}

// ~24h after a buy executes, tell the user how the trade is doing. This is
// the retention loop: it proves signals work (or don't) with real numbers.
async function tradePerformanceWorker() {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dueTrades = await storage.getTradesForPerformanceCheck(cutoff);
    if (dueTrades.length === 0) return;

    console.log(`[Worker] Performance check for ${dueTrades.length} trade(s)`);
    const USDC_MINT = process.env.USDC_MINT || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

    for (const trade of dueTrades) {
      // Whatever happens below, never re-process this trade
      await storage.updateTrade(trade.id, { performanceNotifiedAt: new Date() });

      try {
        const isBuy = trade.inputMint === USDC_MINT;
        if (!isBuy || !trade.amountOut) continue;

        const user = await storage.getUser(trade.userId);
        if (!user?.telegramChatId) continue;

        const asset = await storage.getAssetByMint(trade.outputMint);
        if (!asset) continue;

        const price = await prices.getTokenPriceUsd(asset.solanaMint, asset.decimals);
        if (price == null) continue;

        const entryUsd = parseInt(trade.amountIn) / 1e6;
        const tokens = parseInt(trade.amountOut) / 10 ** asset.decimals;
        if (!entryUsd || !tokens) continue;

        const currentValue = tokens * price;
        const pnlPct = ((currentValue - entryUsd) / entryUsd) * 100;
        const sign = pnlPct >= 0 ? "+" : "";
        const emoji = pnlPct >= 0 ? "📈" : "📉";

        // Credit the trader whose call triggered the buy, when known
        let sourceLine = "";
        if (trade.userAlertId) {
          const userAlert = await storage.getUserAlert(trade.userAlertId);
          const alertEvent = userAlert ? await storage.getAlertEvent(userAlert.alertEventId) : null;
          const tweet = alertEvent ? await storage.getTweet(alertEvent.tweetId) : null;
          const influencer = tweet ? await storage.getInfluencer(tweet.influencerId) : null;
          if (influencer) sourceLine = `\n👤 From @${influencer.handle}'s call`;
        }

        await telegram.sendMessage({
          chatId: user.telegramChatId,
          text: `${emoji} <b>24h check-in: $${asset.underlyingTicker}</b>\n\nYour $${entryUsd.toFixed(2)} buy is <b>${sign}${pnlPct.toFixed(1)}%</b> (now $${currentValue.toFixed(2)})${sourceLine}`,
          replyMarkup: {
            inline_keyboard: [[
              { text: "📱 View portfolio", url: `${APP_URL}/portfolio` },
            ]],
          },
        });

        console.log(`[Worker] Sent performance follow-up for trade ${trade.id} (${sign}${pnlPct.toFixed(1)}%)`);
      } catch (error) {
        console.error(`[Worker] Performance follow-up error for trade ${trade.id}:`, error);
      }
    }
  } catch (error) {
    console.error("[Worker] Trade performance worker error:", error);
  }
}

async function setupTelegramWebhook() {
  // Only setup webhook in production to avoid dev overwriting production webhook
  const isProduction = process.env.NODE_ENV === "production" || !!process.env.REPLIT_DEPLOYMENT;
  if (!isProduction) {
    console.log("[Telegram] Development mode, skipping webhook setup to avoid overwriting production");
    return;
  }
  
  const domain = getAppDomain();
  if (domain === "localhost:5000") {
    console.log("[Telegram] No domain configured, skipping webhook setup");
    return;
  }
  
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log("[Telegram] No bot token configured, skipping webhook setup");
    return;
  }

  const webhookUrl = `https://${domain}/api/telegram/webhook`;
  console.log(`[Telegram] Setting up webhook: ${webhookUrl}`);
  
  const success = await telegram.setWebhook(webhookUrl);
  if (success) {
    console.log("[Telegram] Webhook configured successfully");
  } else {
    console.error("[Telegram] Failed to configure webhook");
  }
}

export function startWorkers() {
  console.log("[Workers] Starting background jobs...");

  setupTelegramWebhook();

  // Polling is the fallback/backfill path; the twitterapi.io webhook rules
  // (see services/tweetFilterRules.ts) deliver tweets in near real time.
  const pollMinutes = Math.max(1, parseInt(process.env.TWEET_POLL_MINUTES || "30"));
  cron.schedule(`*/${pollMinutes} * * * *`, pollTweetsWorker);
  console.log(`[Workers] Tweet poll job scheduled (every ${pollMinutes} minutes)`);

  syncFilterRules().catch(err => console.error("[Workers] Filter rule sync error:", err));

  cron.schedule("*/1 * * * *", classifyTweetsWorker);
  console.log("[Workers] Classification job scheduled (every 1 minute)");

  cron.schedule("0 * * * *", tradePerformanceWorker);
  console.log("[Workers] Trade performance follow-up job scheduled (hourly)");

  pollTweetsWorker();
  setTimeout(classifyTweetsWorker, 30000);
  setTimeout(tradePerformanceWorker, 60000);
}
