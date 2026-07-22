import { storage } from "../storage";
import * as prices from "./prices";

export interface InfluencerPerformance {
  signalCount: number;
  buyCount: number;
  sellCount: number;
  // Signals that have an entry price snapshot and a current price
  trackedCount: number;
  // Average per-signal return in percent (SELL calls score inverted)
  avgReturnPct: number | null;
  winRate: number | null;
  // P&L in USD of hypothetically putting $10 on every tracked call
  hypotheticalPnlUsd: number | null;
}

const HYPOTHETICAL_STAKE_USD = 10;

export async function computeInfluencerPerformance(influencerId: number): Promise<InfluencerPerformance> {
  const events = await storage.getAlertEventsByInfluencer(influencerId);
  const directional = events.filter(e => e.action === "BUY" || e.action === "SELL");

  const withEntry = directional.filter(e => e.priceUsdAtEvent != null);
  const priceMap = await prices.getTickerPrices(withEntry.map(e => e.ticker));

  const returns: number[] = [];
  for (const event of withEntry) {
    const entry = parseFloat(event.priceUsdAtEvent!);
    const current = priceMap.get(event.ticker);
    if (!entry || entry <= 0 || current == null) continue;

    const rawReturn = (current - entry) / entry;
    returns.push(event.action === "SELL" ? -rawReturn : rawReturn);
  }

  const tracked = returns.length;
  const avg = tracked > 0 ? returns.reduce((a, b) => a + b, 0) / tracked : null;
  const wins = returns.filter(r => r > 0).length;

  return {
    signalCount: directional.length,
    buyCount: directional.filter(e => e.action === "BUY").length,
    sellCount: directional.filter(e => e.action === "SELL").length,
    trackedCount: tracked,
    avgReturnPct: avg != null ? avg * 100 : null,
    winRate: tracked > 0 ? (wins / tracked) * 100 : null,
    hypotheticalPnlUsd: tracked > 0
      ? returns.reduce((a, b) => a + b * HYPOTHETICAL_STAKE_USD, 0)
      : null,
  };
}
