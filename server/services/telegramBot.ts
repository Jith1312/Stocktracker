import { PublicKey } from "@solana/web3.js";
import { storage } from "../storage";
import * as telegram from "./telegram";
import * as trading from "./trading";
import * as privyService from "./privy";
import type { User } from "@shared/schema";

function getAppUrl(): string {
  const domain =
    process.env.APP_DOMAIN ||
    process.env.REPLIT_DEPLOYMENT_DOMAIN ||
    process.env.REPLIT_DEV_DOMAIN ||
    "localhost:5000";
  return domain.includes("localhost") ? `http://${domain}` : `https://${domain}`;
}

const HELP_TEXT = `📊 <b>Arena Bot Commands</b>

/balance — Wallet balance (SOL, USDC, stocks)
/portfolio — Holdings and recent trades
/trades — Recent trade history
/sell — Sell a stock position (with preview)
/amount 50 — Set your default buy amount
/mute TSLA — Stop alerts for a ticker
/unmute TSLA — Resume alerts for a ticker
/help — Show this message

💡 When an influencer you follow mentions a stock, you'll get an alert here with one-tap Buy buttons.`;

async function requireLinkedUser(chatId: string): Promise<User | null> {
  const user = await storage.getUserByTelegramChatId(chatId);
  if (!user) {
    await telegram.sendMessage({
      chatId,
      text: "🔗 Your Telegram isn't linked to an Arena account yet.\n\nOpen the app, go to Dashboard, and tap <b>Connect Telegram</b>.",
      replyMarkup: {
        inline_keyboard: [[{ text: "📱 Open Arena", url: `${getAppUrl()}/dashboard` }]],
      },
    });
  }
  return user || null;
}

async function handleStart(message: any): Promise<void> {
  const chatId = message.chat.id.toString();
  const token = message.text.split(" ")[1];

  if (!token) {
    const existing = await storage.getUserByTelegramChatId(chatId);
    if (existing) {
      await telegram.sendMessage({
        chatId,
        text: `👋 You're all set — this chat is linked to your Arena account.\n\n${HELP_TEXT}`,
      });
    } else {
      await telegram.sendMessage({
        chatId,
        text: "👋 <b>Welcome to Arena!</b>\n\nGet an alert the moment an influencer you follow mentions a stock — and buy or sell it right here with one tap.\n\nTo link this chat to your account, open the app and tap <b>Connect Telegram</b>.",
        replyMarkup: {
          inline_keyboard: [[{ text: "📱 Open Arena", url: `${getAppUrl()}/dashboard` }]],
        },
      });
    }
    return;
  }

  const linkToken = await storage.getTelegramLinkToken(token);
  if (linkToken && !linkToken.used && new Date(linkToken.expiresAt) > new Date()) {
    await storage.updateUser(linkToken.userId, {
      telegramChatId: chatId,
      telegramUsername: message.from?.username,
    });
    await storage.markTelegramLinkTokenUsed(linkToken.id);

    await telegram.sendMessage({
      chatId,
      text: `✅ <b>Connected!</b> Trading alerts from your influencers will arrive in this chat.

Here's what you can do:
• Tap <b>Buy</b> on any alert to trade instantly
• /sell to exit a position anytime
• /amount 25 to change your default buy size

Type /help to see everything.`,
    });
  } else {
    await telegram.sendMessage({
      chatId,
      text: "❌ That link is invalid or expired (links last 10 minutes).\n\nOpen the app and tap <b>Connect Telegram</b> to get a fresh one.",
      replyMarkup: {
        inline_keyboard: [[{ text: "📱 Open Arena", url: `${getAppUrl()}/dashboard` }]],
      },
    });
  }
}

async function handleBalance(message: any, includeTrades: boolean): Promise<void> {
  const chatId = message.chat.id.toString();
  const user = await requireLinkedUser(chatId);
  if (!user) return;

  if (!user.solanaPubkey) {
    await telegram.sendMessage({
      chatId,
      text: "❌ No wallet found on your account. Open the app to finish setting up.",
      replyMarkup: {
        inline_keyboard: [[{ text: "📱 Open Arena", url: `${getAppUrl()}/dashboard` }]],
      },
    });
    return;
  }

  try {
    const pubkey = new PublicKey(user.solanaPubkey);

    const solBalance = await trading.connection.getBalance(pubkey);
    const solAmount = (solBalance / 1e9).toFixed(4);

    let usdcBalance = "0.00";
    try {
      const usdcMint = new PublicKey(trading.USDC_MINT);
      const tokenAccounts = await trading.connection.getParsedTokenAccountsByOwner(pubkey, { mint: usdcMint });
      if (tokenAccounts.value.length > 0) {
        const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
        usdcBalance = balance?.toFixed(2) || "0.00";
      }
    } catch (e) {
      console.error("[TelegramBot] Error fetching USDC balance:", e);
    }

    const holdings = await trading.getStockHoldings(user.solanaPubkey);

    let text = `💰 <b>Your Wallet</b>

💵 USDC: <b>$${usdcBalance}</b>
🟣 SOL: ${solAmount}`;

    if (holdings.length > 0) {
      text += `\n\n📊 <b>Stocks</b>`;
      for (const h of holdings) {
        text += `\n• ${h.ticker}: ${h.balance}`;
      }
    } else {
      text += `\n\n📊 No stock positions yet.`;
    }

    text += `\n\n📍 <code>${user.solanaPubkey.slice(0, 8)}…${user.solanaPubkey.slice(-6)}</code>`;

    if (includeTrades) {
      text += `\n\n${await formatRecentTrades(user, 5)}`;
    }

    await telegram.sendMessage({ chatId, text });
  } catch (error) {
    console.error("[TelegramBot] Balance fetch error:", error);
    await telegram.sendMessage({
      chatId,
      text: "❌ Couldn't fetch your balance right now. Try again in a moment.",
    });
  }
}

async function formatRecentTrades(user: User, limit: number): Promise<string> {
  const trades = await storage.getTradesByUser(user.id);
  const recentTrades = trades.slice(0, limit);

  if (recentTrades.length === 0) {
    return `📈 <b>Recent Trades</b>\nNo trades yet — tap Buy on your next alert!`;
  }

  const allAssets = await storage.getAssetRegistry();
  const assetByMint = new Map(allAssets.map((a) => [a.solanaMint, a]));

  let text = `📈 <b>Recent Trades</b>`;
  for (const trade of recentTrades) {
    const date = new Date(trade.createdAt!).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const inputAsset = assetByMint.get(trade.inputMint);
    const outputAsset = assetByMint.get(trade.outputMint);
    const isBuy = trade.inputMint === trading.USDC_MINT;

    const ticker = isBuy
      ? outputAsset?.underlyingTicker || "?"
      : inputAsset?.underlyingTicker || "?";
    const usd = isBuy
      ? (parseFloat(trade.amountIn || "0") / 1e6).toFixed(2)
      : trade.amountOut
        ? (parseFloat(trade.amountOut) / 1e6).toFixed(2)
        : "?";

    text += `\n${isBuy ? "🟢 Bought" : "🔴 Sold"} ${ticker} ${isBuy ? "for" : "→"} $${usd} (${date})`;
  }

  return text;
}

async function handleTrades(message: any): Promise<void> {
  const chatId = message.chat.id.toString();
  const user = await requireLinkedUser(chatId);
  if (!user) return;

  await telegram.sendMessage({ chatId, text: await formatRecentTrades(user, 10) });
}

async function handleAmount(message: any): Promise<void> {
  const chatId = message.chat.id.toString();
  const parts = message.text.split(" ");

  const user = await requireLinkedUser(chatId);
  if (!user) return;

  if (parts.length < 2) {
    const current = parseFloat(user.defaultBuyAmountUsd || "10");
    await telegram.sendMessage({
      chatId,
      text: `Your default buy amount is <b>$${current}</b>.\n\nTo change it: /amount 50`,
    });
    return;
  }

  const amount = parseFloat(parts[1]);
  if (isNaN(amount) || amount <= 0 || amount > 10000) {
    await telegram.sendMessage({
      chatId,
      text: "❌ Enter an amount between $1 and $10,000. Example: /amount 50",
    });
    return;
  }

  await storage.updateUser(user.id, { defaultBuyAmountUsd: amount.toString() });
  const rounded = Math.max(1, Math.round(amount));
  await telegram.sendMessage({
    chatId,
    text: `✅ Default buy amount set to <b>$${amount}</b>.\n\nNew alerts will show quick-buy buttons for $${rounded} and $${Math.max(rounded + 1, Math.round(rounded * 2.5))}.`,
  });
}

async function handleMute(message: any, mute: boolean): Promise<void> {
  const chatId = message.chat.id.toString();
  const user = await requireLinkedUser(chatId);
  if (!user) return;

  const ticker = message.text.split(" ")[1]?.toUpperCase().replace(/^\$/, "");
  const muted = await storage.getMutedTickers(user.id);

  if (!ticker) {
    const list = muted.length > 0
      ? `🔇 Muted tickers: <b>${muted.map((m) => m.ticker).join(", ")}</b>\n\nUse /unmute TICKER to resume alerts.`
      : "You haven't muted any tickers.\n\nTo mute one: /mute TSLA";
    await telegram.sendMessage({ chatId, text: list });
    return;
  }

  const alreadyMuted = muted.some((m) => m.ticker === ticker);

  if (mute) {
    if (alreadyMuted) {
      await telegram.sendMessage({ chatId, text: `🔇 $${ticker} is already muted.` });
      return;
    }
    await storage.muteTicker(user.id, ticker);
    await telegram.sendMessage({
      chatId,
      text: `🔇 Muted <b>$${ticker}</b> — you won't get alerts for it anymore.\n\nUndo anytime with /unmute ${ticker}`,
    });
  } else {
    if (!alreadyMuted) {
      await telegram.sendMessage({ chatId, text: `$${ticker} isn't muted.` });
      return;
    }
    await storage.unmuteTicker(user.id, ticker);
    await telegram.sendMessage({
      chatId,
      text: `🔔 Unmuted <b>$${ticker}</b> — alerts are back on.`,
    });
  }
}

// Send a sell preview with live quote and a confirm button. Selling an entire
// position is irreversible, so unlike alert quick-buys this always shows the
// expected proceeds before executing.
async function sendSellConfirmation(
  chatId: string,
  user: User,
  ticker: string,
  editMessageId?: number
): Promise<void> {
  const showError = async (text: string) => {
    if (editMessageId) {
      await telegram.editMessageText(chatId, editMessageId, text);
    } else {
      await telegram.sendMessage({ chatId, text });
    }
  };

  const asset = await storage.getAssetByTicker(ticker);
  if (!asset) {
    await showError(`❌ Unknown ticker: $${ticker}`);
    return;
  }

  try {
    const quote = await trading.getSellQuote(user, asset);
    if (!quote) {
      await showError(`You don't hold any $${ticker}. Nothing to sell.`);
      return;
    }

    const text = `🔴 <b>Sell ${quote.balanceDisplay} ${ticker}?</b>

You'll receive about <b>$${quote.estimatedUsdc} USDC</b>.

This sells your entire ${ticker} position.`;
    const replyMarkup = {
      inline_keyboard: [
        [
          { text: `✅ Sell for ~$${quote.estimatedUsdc}`, callback_data: `sell_confirm:${ticker}` },
          { text: "Cancel", callback_data: "sell_cancel" },
        ],
      ],
    };

    if (editMessageId) {
      await telegram.editMessageText(chatId, editMessageId, text, replyMarkup);
    } else {
      await telegram.sendMessage({ chatId, text, replyMarkup });
    }
  } catch (err: any) {
    console.error("[TelegramBot] Sell quote error:", err);
    await showError(`❌ Couldn't get a quote for $${ticker}: ${trading.friendlyTradeError(err)}`);
  }
}

async function handleSell(message: any): Promise<void> {
  const chatId = message.chat.id.toString();
  const ticker = message.text.split(" ")[1]?.toUpperCase().replace(/^\$/, "");

  const user = await requireLinkedUser(chatId);
  if (!user) return;

  if (!user.solanaPubkey || !user.privyWalletId) {
    await telegram.sendMessage({
      chatId,
      text: "⚙️ One-tap trading isn't set up yet. Enable it in the app first — it takes a few seconds.",
      replyMarkup: {
        inline_keyboard: [[{ text: "⚙️ Open Settings", url: `${getAppUrl()}/settings` }]],
      },
    });
    return;
  }

  if (ticker) {
    await sendSellConfirmation(chatId, user, ticker);
    return;
  }

  try {
    const holdings = await trading.getStockHoldings(user.solanaPubkey);

    if (holdings.length === 0) {
      await telegram.sendMessage({
        chatId,
        text: "📊 You don't hold any stocks right now.\n\nTap <b>Buy</b> on your next alert to open a position!",
      });
      return;
    }

    const buttons = holdings.map((h) => [
      { text: `${h.ticker} — ${h.balance}`, callback_data: `sell_stock:${h.ticker}` },
    ]);
    buttons.push([{ text: "Cancel", callback_data: "sell_cancel" }]);

    await telegram.sendMessage({
      chatId,
      text: "📉 <b>Which position do you want to sell?</b>\n\nYou'll see a price preview before anything is sold.",
      replyMarkup: { inline_keyboard: buttons },
    });
  } catch (err: any) {
    console.error("[TelegramBot] Error fetching holdings:", err);
    await telegram.sendMessage({
      chatId,
      text: "❌ Couldn't fetch your holdings. Try again in a moment.",
    });
  }
}

// Alert quick-trade buttons: trade:{userAlertId}:{amount|ALL}:{BUY|SELL}
async function handleTradeCallback(callback_query: any): Promise<void> {
  const parts = callback_query.data.split(":");
  const userAlertId = parseInt(parts[1]);
  const amount = parts[2];
  const tradeAction = parts[3] || "BUY";
  const chatId = callback_query.message.chat.id.toString();

  const userAlert = await storage.getUserAlert(userAlertId);
  if (!userAlert) {
    await telegram.answerCallbackQuery(callback_query.id, "This alert has expired.");
    return;
  }

  const alertEvent = await storage.getAlertEvent(userAlert.alertEventId);
  const user = await storage.getUser(userAlert.userId);
  if (!alertEvent || !user) {
    await telegram.answerCallbackQuery(callback_query.id, "This alert has expired.");
    return;
  }

  const ticker = alertEvent.ticker;
  const asset = await storage.getAssetByTicker(ticker);
  if (!asset || !user.solanaPubkey) {
    await telegram.answerCallbackQuery(callback_query.id, "This stock isn't tradable right now.");
    return;
  }

  const isSellAll = tradeAction === "SELL";
  const label = isSellAll ? `Selling your $${ticker} position…` : `Buying $${amount} of $${ticker}…`;
  await telegram.answerCallbackQuery(callback_query.id, label);

  const canAutoExecute =
    user.signerEnabled &&
    user.autoExecuteEnabled &&
    user.privyWalletId &&
    privyService.isAuthorizationKeyConfigured();

  if (!canAutoExecute) {
    // No server-side signing permission — hand off to the app to review & execute.
    await telegram.sendMessage({
      chatId,
      text: `⚙️ <b>One more step to trade with one tap</b>

To ${isSellAll ? `sell your $${ticker}` : `buy $${amount} of $${ticker}`}, finish in the app — or enable <b>one-tap trading</b> in Settings so future trades execute right here.`,
      replyMarkup: {
        inline_keyboard: [
          [{ text: "📱 Finish this trade in app", url: `${getAppUrl()}/trade/confirm?alertId=${userAlertId}${amount !== "ALL" ? `&amount=${amount}` : ""}` }],
          [{ text: "⚡ Enable one-tap trading", url: `${getAppUrl()}/settings` }],
        ],
      },
    });
    return;
  }

  // Post a separate status message so the original alert (and its buttons) stay usable.
  const status = await telegram.sendMessage({
    chatId,
    text: `⚡ ${label}`,
  });

  try {
    if (isSellAll) {
      const result = await trading.sellEntirePosition(user, asset, userAlertId);
      const text = `✅ <b>Sold ${result.tokensSold} ${ticker}</b> for <b>$${result.usdcReceived} USDC</b>

<a href="https://solscan.io/tx/${result.signature}">View transaction</a>`;
      if (status) {
        await telegram.editMessageText(chatId, status.message_id, text);
      } else {
        await telegram.sendMessage({ chatId, text });
      }
    } else {
      const amountUsd = parseFloat(amount);
      if (isNaN(amountUsd) || amountUsd <= 0) throw new Error("Invalid trade amount");

      const result = await trading.buyAsset(user, asset, amountUsd, userAlertId);
      const received = result.tokensReceived ? `<b>${result.tokensReceived} ${ticker}</b>` : `$${ticker}`;
      const text = `✅ <b>Bought ${received}</b> for $${amount}

<a href="https://solscan.io/tx/${result.signature}">View transaction</a> · /sell ${ticker} to exit anytime`;
      if (status) {
        await telegram.editMessageText(chatId, status.message_id, text);
      } else {
        await telegram.sendMessage({ chatId, text });
      }
    }
  } catch (error: any) {
    console.error("[TelegramBot] Trade error:", error);
    const friendly = trading.friendlyTradeError(error);
    const text = `❌ <b>${isSellAll ? "Sell" : "Buy"} failed</b> — ${friendly}`;
    const retryMarkup = {
      inline_keyboard: [[{ text: "🔄 Try again", callback_data: callback_query.data }]],
    };
    if (status) {
      await telegram.editMessageText(chatId, status.message_id, text, retryMarkup);
    } else {
      await telegram.sendMessage({ chatId, text, replyMarkup: retryMarkup });
    }
  }
}

async function handleSellConfirmCallback(callback_query: any): Promise<void> {
  const ticker = callback_query.data.split(":")[1];
  const chatId = callback_query.message.chat.id.toString();
  const messageId = callback_query.message.message_id;

  await telegram.answerCallbackQuery(callback_query.id, `Selling ${ticker}…`);

  const user = await storage.getUserByTelegramChatId(chatId);
  if (!user || !user.solanaPubkey || !user.privyWalletId) {
    await telegram.editMessageText(chatId, messageId, "❌ Wallet not set up. Open the app to finish setup.");
    return;
  }

  const asset = await storage.getAssetByTicker(ticker);
  if (!asset) {
    await telegram.editMessageText(chatId, messageId, `❌ Unknown ticker: $${ticker}`);
    return;
  }

  await telegram.editMessageText(chatId, messageId, `⚡ Selling your ${ticker} position…`);

  try {
    const result = await trading.sellEntirePosition(user, asset);
    await telegram.editMessageText(
      chatId,
      messageId,
      `✅ <b>Sold ${result.tokensSold} ${ticker}</b> for <b>$${result.usdcReceived} USDC</b>

<a href="https://solscan.io/tx/${result.signature}">View transaction</a>`
    );
  } catch (err: any) {
    console.error("[TelegramBot] Sell error:", err);
    await telegram.editMessageText(
      chatId,
      messageId,
      `❌ <b>Sell failed</b> — ${trading.friendlyTradeError(err)}`,
      { inline_keyboard: [[{ text: "🔄 Try again", callback_data: `sell_stock:${ticker}` }]] }
    );
  }
}

async function handleCallback(callback_query: any): Promise<void> {
  const data: string = callback_query.data || "";
  const chatId = callback_query.message.chat.id.toString();
  const messageId = callback_query.message.message_id;

  if (data.startsWith("trade:")) {
    await handleTradeCallback(callback_query);
    return;
  }

  if (data.startsWith("ignore:")) {
    const userAlertId = parseInt(data.split(":")[1]);
    if (!isNaN(userAlertId)) {
      await storage.updateUserAlert(userAlertId, { status: "IGNORED" });
    }
    // Keep the alert content readable, just retire its buttons.
    await telegram.editMessageReplyMarkup(chatId, messageId);
    await telegram.answerCallbackQuery(callback_query.id, "Alert dismissed");
    return;
  }

  if (data.startsWith("sell_stock:")) {
    const ticker = data.split(":")[1];
    await telegram.answerCallbackQuery(callback_query.id);
    const user = await storage.getUserByTelegramChatId(chatId);
    if (!user || !user.solanaPubkey || !user.privyWalletId) {
      await telegram.editMessageText(chatId, messageId, "❌ Wallet not set up. Open the app to finish setup.");
      return;
    }
    await sendSellConfirmation(chatId, user, ticker, messageId);
    return;
  }

  if (data.startsWith("sell_confirm:")) {
    await handleSellConfirmCallback(callback_query);
    return;
  }

  if (data === "sell_cancel") {
    await telegram.editMessageText(chatId, messageId, "Sell cancelled — your position is untouched.");
    await telegram.answerCallbackQuery(callback_query.id);
    return;
  }

  await telegram.answerCallbackQuery(callback_query.id);
}

async function handleMessage(message: any): Promise<void> {
  const text: string = message.text || "";
  const chatId = message.chat.id.toString();

  if (text.startsWith("/start")) {
    await handleStart(message);
  } else if (text === "/help") {
    await telegram.sendMessage({ chatId, text: HELP_TEXT });
  } else if (text === "/balance") {
    await handleBalance(message, false);
  } else if (text === "/portfolio") {
    await handleBalance(message, true);
  } else if (text === "/trades") {
    await handleTrades(message);
  } else if (text === "/sell" || text.startsWith("/sell ")) {
    await handleSell(message);
  } else if (text === "/amount" || text.startsWith("/amount ")) {
    await handleAmount(message);
  } else if (text === "/mute" || text.startsWith("/mute ")) {
    await handleMute(message, true);
  } else if (text === "/unmute" || text.startsWith("/unmute ")) {
    await handleMute(message, false);
  } else if (text.startsWith("/")) {
    await telegram.sendMessage({
      chatId,
      text: `I don't know that command. ${HELP_TEXT}`,
    });
  }
}

export async function handleTelegramUpdate(update: any): Promise<void> {
  const { message, callback_query } = update;

  console.log(
    "[TelegramBot] Update:",
    JSON.stringify({
      hasMessage: !!message,
      hasCallback: !!callback_query,
      messageText: message?.text?.slice(0, 50),
      callbackData: callback_query?.data,
    })
  );

  if (message?.text) {
    await handleMessage(message);
  }

  if (callback_query) {
    await handleCallback(callback_query);
  }
}
