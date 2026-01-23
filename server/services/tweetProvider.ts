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

export class XApiTweetProvider implements TweetProvider {
  private bearerToken: string;

  constructor(bearerToken: string) {
    this.bearerToken = bearerToken;
  }

  async fetchTweets(handle: string, sinceId?: string): Promise<TweetData[]> {
    try {
      const userInfo = await this.getUserInfo(handle);
      if (!userInfo?.userId) {
        console.log(`[XApiTweetProvider] Could not find user: @${handle}`);
        return [];
      }

      let url = `https://api.twitter.com/2/users/${userInfo.userId}/tweets?max_results=10&tweet.fields=created_at`;
      if (sinceId) {
        url += `&since_id=${sinceId}`;
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.bearerToken}`,
        },
      });

      if (!response.ok) {
        console.error(`[XApiTweetProvider] API error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      if (!data.data) {
        return [];
      }

      return data.data.map((tweet: any) => ({
        tweetId: tweet.id,
        text: tweet.text,
        url: `https://x.com/${handle}/status/${tweet.id}`,
        createdAt: new Date(tweet.created_at),
        rawJson: tweet,
      }));
    } catch (error) {
      console.error(`[XApiTweetProvider] Error fetching tweets:`, error);
      return [];
    }
  }

  async getUserInfo(handle: string): Promise<{ userId?: string; displayName?: string; avatarUrl?: string } | null> {
    try {
      const response = await fetch(
        `https://api.twitter.com/2/users/by/username/${handle}?user.fields=profile_image_url,name`,
        {
          headers: {
            Authorization: `Bearer ${this.bearerToken}`,
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      if (!data.data) {
        return null;
      }

      return {
        userId: data.data.id,
        displayName: data.data.name,
        avatarUrl: data.data.profile_image_url,
      };
    } catch (error) {
      console.error(`[XApiTweetProvider] Error fetching user info:`, error);
      return null;
    }
  }
}

export function createTweetProvider(): TweetProvider {
  const bearerToken = process.env.X_API_BEARER_TOKEN;
  if (bearerToken) {
    console.log("[TweetProvider] Using X API with bearer token");
    return new XApiTweetProvider(bearerToken);
  }
  console.log("[TweetProvider] Using stub provider (no X API credentials)");
  return new StubTweetProvider();
}

export const tweetProvider = createTweetProvider();
