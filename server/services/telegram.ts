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
      }),
    });

    return response.ok;
  } catch (error) {
    console.error("[Telegram] Error editing message:", error);
    return false;
  }
}

export function formatAlertMessage(
  influencerHandle: string,
  ticker: string,
  action: string,
  confidence: number,
  tweetExcerpt: string,
  tweetUrl: string
): string {
  return `📢 <b>$${ticker} Mentioned!</b>

👤 From: @${influencerHandle}

"${tweetExcerpt.slice(0, 250)}${tweetExcerpt.length > 250 ? "..." : ""}"

<a href="${tweetUrl}">View Tweet</a>`;
}

export function createTradeButtons(
  userAlertId: number, 
  appUrl: string, 
  action: "BUY" | "SELL" = "BUY",
  defaultAmount: number = 10
): InlineKeyboardButton[][] {
  const amounts = [defaultAmount, defaultAmount * 2.5];
  
  return [
    [
      { text: `🟢 Buy $${amounts[0]}`, callback_data: `trade:${userAlertId}:${amounts[0]}:BUY` },
      { text: `🟢 Buy $${amounts[1]}`, callback_data: `trade:${userAlertId}:${amounts[1]}:BUY` },
    ],
    [
      { text: `🔴 Sell $${amounts[0]}`, callback_data: `trade:${userAlertId}:${amounts[0]}:SELL` },
      { text: `🔴 Sell $${amounts[1]}`, callback_data: `trade:${userAlertId}:${amounts[1]}:SELL` },
    ],
    [
      { text: "📱 Open App", url: `${appUrl}/trade/confirm?alertId=${userAlertId}` },
      { text: "❌ Ignore", callback_data: `ignore:${userAlertId}` },
    ],
  ];
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
    return data.ok;
  } catch (error) {
    console.error("[Telegram] Error setting webhook:", error);
    return false;
  }
}
