import * as jupiter from "./jupiter";
import { storage } from "../storage";

const USDC_MINT = process.env.USDC_MINT || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;
const PROBE_USD = 10;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedPrice {
  priceUsd: number;
  fetchedAt: number;
}

const cache = new Map<string, CachedPrice>();

// Price of one whole token in USD, derived from a $10 USDC → token Jupiter
// quote. Returns null when no route exists or the quote fails.
export async function getTokenPriceUsd(mint: string, decimals: number): Promise<number | null> {
  const cached = cache.get(mint);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.priceUsd;
  }

  try {
    const amountRaw = (PROBE_USD * 10 ** USDC_DECIMALS).toString();
    const order = await jupiter.getUltraOrder(USDC_MINT, mint, amountRaw);
    const tokensOut = parseInt(order.outAmount) / 10 ** decimals;
    if (!tokensOut || tokensOut <= 0) return null;

    const priceUsd = PROBE_USD / tokensOut;
    cache.set(mint, { priceUsd, fetchedAt: Date.now() });
    return priceUsd;
  } catch (error) {
    console.error(`[Prices] Failed to fetch price for ${mint}:`, error);
    return null;
  }
}

export async function getTickerPriceUsd(ticker: string): Promise<number | null> {
  const asset = await storage.getAssetByTicker(ticker);
  if (!asset) return null;
  return getTokenPriceUsd(asset.solanaMint, asset.decimals);
}

// Batch helper: unique tickers → prices, sharing the cache.
export async function getTickerPrices(tickers: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  for (const ticker of Array.from(new Set(tickers))) {
    const price = await getTickerPriceUsd(ticker);
    if (price != null) prices.set(ticker, price);
  }
  return prices;
}
