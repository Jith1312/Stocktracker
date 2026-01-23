import { PrivyClient as ServerAuthClient } from "@privy-io/server-auth";
import { PrivyClient, isEmbeddedWalletLinkedAccount } from "@privy-io/node";
import crypto from "crypto";

const PRIVY_APP_ID = process.env.PRIVY_APP_ID!;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET!;
const PRIVY_AUTHORIZATION_KEY = process.env.PRIVY_AUTHORIZATION_KEY;

if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
  console.warn("[Privy] Missing PRIVY_APP_ID or PRIVY_APP_SECRET");
}

const serverAuthClient = new ServerAuthClient(PRIVY_APP_ID, PRIVY_APP_SECRET);

let privyNodeClient: PrivyClient | null = null;

function getPrivyNodeClient(): PrivyClient {
  if (!privyNodeClient) {
    const config: any = {
      appId: PRIVY_APP_ID,
      appSecret: PRIVY_APP_SECRET,
    };
    
    if (PRIVY_AUTHORIZATION_KEY) {
      config.authorizationPrivateKey = PRIVY_AUTHORIZATION_KEY;
      console.log("[Privy] Initialized with authorization key for delegated actions");
    }
    
    privyNodeClient = new PrivyClient(config);
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
    // Use server-auth client which authenticates via app secret
    const user = await serverAuthClient.getUser(privyDid);
    
    if (!user) {
      console.log("[Privy] No user found for DID:", privyDid);
      return null;
    }
    
    // Log the user data structure for debugging
    console.log("[Privy] User linked_accounts:", JSON.stringify(user.linked_accounts || user.linkedAccounts, null, 2));
    
    // Try both property names (linked_accounts and linkedAccounts)
    const accounts = user.linked_accounts || (user as any).linkedAccounts || [];
    
    if (!accounts || accounts.length === 0) {
      console.log("[Privy] No linked accounts found for user");
      return null;
    }
    
    // Find the embedded Solana wallet - check various property name formats
    const embeddedWallet = accounts.find(
      (account: any) => {
        const isWallet = account.type === "wallet";
        const isPrivy = account.wallet_client_type === "privy" || account.walletClientType === "privy";
        const isSolana = account.chain_type === "solana" || account.chainType === "solana";
        return isWallet && isPrivy && isSolana;
      }
    );
    
    console.log("[Privy] Found embedded wallet:", embeddedWallet);
    
    // The wallet ID for Privy embedded wallets
    if (embeddedWallet && 'id' in embeddedWallet) {
      return (embeddedWallet as any).id;
    }
    
    // Fallback: try to get wallet ID from address
    if (embeddedWallet && 'address' in embeddedWallet) {
      return (embeddedWallet as any).address;
    }
    
    return null;
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
    
    // The SDK expects just the transaction string (base64 encoded)
    const result = await privy.wallets().solana().signAndSendTransaction(walletId, {
      transaction: transactionBase64,
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
    
    // The SDK expects just the transaction string (base64 encoded)
    const result = await privy.wallets().solana().signTransaction(walletId, {
      transaction: transactionBase64,
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
