import { PrivyClient as ServerAuthClient } from "@privy-io/server-auth";
import { Privy, isEmbeddedWalletLinkedAccount } from "@privy-io/node";
import crypto from "crypto";

const PRIVY_APP_ID = process.env.PRIVY_APP_ID!;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET!;
const PRIVY_AUTHORIZATION_KEY = process.env.PRIVY_AUTHORIZATION_KEY;

if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
  console.warn("[Privy] Missing PRIVY_APP_ID or PRIVY_APP_SECRET");
}

const serverAuthClient = new ServerAuthClient(PRIVY_APP_ID, PRIVY_APP_SECRET);

let privyNodeClient: Privy | null = null;

function getPrivyNodeClient(): Privy {
  if (!privyNodeClient) {
    const config: any = {
      appId: PRIVY_APP_ID,
      appSecret: PRIVY_APP_SECRET,
    };
    
    if (PRIVY_AUTHORIZATION_KEY) {
      config.authorizationPrivateKey = PRIVY_AUTHORIZATION_KEY;
      console.log("[Privy] Initialized with authorization key for delegated actions");
    }
    
    privyNodeClient = new Privy(config);
  }
  return privyNodeClient;
}

export async function verifyToken(token: string) {
  try {
    const claims = await serverAuthClient.verifyAuthToken(token);
    return claims;
  } catch (error) {
    console.error("[Privy] Token verification failed:", error);
    return null;
  }
}

export async function getUser(privyDid: string) {
  try {
    const user = await serverAuthClient.getUser(privyDid);
    return user;
  } catch (error) {
    console.error("[Privy] Failed to get user:", error);
    return null;
  }
}

export async function getUserWithNode(privyDid: string) {
  try {
    const privy = getPrivyNodeClient();
    const user = await privy.users().get({ idType: "did", id: privyDid });
    return user;
  } catch (error) {
    console.error("[Privy] Failed to get user with node client:", error);
    return null;
  }
}

export async function getEmbeddedWalletId(privyDid: string): Promise<string | null> {
  try {
    const privy = getPrivyNodeClient();
    const user = await privy.users().get({ idType: "did", id: privyDid });
    
    if (!user) return null;
    
    const embeddedWallet = user.linked_accounts.find(isEmbeddedWalletLinkedAccount);
    return embeddedWallet?.id || null;
  } catch (error) {
    console.error("[Privy] Failed to get embedded wallet ID:", error);
    return null;
  }
}

export async function signAndSendSolanaTransaction(
  walletId: string,
  transactionBase64: string
): Promise<{ signature: string } | { error: string }> {
  try {
    if (!PRIVY_AUTHORIZATION_KEY) {
      return { error: "Server-side signing not configured. Missing authorization key." };
    }
    
    const privy = getPrivyNodeClient();
    
    const result = await privy.wallets().solana().signAndSendTransaction(walletId, {
      caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      params: {
        transaction: transactionBase64,
      },
    });
    
    console.log("[Privy] Transaction sent successfully:", result);
    return { signature: result.hash };
  } catch (error: any) {
    console.error("[Privy] Failed to sign and send transaction:", error);
    return { error: error.message || "Failed to execute transaction" };
  }
}

export async function signSolanaTransaction(
  walletId: string,
  transactionBase64: string
): Promise<{ signedTransaction: string } | { error: string }> {
  try {
    if (!PRIVY_AUTHORIZATION_KEY) {
      return { error: "Server-side signing not configured. Missing authorization key." };
    }
    
    const privy = getPrivyNodeClient();
    
    const result = await privy.wallets().solana().signTransaction(walletId, {
      caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      params: {
        transaction: transactionBase64,
      },
    });
    
    return { signedTransaction: result.signedTransaction };
  } catch (error: any) {
    console.error("[Privy] Failed to sign transaction:", error);
    return { error: error.message || "Failed to sign transaction" };
  }
}

export function isAuthorizationKeyConfigured(): boolean {
  return !!PRIVY_AUTHORIZATION_KEY;
}

export function getKeyQuorumId(): string | null {
  return process.env.PRIVY_KEY_QUORUM_ID || null;
}

export { serverAuthClient, getPrivyNodeClient };
