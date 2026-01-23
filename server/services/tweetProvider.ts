export interface TweetData {
  tweetId: string;
  text: string;
  url: string;
  createdAt: Date;
  rawJson?: any;
}

export interface TweetProvider {
  fetchTweets(handle: string, sinceId?: string): Promise<TweetData[]>;
  getUserInfo(handle: string): Promise<{ userId?: string; displayName?: string; avatarUrl?: string } | null>;
}

export class StubTweetProvider implements TweetProvider {
  async fetchTweets(handle: string, sinceId?: string): Promise<TweetData[]> {
    console.log(`[StubTweetProvider] Would fetch tweets for @${handle} since ${sinceId || "beginning"}`);
    return [];
  }

  async getUserInfo(handle: string): Promise<{ userId?: string; displayName?: string; avatarUrl?: string } | null> {
    console.log(`[StubTweetProvider] Would fetch user info for @${handle}`);
    return {
      userId: handle,
      displayName: handle,
      avatarUrl: undefined,
    };
  }
}

export class TwitterApiIoProvider implements TweetProvider {
  private apiKey: string;
  private baseUrl = "https://api.twitterapi.io";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async fetchTweets(handle: string, sinceId?: string): Promise<TweetData[]> {
    try {
      const url = `${this.baseUrl}/twitter/user/last_tweets?userName=${encodeURIComponent(handle)}`;
      
      const response = await fetch(url, {
        headers: {
          "X-API-Key": this.apiKey,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[TwitterApiIo] API error ${response.status}: ${errorText}`);
        return [];
      }

      const data = await response.json();
      
      if (data.status !== "success" || !data.tweets) {
        console.log(`[TwitterApiIo] No tweets found for @${handle}: ${data.message || "empty"}`);
        return [];
      }

      const tweets = data.tweets
        .filter((tweet: any) => {
          if (!sinceId) return true;
          return tweet.id > sinceId;
        })
        .map((tweet: any) => ({
          tweetId: tweet.id,
          text: tweet.text,
          url: tweet.url || `https://x.com/${handle}/status/${tweet.id}`,
          createdAt: new Date(tweet.createdAt),
          rawJson: tweet,
        }));

      console.log(`[TwitterApiIo] Fetched ${tweets.length} tweets for @${handle}`);
      return tweets;
    } catch (error) {
      console.error(`[TwitterApiIo] Error fetching tweets:`, error);
      return [];
    }
  }

  async getUserInfo(handle: string): Promise<{ userId?: string; displayName?: string; avatarUrl?: string } | null> {
    try {
      const url = `${this.baseUrl}/twitter/user/info?userName=${encodeURIComponent(handle)}`;
      
      const response = await fetch(url, {
        headers: {
          "X-API-Key": this.apiKey,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[TwitterApiIo] User info error ${response.status}: ${errorText}`);
        return null;
      }

      const data = await response.json();
      
      if (data.status !== "success" || !data.data) {
        console.log(`[TwitterApiIo] User not found: @${handle}`);
        return null;
      }

      return {
        userId: data.data.id,
        displayName: data.data.name,
        avatarUrl: data.data.profilePicture,
      };
    } catch (error) {
      console.error(`[TwitterApiIo] Error fetching user info:`, error);
      return null;
    }
  }
}

export function createTweetProvider(): TweetProvider {
  const apiKey = process.env.X_API_BEARER_TOKEN;
  if (apiKey) {
    console.log("[TweetProvider] Using TwitterAPI.io");
    return new TwitterApiIoProvider(apiKey);
  }
  console.log("[TweetProvider] Using stub provider (no API key)");
  return new StubTweetProvider();
}

export const tweetProvider = createTweetProvider();
