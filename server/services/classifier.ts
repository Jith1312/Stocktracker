import OpenAI from "openai";
import { storage } from "../storage";
import { classificationResultSchema, type ClassificationResult } from "@shared/schema";

const AI_MODEL = process.env.CLASSIFIER_MODEL || "gpt-5.1";

// Minimum per-ticker confidence for a signal to become an alert event
export const MIN_ALERT_CONFIDENCE = parseFloat(process.env.MIN_ALERT_CONFIDENCE || "0.6");

let openaiClient: OpenAI | null | undefined;

function getOpenAI(): OpenAI | null {
  if (openaiClient !== undefined) return openaiClient;

  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL;

  if (!apiKey) {
    console.warn("[Classifier] No OpenAI API key configured — falling back to regex ticker matching");
    openaiClient = null;
  } else {
    openaiClient = new OpenAI({ apiKey, baseURL });
  }
  return openaiClient;
}

export function getClassifierModel(): string {
  return getOpenAI() ? AI_MODEL : "regex-fallback";
}

const SYSTEM_PROMPT = `You are a trading-signal analyst. You read a single post from a financial influencer on X (Twitter) and decide whether it contains an actionable trading signal for any of the supported stock tickers.

Rules:
- Only report tickers from the supported list. Match cashtags ($TSLA), bare tickers (TSLA), and company names (Tesla → TSLA).
- sentiment: BULLISH if the author expresses a positive view on the stock, BEARISH for a negative view, NEUTRAL for a mere mention with no directional view.
- action: BUY when the author expresses clear directional conviction to be long — an explicit recommendation, an announcement that they bought or are buying, or a strongly bullish call such as a price target, "loading up", "this goes much higher", or bullish setups they say they're taking. SELL for the bearish equivalent: selling, exiting, shorting, "get out", downside targets. Traders rarely use the literal words "buy" or "sell" — translate their intent. NONE only for neutral commentary, news reposts without a view, questions, or recaps of past trades with no forward-looking view.
- is_actionable: true only if at least one ticker has action BUY or SELL.
- confidence (0-1): how explicit and serious the call is. 0.9+: explicit recommendation or announced entry. 0.7-0.85: strong directional conviction without an explicit entry. 0.5-0.65: directional lean but hedged or conditional. Sarcasm, jokes, hypotheticals, questions, engagement bait, and old-news commentary should sharply reduce confidence or result in action NONE.
- Ignore giveaways, spam, promotions of courses/newsletters, and pure price observations with no view.
- reason: one concise sentence explaining the decision.

Respond with JSON matching the provided schema.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    is_actionable: { type: "boolean" },
    tickers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          sentiment: { type: "string", enum: ["BULLISH", "BEARISH", "NEUTRAL"] },
          action: { type: "string", enum: ["BUY", "SELL", "NONE"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["symbol", "sentiment", "action", "confidence"],
        additionalProperties: false,
      },
    },
    overall_confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string" },
  },
  required: ["is_actionable", "tickers", "overall_confidence", "reason"],
  additionalProperties: false,
} as const;

export async function classifyTweet(tweetText: string): Promise<ClassificationResult> {
  const assets = await storage.getAssetRegistry();
  const supportedTickers = assets
    .filter(a => a.isActive)
    .map(a => a.underlyingTicker.toUpperCase());

  if (supportedTickers.length === 0) {
    return {
      is_actionable: false,
      tickers: [],
      overall_confidence: 0,
      reason: "No supported tickers in asset registry",
    };
  }

  const openai = getOpenAI();
  if (!openai) {
    return regexFallback(tweetText, supportedTickers);
  }

  try {
    const response = await openai.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Supported tickers: ${supportedTickers.join(", ")}\n\nPost:\n"""\n${tweetText}\n"""`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "classification_result",
          strict: true,
          schema: RESPONSE_SCHEMA as any,
        },
      },
      max_completion_tokens: 2048,
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty response from model");

    const parsed = classificationResultSchema.parse(JSON.parse(raw));

    // The model must not invent tickers outside the registry
    const supported = new Set(supportedTickers);
    const tickers = parsed.tickers.filter(t => supported.has(t.symbol.toUpperCase()))
      .map(t => ({ ...t, symbol: t.symbol.toUpperCase() }));

    const isActionable = tickers.some(t => t.action !== "NONE");

    return {
      ...parsed,
      tickers,
      is_actionable: isActionable,
    };
  } catch (error) {
    console.error("[Classifier] AI classification failed, using regex fallback:", error);
    return regexFallback(tweetText, supportedTickers);
  }
}

// Cashtag matching used when no AI key is configured or the AI call fails.
// Mentions found this way are never actionable — they carry no directional signal.
function regexFallback(tweetText: string, supportedTickers: string[]): ClassificationResult {
  const tickerPattern = /\$([A-Z]{1,5})\b/g;
  const supported = new Set(supportedTickers);
  const found = Array.from(new Set(
    Array.from(tweetText.matchAll(tickerPattern))
      .map(m => m[1].toUpperCase())
      .filter(t => supported.has(t))
  ));

  if (found.length === 0) {
    return {
      is_actionable: false,
      tickers: [],
      overall_confidence: 0,
      reason: "No supported tickers found",
    };
  }

  return {
    is_actionable: false,
    tickers: found.map(ticker => ({
      symbol: ticker,
      sentiment: "NEUTRAL" as const,
      action: "NONE" as const,
      confidence: 0.3,
    })),
    overall_confidence: 0.3,
    reason: `Ticker mention detected without AI analysis: ${found.join(", ")}`,
  };
}

// Tickers from a classification that deserve an alert. With AI enabled, only
// directional signals above the confidence threshold alert; in regex-fallback
// mode every supported-ticker mention alerts (better than silence).
export function getAlertableTickers(result: ClassificationResult): ClassificationResult["tickers"] {
  const signals = result.tickers.filter(
    t => t.action !== "NONE" && t.confidence >= MIN_ALERT_CONFIDENCE
  );
  if (signals.length > 0) return signals;
  if (!getOpenAI()) return result.tickers;
  return [];
}

export async function shouldCreateAlert(result: ClassificationResult): Promise<boolean> {
  return getAlertableTickers(result).length > 0;
}
