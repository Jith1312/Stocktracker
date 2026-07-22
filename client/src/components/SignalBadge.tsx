import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, MessageCircle } from "lucide-react";

interface SignalBadgeProps {
  action?: string | null;
  confidence?: number | string | null;
  className?: string;
  size?: "sm" | "md";
}

// The one way signals are rendered across the app: BUY = emerald, SELL = red,
// anything else is a neutral "mention".
export function SignalBadge({ action, confidence, className, size = "md" }: SignalBadgeProps) {
  const conf = confidence != null ? Math.round(parseFloat(String(confidence)) * 100) : null;
  const isBuy = action === "BUY";
  const isSell = action === "SELL";

  const Icon = isBuy ? TrendingUp : isSell ? TrendingDown : MessageCircle;
  const label = isBuy ? "BUY" : isSell ? "SELL" : "MENTION";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border font-mono font-semibold tracking-wide",
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
        isBuy && "border-bull/30 bg-bull/10 text-bull",
        isSell && "border-bear/30 bg-bear/10 text-bear",
        !isBuy && !isSell && "border-border bg-muted/50 text-muted-foreground",
        className
      )}
    >
      <Icon className={size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3"} />
      {label}
      {conf != null && conf > 0 && (
        <span className={cn("opacity-70 font-normal", size === "sm" ? "ml-0.5" : "ml-1")}>
          {conf}%
        </span>
      )}
    </span>
  );
}

// Thin horizontal confidence meter, colored by direction.
export function ConfidenceMeter({ action, confidence, className }: SignalBadgeProps) {
  const conf = confidence != null ? Math.round(parseFloat(String(confidence)) * 100) : 0;
  const isSell = action === "SELL";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1 flex-1 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full", isSell ? "bg-bear" : "bg-bull")}
          style={{ width: `${conf}%` }}
        />
      </div>
      <span className="text-num text-xs text-muted-foreground">{conf}%</span>
    </div>
  );
}
