import OpenAI from "openai";
import { z } from "zod";
import { classificationResultSchema, type ClassificationResult } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const SYSTEM_PROMPT = `You are a financial tweet classifier. Your job is to analyze tweets from influencers and identify actionable stock trading signals.

For each tweet, determine:
1. Whether it contains an actionable trading signal (buy/sell recommendation)
2. Which stock tickers are mentioned
3. The sentiment (BULLISH or BEARISH) for each ticker
4. The recommended action (BUY, SELL, or NONE) for each ticker
5. Your confidence level (0-1) for each classification
6. Your overall confidence in the actionability of the tweet

IMPORTANT RULES:
- Only mark as actionable if the tweet clearly suggests a specific trading action
- Ignore general market commentary without specific stock recommendations
- Tickers should be in uppercase (e.g., TSLA, AAPL, AMZN)
- Be conservative - only high-confidence signals should be marked actionable
- Look for phrases like "buying", "loading up", "selling", "getting out", "bullish on", "bearish on"

Output STRICT JSON matching this schema:
{
  "is_actionable": boolean,
  "tickers": [{"symbol":"TSLA","sentiment":"BULLISH|BEARISH","action":"BUY|SELL|NONE","confidence":0.0-1.0}],
  "overall_confidence": 0.0-1.0,
  "reason": "short explanation"
}`;

export async function classifyTweet(tweetText: string): Promise<ClassificationResult> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.1",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Analyze this tweet for trading signals:\n\n"${tweetText}"` },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 512,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return getDefaultResult("No response from classifier");
    }

    const parsed = JSON.parse(content);
    const validated = classificationResultSchema.parse(parsed);
    return validated;
  } catch (error) {
    console.error("[Classifier] Error classifying tweet:", error);
    return getDefaultResult("Classification error");
  }
}

function getDefaultResult(reason: string): ClassificationResult {
  return {
    is_actionable: false,
    tickers: [],
    overall_confidence: 0,
    reason,
  };
}

export async function shouldCreateAlert(result: ClassificationResult): Promise<boolean> {
  if (!result.is_actionable) return false;
  if (result.overall_confidence < 0.75) return false;
  
  const hasActionableTicker = result.tickers.some(
    t => t.action === "BUY" || t.action === "SELL"
  );
  
  return hasActionableTicker;
}
