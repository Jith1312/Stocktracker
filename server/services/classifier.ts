import { storage } from "../storage";
import type { ClassificationResult } from "@shared/schema";

export async function classifyTweet(tweetText: string): Promise<ClassificationResult> {
  try {
    const tickers = await detectTickers(tweetText);
    
    if (tickers.length === 0) {
      return {
        is_actionable: false,
        tickers: [],
        overall_confidence: 0,
        reason: "No Ondo-supported tickers found",
      };
    }

    return {
      is_actionable: true,
      tickers: tickers.map(ticker => ({
        ticker,
        symbol: ticker,
        sentiment: "NEUTRAL" as const,
        action: "NONE" as const,
        confidence: 1.0,
      })),
      overall_confidence: 1.0,
      reason: `Found ${tickers.length} Ondo-supported ticker(s): ${tickers.join(", ")}`,
    };
  } catch (error) {
    console.error("[Classifier] Error detecting tickers:", error);
    return {
      is_actionable: false,
      tickers: [],
      overall_confidence: 0,
      reason: "Classification error",
    };
  }
}

async function detectTickers(text: string): Promise<string[]> {
  const tickerPattern = /\$([A-Z]{1,5})\b/g;
  const matches = text.matchAll(tickerPattern);
  const foundTickers = [...matches].map(m => m[1]);
  
  const assets = await storage.getAssetRegistry();
  const ondoTickers = new Set(assets.map(a => a.underlyingTicker.toUpperCase()));
  
  const validTickers = foundTickers.filter(t => ondoTickers.has(t.toUpperCase()));
  
  return [...new Set(validTickers)];
}

export async function shouldCreateAlert(result: ClassificationResult): Promise<boolean> {
  return result.is_actionable && result.tickers.length > 0;
}
