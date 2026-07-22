import { storage } from "../storage";

/*
  Push-based tweet delivery via twitterapi.io tweet-filter rules.

  Instead of polling last_tweets (billed ~20 tweets per call whether or not
  anything is new), we maintain filter rules like "from:trader1 OR from:trader2"
  on twitterapi.io. Matched tweets are billed individually ($0.15/1k) and
  pushed to POST /api/twitter/webhook in near real time.

  Rule values are capped at 255 chars, so handles are chunked across as many
  rules as needed, tagged arena-traders-0, arena-traders-1, ...

  Note: the webhook URL itself can only be set on the twitterapi.io dashboard
  (their rule API has no webhook_url field). Set it once per rule to:
  https://<your-domain>/api/twitter/webhook
*/

const API_BASE = "https://api.twitterapi.io";
const RULE_TAG_PREFIX = "arena-traders-";
const MAX_RULE_VALUE_LENGTH = 255;
// How often twitterapi.io evaluates the rule (min 100s). Latency, not cost:
// billing is per matched tweet.
const RULE_INTERVAL_SECONDS = Math.max(100, parseInt(process.env.TWITTER_RULE_INTERVAL_SECONDS || "120"));

interface FilterRule {
  rule_id: string;
  tag: string;
  value: string;
  interval_seconds: number;
}

function getApiKey(): string | null {
  return process.env.X_API_BEARER_TOKEN || null;
}

async function api(path: string, method: string, body?: unknown): Promise<any> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("No twitterapi.io API key configured");

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "X-API-Key": apiKey,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();
  if (data.status === "error") {
    throw new Error(`twitterapi.io ${path}: ${data.msg || data.message || "unknown error"}`);
  }
  return data;
}

// Pack handles into as few "from:a OR from:b" rule values as fit in 255 chars.
export function buildRuleValues(handles: string[]): string[] {
  const values: string[] = [];
  let current = "";
  for (const handle of handles) {
    const clause = `from:${handle}`;
    const candidate = current ? `${current} OR ${clause}` : clause;
    if (candidate.length > MAX_RULE_VALUE_LENGTH && current) {
      values.push(current);
      current = clause;
    } else {
      current = candidate;
    }
  }
  if (current) values.push(current);
  return values;
}

let syncInFlight: Promise<void> | null = null;

// Reconcile twitterapi.io filter rules with the influencers users actually
// subscribe to. Safe to call often; concurrent calls coalesce.
export async function syncFilterRules(): Promise<void> {
  if (!getApiKey()) return;
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    try {
      const influencers = await storage.getInfluencersWithActiveSubscribers();
      const handles = Array.from(new Set(influencers.map(i => i.handle))).sort();
      const desired = buildRuleValues(handles);

      const existing: FilterRule[] = ((await api("/oapi/tweet_filter/get_rules", "GET")).rules || [])
        .filter((r: FilterRule) => r.tag?.startsWith(RULE_TAG_PREFIX));

      // Update or create rule i for each desired chunk
      for (let i = 0; i < desired.length; i++) {
        const tag = `${RULE_TAG_PREFIX}${i}`;
        const match = existing.find(r => r.tag === tag);
        if (match) {
          if (match.value !== desired[i] || match.interval_seconds !== RULE_INTERVAL_SECONDS) {
            await api("/oapi/tweet_filter/update_rule", "POST", {
              rule_id: match.rule_id,
              tag,
              value: desired[i],
              interval_seconds: RULE_INTERVAL_SECONDS,
              is_effect: 1,
            });
            console.log(`[FilterRules] Updated ${tag}: ${desired[i]}`);
          }
        } else {
          const added = await api("/oapi/tweet_filter/add_rule", "POST", {
            tag,
            value: desired[i],
            interval_seconds: RULE_INTERVAL_SECONDS,
          });
          // Rules are created inactive; activate explicitly
          await api("/oapi/tweet_filter/update_rule", "POST", {
            rule_id: added.rule_id,
            tag,
            value: desired[i],
            interval_seconds: RULE_INTERVAL_SECONDS,
            is_effect: 1,
          });
          console.log(`[FilterRules] Created ${tag}: ${desired[i]} (set its webhook URL on the twitterapi.io dashboard!)`);
        }
      }

      // Delete surplus rules beyond what we need
      for (const rule of existing) {
        const index = parseInt(rule.tag.slice(RULE_TAG_PREFIX.length));
        if (isNaN(index) || index >= desired.length) {
          await api("/oapi/tweet_filter/delete_rule", "DELETE", { rule_id: rule.rule_id });
          console.log(`[FilterRules] Deleted surplus rule ${rule.tag}`);
        }
      }

      console.log(`[FilterRules] Synced: ${handles.length} handle(s) across ${desired.length} rule(s)`);
    } catch (error) {
      console.error("[FilterRules] Sync failed:", error);
    } finally {
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}
