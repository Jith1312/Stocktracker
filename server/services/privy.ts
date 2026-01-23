import { PrivyClient } from "@privy-io/server-auth";
import { VersionedTransaction } from "@solana/web3.js";
import crypto from "crypto";

const PRIVY_APP_ID = process.env.PRIVY_APP_ID!;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET!;
const PRIVY_AUTHORIZATION_KEY = process.env.PRIVY_AUTHORIZATION_KEY;

if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
  console.warn("[Privy] Missing PRIVY_APP_ID or PRIVY_APP_SECRET");
}

// Create server auth client with optional walletApi config for delegated actions
const serverAuthClientOptions: any = {};
if (PRIVY_AUTHORIZATION_KEY) {
  serverAuthClientOptions.walletApi = {
    authorizationPrivateKey: PRIVY_AUTHORIZATION_KEY,
  };
  console.log("[Privy] Initialized with authorization key for delegated actions");
}

const serverAuthClient = new PrivyClient(
  PRIVY_APP_ID, 
  PRIVY_APP_SECRET,
  serverAuthClientOptions
);

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


export async function getEmbeddedWalletId(privyDid: string): Promise<string | null> {
  try {
    // Use server-auth client which authenticates via app secret
    const user = await serverAuthClient.getUser(privyDid);
    
    if (!user) {
      console.log("[Privy] No user found for DID:", privyDid);
      return null;
    }
    
    // Log the user data structure for debugging
    console.log("[Privy] User linkedAccounts:", JSON.stringify(user.linkedAccounts, null, 2));
    
    const accounts = user.linkedAccounts || [];
    
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
  transactionBase64: string,
  privyDid?: string
): Promise<{ signature: string } | { error: string }> {
  try {
    if (!PRIVY_AUTHORIZATION_KEY) {
      return { error: "Server-side signing not configured. Missing authorization key." };
    }
    
    console.log("[Privy] Signing transaction for wallet ID:", walletId);
    
    // Debug: Check if wallet is delegated
    if (privyDid) {
      try {
        const user = await serverAuthClient.getUser(privyDid);
        const solanaWallet = user?.linkedAccounts?.find(
          (a: any) => a.type === "wallet" && a.walletClientType === "privy" && a.chainType === "solana"
        );
        console.log("[Privy] Solana wallet delegation status:", {
          walletId: (solanaWallet as any)?.id,
          address: (solanaWallet as any)?.address,
          delegated: (solanaWallet as any)?.delegated,
          chainType: (solanaWallet as any)?.chainType,
        });
      } catch (e) {
        console.log("[Privy] Could not fetch user for delegation check:", e);
      }
    }
    
    // Deserialize the base64 transaction to a VersionedTransaction
    const transactionBuffer = Buffer.from(transactionBase64, "base64");
    const transaction = VersionedTransaction.deserialize(transactionBuffer);
    
    // Use walletApi.solana.signAndSendTransaction with walletId and caip2
    // caip2 format: solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp (mainnet)
    const response = await serverAuthClient.walletApi.solana.signAndSendTransaction({
      walletId: walletId,
      caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", // Solana mainnet
      transaction: transaction,
    } as any);
    
    console.log("[Privy] Transaction sent successfully:", response);
    return { signature: response.hash };
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
    
    console.log("[Privy] Signing transaction for wallet ID:", walletId);
    
    // Deserialize the base64 transaction to a VersionedTransaction
    const transactionBuffer = Buffer.from(transactionBase64, "base64");
    const transaction = VersionedTransaction.deserialize(transactionBuffer);
    
    // Use walletApi.solana.signTransaction with walletId and caip2
    const response = await serverAuthClient.walletApi.solana.signTransaction({
      walletId: walletId,
      caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", // Solana mainnet
      transaction: transaction,
    } as any);
    
    // Serialize the signed transaction back to base64
    const signedTxBuffer = Buffer.from(response.signedTransaction.serialize());
    return { signedTransaction: signedTxBuffer.toString("base64") };
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

export { serverAuthClient };
