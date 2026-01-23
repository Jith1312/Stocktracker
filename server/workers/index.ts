import cron from "node-cron";
import { storage } from "../storage";
import { tweetProvider } from "../services/tweetProvider";
import { classifyTweet, shouldCreateAlert } from "../services/classifier";
import * as telegram from "../services/telegram";
import * as jupiter from "../services/jupiter";
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

      if (!latestTweetId || tweetData.tweetId > latestTweetId) {
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
    const influencers = await storage.getAllInfluencers();
    
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

          if (!latestTweetId || tweetData.tweetId > latestTweetId) {
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

async function classifyTweetsWorker() {
  console.log("[Worker] Starting classification...");
  
  try {
    const unclassified = await storage.getUnclassifiedTweets(10);
    
    for (const tweet of unclassified) {
      try {
        const result = await classifyTweet(tweet.text);

        await storage.createClassification({
          tweetId: tweet.id,
          isActionable: result.is_actionable,
          overallConfidence: result.overall_confidence.toString(),
          resultJson: result,
          model: "gpt-5.1",
        });

        console.log(`[Worker] Classified tweet ${tweet.id}: actionable=${result.is_actionable}`);

        if (await shouldCreateAlert(result)) {
          for (const ticker of result.tickers) {
            const tickerSymbol = ticker.symbol;
            const asset = await storage.getAssetByTicker(tickerSymbol);
            if (!asset?.isActive) continue;

            const classification = await storage.getClassificationByTweetId(tweet.id);
            if (!classification) continue;

            const alertEvent = await storage.createAlertEvent({
              tweetId: tweet.id,
              classificationId: classification.id,
              ticker: tickerSymbol,
              sentiment: ticker.sentiment || "NEUTRAL",
              action: "NONE",
              confidence: ticker.confidence?.toString() || "1.0",
            });

            console.log(`[Worker] Created alert event for $${tickerSymbol}`);

            await sendAlertsForEvent(alertEvent.id, tweet, { 
              symbol: tickerSymbol, 
              action: "NONE", 
              confidence: ticker.confidence || 1.0 
            });
          }
        }
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
  ticker: { symbol: string; action: string; confidence: number }
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
        tweet.tweetCreatedAt || tweet.ingestedAt
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

  cron.schedule("*/2 * * * *", pollTweetsWorker);
  console.log("[Workers] Tweet poll job scheduled (every 2 minutes)");

  cron.schedule("*/1 * * * *", classifyTweetsWorker);
  console.log("[Workers] Classification job scheduled (every 1 minute)");

  pollTweetsWorker();
  setTimeout(classifyTweetsWorker, 30000);
}
