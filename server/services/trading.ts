import { Connection, PublicKey } from "@solana/web3.js";
import { storage } from "../storage";
import * as jupiter from "./jupiter";
import * as privyService from "./privy";
import type { AssetRegistryEntry, User } from "@shared/schema";

export const USDC_MINT = process.env.USDC_MINT || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function getRpcUrl(): string {
  if (process.env.HELIUS_API_KEY) {
    return `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
  }
  return process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
}

export const connection = new Connection(getRpcUrl());

/**
 * Translate raw Jupiter/Privy/RPC errors into something a trader can act on.
 * Raw errors like "custom program error: 0x1" are useless in a Telegram chat.
 */
export function friendlyTradeError(raw: unknown): string {
  const msg = (raw instanceof Error ? raw.message : String(raw ?? "")).toLowerCase();

  if (msg.includes("insufficient") || msg.includes("0x1 ") || msg.endsWith("0x1") || msg.includes("not enough")) {
    return "Not enough USDC in your wallet to cover this trade. Add funds and try again.";
  }
  if (msg.includes("slippage") || msg.includes("0x1771")) {
    return "Price moved too much while executing. Try again to get a fresh quote.";
  }
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("abort")) {
    return "The network took too long to respond. Try again in a moment.";
  }
  if (msg.includes("no transaction in quote") || msg.includes("market may be unavailable") || msg.includes("no route")) {
    return "No market available for this stock right now. Markets for tokenized stocks can pause outside trading hours.";
  }
  if (msg.includes("rate limit") || msg.includes("429")) {
    return "Too many requests right now. Wait a few seconds and try again.";
  }
  return raw instanceof Error && raw.message ? raw.message : "Something went wrong executing the trade.";
}

export interface SwapResult {
  signature: string;
  /** Raw output amount in output-token base units, when Jupiter reports it */
  outputAmountRaw: string | null;
}

/**
 * Quote → server-side sign → execute, retrying with a fresh quote on failure.
 * Requires the user to have one-tap trading enabled (privyWalletId set).
 */
export async function executeSwapWithRetry(
  user: User,
  inputMint: string,
  outputMint: string,
  amountRaw: string,
  maxAttempts: number = 3
): Promise<SwapResult> {
  if (!user.solanaPubkey || !user.privyWalletId) {
    throw new Error("Wallet not configured for one-tap trading");
  }

  let lastError = "Trade execution failed";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const quote = await jupiter.getQuote(inputMint, outputMint, amountRaw, user.solanaPubkey);
      if (!quote.transaction || !quote.requestId) {
        throw new Error("No transaction in quote");
      }

      const signResult = await privyService.signSolanaTransaction(user.privyWalletId, quote.transaction);
      if ("error" in signResult) {
        throw new Error(signResult.error);
      }

      const executeResult = await jupiter.executeUltraOrder(quote.requestId, signResult.signedTransaction, 1);
      if (executeResult.status === "Success" || executeResult.signature) {
        return {
          signature: executeResult.signature || "",
          outputAmountRaw: (executeResult as any).outputAmountResult || executeResult.outputAmount || null,
        };
      }

      lastError = executeResult.error || "Trade execution failed";
    } catch (err: any) {
      lastError = err.message || "Unknown error";
    }

    console.log(`[Trading] Attempt ${attempt}/${maxAttempts} failed: ${lastError}`);
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }

  throw new Error(lastError);
}

export interface BuyResult {
  signature: string;
  amountUsd: number;
  /** Human-readable amount of stock tokens received, when known */
  tokensReceived: string | null;
}

/** Buy a tokenized stock with USDC server-side and record the trade. */
export async function buyAsset(
  user: User,
  asset: AssetRegistryEntry,
  amountUsd: number,
  userAlertId: number | null = null
): Promise<BuyResult> {
  const amountRaw = jupiter.usdToRawAmount(amountUsd);
  const result = await executeSwapWithRetry(user, USDC_MINT, asset.solanaMint, amountRaw);

  await storage.createTrade({
    userId: user.id,
    userAlertId,
    preparedOrderId: null,
    txSig: result.signature,
    inputMint: USDC_MINT,
    outputMint: asset.solanaMint,
    amountIn: amountRaw,
    amountOut: result.outputAmountRaw,
    status: "COMPLETED",
  });

  if (userAlertId) {
    await storage.updateUserAlert(userAlertId, { status: "EXECUTED" });
  }

  const decimals = asset.decimals || 9;
  const tokensReceived = result.outputAmountRaw
    ? (parseFloat(result.outputAmountRaw) / Math.pow(10, decimals)).toFixed(4)
    : null;

  return { signature: result.signature, amountUsd, tokensReceived };
}

export interface SellQuote {
  balanceRaw: string;
  balanceDisplay: string;
  estimatedUsdc: string;
  priceImpactPct: string;
}

/** Preview what selling the user's entire position would return, without executing. */
export async function getSellQuote(user: User, asset: AssetRegistryEntry): Promise<SellQuote | null> {
  if (!user.solanaPubkey) return null;

  const balance = await jupiter.getTokenBalance(connection, user.solanaPubkey, asset.solanaMint);
  if (balance.balance === "0") return null;

  const quote = await jupiter.getQuote(asset.solanaMint, USDC_MINT, balance.balance, user.solanaPubkey);
  const balanceDisplay = (parseFloat(balance.balance) / Math.pow(10, balance.decimals)).toFixed(4);
  const estimatedUsdc = (parseFloat(quote.outAmount) / 1_000_000).toFixed(2);

  return {
    balanceRaw: balance.balance,
    balanceDisplay,
    estimatedUsdc,
    priceImpactPct: quote.priceImpactPct,
  };
}

export interface SellResult {
  signature: string;
  tokensSold: string;
  usdcReceived: string;
}

/** Sell the user's entire position in a stock back to USDC and record the trade. */
export async function sellEntirePosition(
  user: User,
  asset: AssetRegistryEntry,
  userAlertId: number | null = null
): Promise<SellResult> {
  if (!user.solanaPubkey) {
    throw new Error("Wallet not configured");
  }

  const balance = await jupiter.getTokenBalance(connection, user.solanaPubkey, asset.solanaMint);
  if (balance.balance === "0") {
    throw new Error(`You don't hold any ${asset.underlyingTicker}`);
  }

  const result = await executeSwapWithRetry(user, asset.solanaMint, USDC_MINT, balance.balance);

  await storage.createTrade({
    userId: user.id,
    userAlertId,
    preparedOrderId: null,
    txSig: result.signature,
    inputMint: asset.solanaMint,
    outputMint: USDC_MINT,
    amountIn: balance.balance,
    amountOut: result.outputAmountRaw,
    status: "COMPLETED",
  });

  if (userAlertId) {
    await storage.updateUserAlert(userAlertId, { status: "EXECUTED" });
  }

  const tokensSold = (parseFloat(balance.balance) / Math.pow(10, balance.decimals)).toFixed(4);
  const usdcReceived = result.outputAmountRaw
    ? (parseFloat(result.outputAmountRaw) / 1_000_000).toFixed(2)
    : "?";

  return { signature: result.signature, tokensSold, usdcReceived };
}

export interface StockHolding {
  ticker: string;
  balance: string;
  balanceNum: number;
  mint: string;
  asset: AssetRegistryEntry;
}

/** All tokenized-stock positions a wallet holds (checks both Token and Token-2022 programs). */
export async function getStockHoldings(solanaPubkey: string): Promise<StockHolding[]> {
  const pubkey = new PublicKey(solanaPubkey);
  const assets = await storage.getAssetRegistry();
  const assetsByMint = new Map(assets.map((a) => [a.solanaMint, a]));
  const holdings: StockHolding[] = [];

  const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

  const processAccounts = (accounts: any[]) => {
    for (const { account } of accounts) {
      const info = account.data.parsed.info;
      const asset = assetsByMint.get(info.mint);
      const amount = parseFloat(info.tokenAmount.uiAmountString);

      if (asset && asset.underlyingTicker !== "USDC" && amount > 0) {
        holdings.push({
          ticker: asset.underlyingTicker,
          balance: amount.toFixed(4),
          balanceNum: amount,
          mint: info.mint,
          asset,
        });
      }
    }
  };

  for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    try {
      const accounts = await connection.getParsedTokenAccountsByOwner(pubkey, { programId });
      processAccounts(accounts.value);
    } catch (e) {
      console.error(`[Trading] Error fetching token accounts for program ${programId.toBase58()}:`, e);
    }
  }

  return holdings;
}

/**
 * Current USD price of one share (sell-side quote), for showing context in alerts.
 * Returns null on any failure — price is nice-to-have, never blocking.
 */
export async function getAssetPriceUsd(asset: AssetRegistryEntry): Promise<number | null> {
  try {
    const decimals = asset.decimals || 9;
    const oneToken = Math.pow(10, decimals).toString();
    const quote = await jupiter.getQuote(asset.solanaMint, USDC_MINT, oneToken);
    const price = parseFloat(quote.outAmount) / 1_000_000;
    return price > 0 ? price : null;
  } catch {
    return null;
  }
}
