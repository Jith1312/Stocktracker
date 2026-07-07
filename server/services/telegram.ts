const TELEGRAM_API_URL = "https://api.telegram.org";

interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

interface SendMessageOptions {
  chatId: string;
  text: string;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
  replyMarkup?: {
    inline_keyboard: InlineKeyboardButton[][];
  };
  disableWebPagePreview?: boolean;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
}

export async function sendMessage(options: SendMessageOptions): Promise<TelegramMessage | null> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error("[Telegram] No bot token configured");
    return null;
  }

  try {
    const response = await fetch(`${TELEGRAM_API_URL}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: options.chatId,
        text: options.text,
        parse_mode: options.parseMode || "HTML",
        reply_markup: options.replyMarkup,
        link_preview_options: { is_disabled: options.disableWebPagePreview !== false },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[Telegram] Send error:", error);
      return null;
    }

    const data = await response.json();
    return data.result;
  } catch (error) {
    console.error("[Telegram] Error sending message:", error);
    return null;
  }
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  try {
    const response = await fetch(`${TELEGRAM_API_URL}/bot${botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
      }),
    });

    return response.ok;
  } catch (error) {
    console.error("[Telegram] Error answering callback:", error);
    return false;
  }
}

export async function editMessageText(
  chatId: string,
  messageId: number,
  text: string,
  replyMarkup?: { inline_keyboard: InlineKeyboardButton[][] }
): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  try {
    const response = await fetch(`${TELEGRAM_API_URL}/bot${botToken}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
        reply_markup: replyMarkup,
        link_preview_options: { is_disabled: true },
      }),
    });

    return response.ok;
  } catch (error) {
    console.error("[Telegram] Error editing message:", error);
    return false;
  }
}

// Remove (or replace) just the buttons on a message without touching its text.
// Used to retire the action buttons on an alert once it's been acted on,
// so the original alert content and formatting stay intact.
export async function editMessageReplyMarkup(
  chatId: string,
  messageId: number,
  replyMarkup?: { inline_keyboard: InlineKeyboardButton[][] }
): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  try {
    const response = await fetch(`${TELEGRAM_API_URL}/bot${botToken}/editMessageReplyMarkup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: replyMarkup ?? { inline_keyboard: [] },
      }),
    });

    return response.ok;
  } catch (error) {
    console.error("[Telegram] Error editing reply markup:", error);
    return false;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface AlertMessageContext {
  influencerHandle: string;
  ticker: string;
  tweetExcerpt: string;
  tweetUrl: string;
  tweetDate?: Date;
  /** Current price of 1 share in USD, when available */
  priceUsd?: number | null;
  /** The user's current position in this stock, when they hold it */
  position?: { balance: string; valueUsd?: number | null } | null;
}

export function formatAlertMessage(ctx: AlertMessageContext): string {
  const dateStr = ctx.tweetDate
    ? ctx.tweetDate.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "";

  const excerpt = escapeHtml(
    ctx.tweetExcerpt.length > 250 ? `${ctx.tweetExcerpt.slice(0, 250)}…` : ctx.tweetExcerpt
  );

  const lines = [
    `🚨 <b>@${escapeHtml(ctx.influencerHandle)} mentioned $${escapeHtml(ctx.ticker)}</b>${dateStr ? ` · ${dateStr}` : ""}`,
    "",
    `<i>"${excerpt}"</i>`,
    "",
  ];

  const facts: string[] = [];
  if (ctx.priceUsd != null && ctx.priceUsd > 0) {
    facts.push(`💵 $${ctx.ticker} price: <b>$${ctx.priceUsd.toFixed(2)}</b>`);
  }
  if (ctx.position) {
    const value =
      ctx.position.valueUsd != null && ctx.position.valueUsd > 0
        ? ` (~$${ctx.position.valueUsd.toFixed(2)})`
        : "";
    facts.push(`📊 You hold: <b>${ctx.position.balance} ${ctx.ticker}</b>${value}`);
  }
  if (facts.length > 0) {
    lines.push(...facts, "");
  }

  lines.push(`<a href="${ctx.tweetUrl}">View post on X</a>`);

  return lines.join("\n");
}

export interface TradeButtonContext {
  userAlertId: number;
  appUrl: string;
  ticker: string;
  defaultAmountUsd?: number;
  /** Set when the user already holds this stock so we can offer a sell */
  holdingValueUsd?: number | null;
  userHoldsStock?: boolean;
}

export function createTradeButtons(ctx: TradeButtonContext): InlineKeyboardButton[][] {
  const base = Math.max(1, Math.round(ctx.defaultAmountUsd || 10));
  const larger = Math.max(base + 1, Math.round(base * 2.5));

  const buttons: InlineKeyboardButton[][] = [
    [
      { text: `🟢 Buy $${base}`, callback_data: `trade:${ctx.userAlertId}:${base}:BUY` },
      { text: `🟢 Buy $${larger}`, callback_data: `trade:${ctx.userAlertId}:${larger}:BUY` },
    ],
  ];

  if (ctx.userHoldsStock) {
    const value =
      ctx.holdingValueUsd != null && ctx.holdingValueUsd > 0
        ? ` (~$${ctx.holdingValueUsd.toFixed(2)})`
        : "";
    buttons.push([
      { text: `🔴 Sell all ${ctx.ticker}${value}`, callback_data: `trade:${ctx.userAlertId}:ALL:SELL` },
    ]);
  }

  buttons.push([
    { text: "✏️ Custom amount", url: `${ctx.appUrl}/trade/confirm?alertId=${ctx.userAlertId}` },
    { text: "🔕 Dismiss", callback_data: `ignore:${ctx.userAlertId}` },
  ]);

  return buttons;
}

export async function setWebhook(webhookUrl: string): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  try {
    const response = await fetch(`${TELEGRAM_API_URL}/bot${botToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ["message", "callback_query"],
      }),
    });

    const data = await response.json();
    console.log("[Telegram] Set webhook result:", data);

    // Set bot commands so users see them when typing /
    await setBotCommands();

    return data.ok;
  } catch (error) {
    console.error("[Telegram] Error setting webhook:", error);
    return false;
  }
}

export async function setBotCommands(): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  const commands = [
    { command: "start", description: "Link your Telegram to Arena" },
    { command: "balance", description: "View your wallet balance" },
    { command: "portfolio", description: "View holdings and recent trades" },
    { command: "sell", description: "Sell a stock position" },
    { command: "trades", description: "View your recent trades" },
    { command: "amount", description: "Set your default buy amount, e.g. /amount 50" },
    { command: "mute", description: "Mute alerts for a ticker, e.g. /mute TSLA" },
    { command: "unmute", description: "Unmute a ticker, e.g. /unmute TSLA" },
    { command: "help", description: "Show available commands" },
  ];

  try {
    const response = await fetch(`${TELEGRAM_API_URL}/bot${botToken}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands }),
    });

    const data = await response.json();
    console.log("[Telegram] Set bot commands result:", data);
    return data.ok;
  } catch (error) {
    console.error("[Telegram] Error setting bot commands:", error);
    return false;
  }
}
