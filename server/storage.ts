import { db } from "./db";
import { eq, desc, and, isNull, lt, gte, sql } from "drizzle-orm";
import {
  users, influencers, subscriptions, tweets, classifications,
  alertEvents, userAlerts, preparedOrders, trades, assetRegistry,
  telegramLinkTokens, mutedTickers, transfers,
  type User, type InsertUser,
  type Influencer, type InsertInfluencer,
  type Subscription, type InsertSubscription,
  type Tweet, type InsertTweet,
  type Classification, type InsertClassification,
  type AlertEvent, type InsertAlertEvent,
  type UserAlert, type InsertUserAlert,
  type PreparedOrder, type InsertPreparedOrder,
  type Trade, type InsertTrade,
  type AssetRegistryEntry, type InsertAssetRegistryEntry,
  type TelegramLinkToken, type InsertTelegramLinkToken,
  type MutedTicker, type InsertMutedTicker,
  type Transfer, type InsertTransfer,
} from "@shared/schema";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByPrivyId(privyId: string): Promise<User | undefined>;
  getUserByTelegramChatId(chatId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<User>): Promise<User | undefined>;

  getInfluencer(id: number): Promise<Influencer | undefined>;
  getInfluencerByHandle(handle: string): Promise<Influencer | undefined>;
  getAllInfluencers(): Promise<Influencer[]>;
  createInfluencer(influencer: InsertInfluencer): Promise<Influencer>;
  updateInfluencer(id: number, data: Partial<Influencer>): Promise<Influencer | undefined>;

  getSubscription(id: number): Promise<Subscription | undefined>;
  getSubscriptionsByUser(userId: number): Promise<Subscription[]>;
  getSubscriptionByUserAndInfluencer(userId: number, influencerId: number): Promise<Subscription | undefined>;
  getSubscribersForInfluencer(influencerId: number): Promise<Subscription[]>;
  createSubscription(sub: InsertSubscription): Promise<Subscription>;
  updateSubscription(id: number, data: Partial<Subscription>): Promise<Subscription | undefined>;
  deleteSubscription(id: number): Promise<void>;

  getTweet(id: number): Promise<Tweet | undefined>;
  getTweetByTweetId(tweetId: string): Promise<Tweet | undefined>;
  getTweetsByInfluencer(influencerId: number, limit?: number): Promise<Tweet[]>;
  getUnclassifiedTweets(limit?: number): Promise<Tweet[]>;
  createTweet(tweet: InsertTweet): Promise<Tweet>;

  getClassification(id: number): Promise<Classification | undefined>;
  getClassificationByTweetId(tweetId: number): Promise<Classification | undefined>;
  createClassification(classification: InsertClassification): Promise<Classification>;

  getAlertEvent(id: number): Promise<AlertEvent | undefined>;
  createAlertEvent(alertEvent: InsertAlertEvent): Promise<AlertEvent>;
  getRecentAlertEventsForInfluencer(influencerId: number, hoursBack: number): Promise<AlertEvent[]>;
  getAlertEventsByInfluencer(influencerId: number, limit?: number): Promise<AlertEvent[]>;

  getUserAlert(id: number): Promise<UserAlert | undefined>;
  getUserAlertsByUser(userId: number, limit?: number): Promise<UserAlert[]>;
  getUserAlertsByEvent(alertEventId: number): Promise<UserAlert[]>;
  createUserAlert(userAlert: InsertUserAlert): Promise<UserAlert>;
  updateUserAlert(id: number, data: Partial<UserAlert>): Promise<UserAlert | undefined>;

  getPreparedOrder(id: number): Promise<PreparedOrder | undefined>;
  createPreparedOrder(order: InsertPreparedOrder): Promise<PreparedOrder>;
  updatePreparedOrder(id: number, data: Partial<PreparedOrder>): Promise<PreparedOrder | undefined>;

  getTrade(id: number): Promise<Trade | undefined>;
  getTradesByUser(userId: number, limit?: number): Promise<Trade[]>;
  createTrade(trade: InsertTrade): Promise<Trade>;
  updateTrade(id: number, data: Partial<Trade>): Promise<Trade | undefined>;
  getTradesForPerformanceCheck(cutoff: Date): Promise<Trade[]>;

  getAssetRegistry(): Promise<AssetRegistryEntry[]>;
  getAssetByTicker(ticker: string): Promise<AssetRegistryEntry | undefined>;
  getAssetByMint(mint: string): Promise<AssetRegistryEntry | undefined>;
  createAsset(asset: InsertAssetRegistryEntry): Promise<AssetRegistryEntry>;
  updateAsset(id: number, data: Partial<AssetRegistryEntry>): Promise<AssetRegistryEntry | undefined>;
  deleteAsset(id: number): Promise<void>;

  createTelegramLinkToken(token: InsertTelegramLinkToken): Promise<TelegramLinkToken>;
  getTelegramLinkToken(token: string): Promise<TelegramLinkToken | undefined>;
  markTelegramLinkTokenUsed(id: number): Promise<void>;

  getMutedTickers(userId: number): Promise<MutedTicker[]>;
  muteTicker(userId: number, ticker: string): Promise<MutedTicker>;
  unmuteTicker(userId: number, ticker: string): Promise<void>;

  getTransfersByUser(userId: number, limit?: number): Promise<Transfer[]>;
  createTransfer(transfer: InsertTransfer): Promise<Transfer>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByPrivyId(privyId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.privyId, privyId));
    return user;
  }

  async getUserByTelegramChatId(chatId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.telegramChatId, chatId));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: number, data: Partial<User>): Promise<User | undefined> {
    const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return user;
  }

  async getInfluencer(id: number): Promise<Influencer | undefined> {
    const [influencer] = await db.select().from(influencers).where(eq(influencers.id, id));
    return influencer;
  }

  async getInfluencerByHandle(handle: string): Promise<Influencer | undefined> {
    const [influencer] = await db.select().from(influencers).where(eq(influencers.handle, handle));
    return influencer;
  }

  async getAllInfluencers(): Promise<Influencer[]> {
    return db.select().from(influencers).orderBy(desc(influencers.createdAt));
  }

  async createInfluencer(insertInfluencer: InsertInfluencer): Promise<Influencer> {
    const [influencer] = await db.insert(influencers).values(insertInfluencer).returning();
    return influencer;
  }

  async updateInfluencer(id: number, data: Partial<Influencer>): Promise<Influencer | undefined> {
    const [influencer] = await db.update(influencers).set(data).where(eq(influencers.id, id)).returning();
    return influencer;
  }

  async getSubscription(id: number): Promise<Subscription | undefined> {
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, id));
    return sub;
  }

  async getSubscriptionsByUser(userId: number): Promise<Subscription[]> {
    return db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.createdAt));
  }

  async getSubscriptionByUserAndInfluencer(userId: number, influencerId: number): Promise<Subscription | undefined> {
    const [sub] = await db.select().from(subscriptions).where(
      and(eq(subscriptions.userId, userId), eq(subscriptions.influencerId, influencerId))
    );
    return sub;
  }

  async getSubscribersForInfluencer(influencerId: number): Promise<Subscription[]> {
    return db.select().from(subscriptions).where(
      and(eq(subscriptions.influencerId, influencerId), eq(subscriptions.enabled, true))
    );
  }

  async createSubscription(insertSub: InsertSubscription): Promise<Subscription> {
    const [sub] = await db.insert(subscriptions).values(insertSub).returning();
    return sub;
  }

  async updateSubscription(id: number, data: Partial<Subscription>): Promise<Subscription | undefined> {
    const [sub] = await db.update(subscriptions).set(data).where(eq(subscriptions.id, id)).returning();
    return sub;
  }

  async deleteSubscription(id: number): Promise<void> {
    await db.delete(subscriptions).where(eq(subscriptions.id, id));
  }

  async getTweet(id: number): Promise<Tweet | undefined> {
    const [tweet] = await db.select().from(tweets).where(eq(tweets.id, id));
    return tweet;
  }

  async getTweetByTweetId(tweetId: string): Promise<Tweet | undefined> {
    const [tweet] = await db.select().from(tweets).where(eq(tweets.tweetId, tweetId));
    return tweet;
  }

  async getTweetsByInfluencer(influencerId: number, limit = 50): Promise<Tweet[]> {
    return db.select().from(tweets)
      .where(eq(tweets.influencerId, influencerId))
      .orderBy(desc(tweets.ingestedAt))
      .limit(limit);
  }

  async getUnclassifiedTweets(limit = 100): Promise<Tweet[]> {
    const classified = db.select({ tweetId: classifications.tweetId }).from(classifications);
    return db.select().from(tweets)
      .where(sql`${tweets.id} NOT IN (SELECT ${classifications.tweetId} FROM ${classifications})`)
      .orderBy(tweets.ingestedAt)
      .limit(limit);
  }

  async createTweet(insertTweet: InsertTweet): Promise<Tweet> {
    const [tweet] = await db.insert(tweets).values(insertTweet).returning();
    return tweet;
  }

  async getClassification(id: number): Promise<Classification | undefined> {
    const [classification] = await db.select().from(classifications).where(eq(classifications.id, id));
    return classification;
  }

  async getClassificationByTweetId(tweetId: number): Promise<Classification | undefined> {
    const [classification] = await db.select().from(classifications).where(eq(classifications.tweetId, tweetId));
    return classification;
  }

  async createClassification(insertClassification: InsertClassification): Promise<Classification> {
    const [classification] = await db.insert(classifications).values(insertClassification).returning();
    return classification;
  }

  async getAlertEvent(id: number): Promise<AlertEvent | undefined> {
    const [alertEvent] = await db.select().from(alertEvents).where(eq(alertEvents.id, id));
    return alertEvent;
  }

  async createAlertEvent(insertAlertEvent: InsertAlertEvent): Promise<AlertEvent> {
    const [alertEvent] = await db.insert(alertEvents).values(insertAlertEvent).returning();
    return alertEvent;
  }

  async getRecentAlertEventsForInfluencer(influencerId: number, hoursBack: number): Promise<AlertEvent[]> {
    const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    return await db
      .select({
        id: alertEvents.id,
        tweetId: alertEvents.tweetId,
        classificationId: alertEvents.classificationId,
        ticker: alertEvents.ticker,
        sentiment: alertEvents.sentiment,
        action: alertEvents.action,
        confidence: alertEvents.confidence,
        priceUsdAtEvent: alertEvents.priceUsdAtEvent,
        createdAt: alertEvents.createdAt,
      })
      .from(alertEvents)
      .innerJoin(tweets, eq(alertEvents.tweetId, tweets.id))
      .where(
        and(
          eq(tweets.influencerId, influencerId),
          gte(alertEvents.createdAt, cutoffTime)
        )
      )
      .orderBy(desc(alertEvents.createdAt));
  }

  async getAlertEventsByInfluencer(influencerId: number, limit = 200): Promise<AlertEvent[]> {
    return await db
      .select({
        id: alertEvents.id,
        tweetId: alertEvents.tweetId,
        classificationId: alertEvents.classificationId,
        ticker: alertEvents.ticker,
        sentiment: alertEvents.sentiment,
        action: alertEvents.action,
        confidence: alertEvents.confidence,
        priceUsdAtEvent: alertEvents.priceUsdAtEvent,
        createdAt: alertEvents.createdAt,
      })
      .from(alertEvents)
      .innerJoin(tweets, eq(alertEvents.tweetId, tweets.id))
      .where(eq(tweets.influencerId, influencerId))
      .orderBy(desc(alertEvents.createdAt))
      .limit(limit);
  }

  async getUserAlert(id: number): Promise<UserAlert | undefined> {
    const [userAlert] = await db.select().from(userAlerts).where(eq(userAlerts.id, id));
    return userAlert;
  }

  async getUserAlertsByUser(userId: number, limit = 50): Promise<UserAlert[]> {
    return db.select().from(userAlerts)
      .where(eq(userAlerts.userId, userId))
      .orderBy(desc(userAlerts.createdAt))
      .limit(limit);
  }

  async getUserAlertsByEvent(alertEventId: number): Promise<UserAlert[]> {
    return db.select().from(userAlerts)
      .where(eq(userAlerts.alertEventId, alertEventId));
  }

  async createUserAlert(insertUserAlert: InsertUserAlert): Promise<UserAlert> {
    const [userAlert] = await db.insert(userAlerts).values(insertUserAlert).returning();
    return userAlert;
  }

  async updateUserAlert(id: number, data: Partial<UserAlert>): Promise<UserAlert | undefined> {
    const [userAlert] = await db.update(userAlerts).set(data).where(eq(userAlerts.id, id)).returning();
    return userAlert;
  }

  async getPreparedOrder(id: number): Promise<PreparedOrder | undefined> {
    const [order] = await db.select().from(preparedOrders).where(eq(preparedOrders.id, id));
    return order;
  }

  async createPreparedOrder(insertOrder: InsertPreparedOrder): Promise<PreparedOrder> {
    const [order] = await db.insert(preparedOrders).values(insertOrder).returning();
    return order;
  }

  async updatePreparedOrder(id: number, data: Partial<PreparedOrder>): Promise<PreparedOrder | undefined> {
    const [order] = await db.update(preparedOrders).set(data).where(eq(preparedOrders.id, id)).returning();
    return order;
  }

  async getTrade(id: number): Promise<Trade | undefined> {
    const [trade] = await db.select().from(trades).where(eq(trades.id, id));
    return trade;
  }

  async getTradesByUser(userId: number, limit = 50): Promise<Trade[]> {
    return db.select().from(trades)
      .where(eq(trades.userId, userId))
      .orderBy(desc(trades.createdAt))
      .limit(limit);
  }

  async createTrade(insertTrade: InsertTrade): Promise<Trade> {
    const [trade] = await db.insert(trades).values(insertTrade).returning();
    return trade;
  }

  async updateTrade(id: number, data: Partial<Trade>): Promise<Trade | undefined> {
    const [trade] = await db.update(trades).set(data).where(eq(trades.id, id)).returning();
    return trade;
  }

  // Completed trades older than cutoff that haven't had a performance
  // follow-up sent yet.
  async getTradesForPerformanceCheck(cutoff: Date): Promise<Trade[]> {
    return db.select().from(trades)
      .where(
        and(
          eq(trades.status, "COMPLETED"),
          isNull(trades.performanceNotifiedAt),
          lt(trades.createdAt, cutoff)
        )
      )
      .orderBy(desc(trades.createdAt))
      .limit(200);
  }

  async getAssetRegistry(): Promise<AssetRegistryEntry[]> {
    return db.select().from(assetRegistry).orderBy(assetRegistry.underlyingTicker);
  }

  async getAssetByTicker(ticker: string): Promise<AssetRegistryEntry | undefined> {
    const [asset] = await db.select().from(assetRegistry).where(eq(assetRegistry.underlyingTicker, ticker));
    return asset;
  }

  async getAssetByMint(mint: string): Promise<AssetRegistryEntry | undefined> {
    const [asset] = await db.select().from(assetRegistry).where(eq(assetRegistry.solanaMint, mint));
    return asset;
  }

  async createAsset(insertAsset: InsertAssetRegistryEntry): Promise<AssetRegistryEntry> {
    const [asset] = await db.insert(assetRegistry).values(insertAsset).returning();
    return asset;
  }

  async updateAsset(id: number, data: Partial<AssetRegistryEntry>): Promise<AssetRegistryEntry | undefined> {
    const [asset] = await db.update(assetRegistry).set(data).where(eq(assetRegistry.id, id)).returning();
    return asset;
  }

  async deleteAsset(id: number): Promise<void> {
    await db.delete(assetRegistry).where(eq(assetRegistry.id, id));
  }

  async createTelegramLinkToken(insertToken: InsertTelegramLinkToken): Promise<TelegramLinkToken> {
    const [token] = await db.insert(telegramLinkTokens).values(insertToken).returning();
    return token;
  }

  async getTelegramLinkToken(token: string): Promise<TelegramLinkToken | undefined> {
    const [linkToken] = await db.select().from(telegramLinkTokens).where(eq(telegramLinkTokens.token, token));
    return linkToken;
  }

  async markTelegramLinkTokenUsed(id: number): Promise<void> {
    await db.update(telegramLinkTokens).set({ used: true }).where(eq(telegramLinkTokens.id, id));
  }

  async getMutedTickers(userId: number): Promise<MutedTicker[]> {
    return db.select().from(mutedTickers).where(eq(mutedTickers.userId, userId));
  }

  async muteTicker(userId: number, ticker: string): Promise<MutedTicker> {
    const [muted] = await db.insert(mutedTickers).values({ userId, ticker }).returning();
    return muted;
  }

  async unmuteTicker(userId: number, ticker: string): Promise<void> {
    await db.delete(mutedTickers).where(
      and(eq(mutedTickers.userId, userId), eq(mutedTickers.ticker, ticker))
    );
  }

  async getTransfersByUser(userId: number, limit: number = 50): Promise<Transfer[]> {
    return db.select().from(transfers)
      .where(eq(transfers.userId, userId))
      .orderBy(desc(transfers.createdAt))
      .limit(limit);
  }

  async createTransfer(insertTransfer: InsertTransfer): Promise<Transfer> {
    const [transfer] = await db.insert(transfers).values(insertTransfer).returning();
    return transfer;
  }
}

export const storage = new DatabaseStorage();
