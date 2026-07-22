import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, boolean, timestamp, decimal, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  privyId: text("privy_id").notNull().unique(),
  email: text("email"),
  solanaPubkey: text("solana_pubkey"),
  privyWalletId: text("privy_wallet_id"),
  signerEnabled: boolean("signer_enabled").default(false),
  telegramChatId: text("telegram_chat_id"),
  telegramUsername: text("telegram_username"),
  defaultBuyAmountUsd: decimal("default_buy_amount_usd", { precision: 10, scale: 2 }).default("10"),
  autoExecuteEnabled: boolean("auto_execute_enabled").default(false),
  onboardingCompleted: boolean("onboarding_completed").default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const influencers = pgTable("influencers", {
  id: serial("id").primaryKey(),
  platform: text("platform").default("X").notNull(),
  handle: text("handle").notNull().unique(),
  profileUrl: text("profile_url").notNull(),
  platformUserId: text("platform_user_id"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  lastTweetId: text("last_tweet_id"),
  lastPolledAt: timestamp("last_polled_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  influencerId: integer("influencer_id").notNull().references(() => influencers.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").default(true).notNull(),
  amountOverrideUsd: decimal("amount_override_usd", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const tweets = pgTable("tweets", {
  id: serial("id").primaryKey(),
  influencerId: integer("influencer_id").notNull().references(() => influencers.id, { onDelete: "cascade" }),
  tweetId: text("tweet_id").notNull().unique(),
  text: text("text").notNull(),
  url: text("url").notNull(),
  rawJson: jsonb("raw_json"),
  tweetCreatedAt: timestamp("tweet_created_at"),
  ingestedAt: timestamp("ingested_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const classifications = pgTable("classifications", {
  id: serial("id").primaryKey(),
  tweetId: integer("tweet_id").notNull().references(() => tweets.id, { onDelete: "cascade" }),
  isActionable: boolean("is_actionable").default(false).notNull(),
  overallConfidence: decimal("overall_confidence", { precision: 3, scale: 2 }),
  resultJson: jsonb("result_json"),
  model: text("model").default("gpt-5.1"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const alertEvents = pgTable("alert_events", {
  id: serial("id").primaryKey(),
  tweetId: integer("tweet_id").notNull().references(() => tweets.id, { onDelete: "cascade" }),
  classificationId: integer("classification_id").notNull().references(() => classifications.id, { onDelete: "cascade" }),
  ticker: text("ticker").notNull(),
  sentiment: text("sentiment").notNull(),
  action: text("action").notNull(),
  confidence: decimal("confidence", { precision: 3, scale: 2 }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const userAlerts = pgTable("user_alerts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  alertEventId: integer("alert_event_id").notNull().references(() => alertEvents.id, { onDelete: "cascade" }),
  status: text("status").default("SENT").notNull(),
  telegramMessageId: text("telegram_message_id"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const preparedOrders = pgTable("prepared_orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  userAlertId: integer("user_alert_id").references(() => userAlerts.id, { onDelete: "set null" }),
  inputMint: text("input_mint").notNull(),
  outputMint: text("output_mint").notNull(),
  amountIn: text("amount_in").notNull(),
  quoteJson: jsonb("quote_json"),
  swapTxBase64: text("swap_tx_base64"),
  expiresAt: timestamp("expires_at"),
  status: text("status").default("PENDING").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  userAlertId: integer("user_alert_id").references(() => userAlerts.id, { onDelete: "set null" }),
  preparedOrderId: integer("prepared_order_id").references(() => preparedOrders.id, { onDelete: "set null" }),
  txSig: text("tx_sig"),
  inputMint: text("input_mint").notNull(),
  outputMint: text("output_mint").notNull(),
  amountIn: text("amount_in").notNull(),
  amountOut: text("amount_out"),
  status: text("status").default("PENDING").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const assetRegistry = pgTable("asset_registry", {
  id: serial("id").primaryKey(),
  underlyingTicker: text("underlying_ticker").notNull().unique(),
  ondoSymbol: text("ondo_symbol").notNull(),
  solanaMint: text("solana_mint").notNull(),
  tokenProgram: text("token_program").default("SPL").notNull(),
  decimals: integer("decimals").default(6).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const telegramLinkTokens = pgTable("telegram_link_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const mutedTickers = pgTable("muted_tickers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ticker: text("ticker").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const transfers = pgTable("transfers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  txSig: text("tx_sig").notNull(),
  tokenMint: text("token_mint").notNull(),
  amount: text("amount").notNull(),
  fromAddress: text("from_address").notNull(),
  toAddress: text("to_address").notNull(),
  direction: text("direction").notNull(), // 'incoming' or 'outgoing'
  symbol: text("symbol"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  subscriptions: many(subscriptions),
  userAlerts: many(userAlerts),
  preparedOrders: many(preparedOrders),
  trades: many(trades),
  mutedTickers: many(mutedTickers),
}));

export const influencersRelations = relations(influencers, ({ many }) => ({
  subscriptions: many(subscriptions),
  tweets: many(tweets),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, { fields: [subscriptions.userId], references: [users.id] }),
  influencer: one(influencers, { fields: [subscriptions.influencerId], references: [influencers.id] }),
}));

export const tweetsRelations = relations(tweets, ({ one, many }) => ({
  influencer: one(influencers, { fields: [tweets.influencerId], references: [influencers.id] }),
  classifications: many(classifications),
  alertEvents: many(alertEvents),
}));

export const classificationsRelations = relations(classifications, ({ one, many }) => ({
  tweet: one(tweets, { fields: [classifications.tweetId], references: [tweets.id] }),
  alertEvents: many(alertEvents),
}));

export const alertEventsRelations = relations(alertEvents, ({ one, many }) => ({
  tweet: one(tweets, { fields: [alertEvents.tweetId], references: [tweets.id] }),
  classification: one(classifications, { fields: [alertEvents.classificationId], references: [classifications.id] }),
  userAlerts: many(userAlerts),
}));

export const userAlertsRelations = relations(userAlerts, ({ one }) => ({
  user: one(users, { fields: [userAlerts.userId], references: [users.id] }),
  alertEvent: one(alertEvents, { fields: [userAlerts.alertEventId], references: [alertEvents.id] }),
}));

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertInfluencerSchema = createInsertSchema(influencers).omit({ id: true, createdAt: true });
export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ id: true, createdAt: true });
export const insertTweetSchema = createInsertSchema(tweets).omit({ id: true, ingestedAt: true });
export const insertClassificationSchema = createInsertSchema(classifications).omit({ id: true, createdAt: true });
export const insertAlertEventSchema = createInsertSchema(alertEvents).omit({ id: true, createdAt: true });
export const insertUserAlertSchema = createInsertSchema(userAlerts).omit({ id: true, createdAt: true });
export const insertPreparedOrderSchema = createInsertSchema(preparedOrders).omit({ id: true, createdAt: true });
export const insertTradeSchema = createInsertSchema(trades).omit({ id: true, createdAt: true });
export const insertAssetRegistrySchema = createInsertSchema(assetRegistry).omit({ id: true, createdAt: true });
export const insertTelegramLinkTokenSchema = createInsertSchema(telegramLinkTokens).omit({ id: true, createdAt: true });
export const insertMutedTickerSchema = createInsertSchema(mutedTickers).omit({ id: true, createdAt: true });
export const insertTransferSchema = createInsertSchema(transfers).omit({ id: true, createdAt: true });

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Influencer = typeof influencers.$inferSelect;
export type InsertInfluencer = z.infer<typeof insertInfluencerSchema>;
export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Tweet = typeof tweets.$inferSelect;
export type InsertTweet = z.infer<typeof insertTweetSchema>;
export type Classification = typeof classifications.$inferSelect;
export type InsertClassification = z.infer<typeof insertClassificationSchema>;
export type AlertEvent = typeof alertEvents.$inferSelect;
export type InsertAlertEvent = z.infer<typeof insertAlertEventSchema>;
export type UserAlert = typeof userAlerts.$inferSelect;
export type InsertUserAlert = z.infer<typeof insertUserAlertSchema>;
export type PreparedOrder = typeof preparedOrders.$inferSelect;
export type InsertPreparedOrder = z.infer<typeof insertPreparedOrderSchema>;
export type Trade = typeof trades.$inferSelect;
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type AssetRegistryEntry = typeof assetRegistry.$inferSelect;
export type InsertAssetRegistryEntry = z.infer<typeof insertAssetRegistrySchema>;
export type TelegramLinkToken = typeof telegramLinkTokens.$inferSelect;
export type InsertTelegramLinkToken = z.infer<typeof insertTelegramLinkTokenSchema>;
export type MutedTicker = typeof mutedTickers.$inferSelect;
export type InsertMutedTicker = z.infer<typeof insertMutedTickerSchema>;
export type Transfer = typeof transfers.$inferSelect;
export type InsertTransfer = z.infer<typeof insertTransferSchema>;

export const classificationResultSchema = z.object({
  is_actionable: z.boolean(),
  tickers: z.array(z.object({
    symbol: z.string(),
    sentiment: z.enum(["BULLISH", "BEARISH", "NEUTRAL"]),
    action: z.enum(["BUY", "SELL", "NONE"]),
    confidence: z.number().min(0).max(1),
  })),
  overall_confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export type ClassificationResult = z.infer<typeof classificationResultSchema>;
