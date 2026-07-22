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
): Promise<{ signedTransaction: string } | { error: string; details?: unknown }> {
  try {
    if (!PRIVY_AUTHORIZATION_KEY) {
      return { error: "Server-side signing not configured. Missing authorization key." };
    }
    
    console.log("[Privy] Signing transaction for wallet ID:", walletId);
    console.log("[Privy] Transaction base64 length:", transactionBase64.length);
    
    // Deserialize the base64 transaction to a VersionedTransaction
    const transactionBuffer = Buffer.from(transactionBase64, "base64");
    console.log("[Privy] Transaction buffer length:", transactionBuffer.length);
    
    const transaction = VersionedTransaction.deserialize(transactionBuffer);
    console.log("[Privy] Transaction deserialized successfully");
    
    // Use walletApi.solana.signTransaction with walletId and caip2
    console.log("[Privy] Calling walletApi.solana.signTransaction...");
    const response = await serverAuthClient.walletApi.solana.signTransaction({
      walletId: walletId,
      caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", // Solana mainnet
      transaction: transaction,
    } as any);
    
    console.log("[Privy] Sign response received");
    console.log("[Privy] Response type:", typeof response.signedTransaction);
    console.log("[Privy] Response keys:", Object.keys(response.signedTransaction || {}));
    
    // The response.signedTransaction is a VersionedTransaction-like object
    const signedTx = response.signedTransaction as any;
    
    // Debug: Check the response structure
    console.log("[Privy] SignedTx type:", typeof signedTx);
    console.log("[Privy] SignedTx constructor:", signedTx?.constructor?.name);
    
    // Check if it's already a VersionedTransaction we can serialize directly
    if (signedTx && typeof signedTx.serialize === 'function') {
      console.log("[Privy] Using signedTx.serialize() directly");
      const directBuffer = signedTx.serialize();
      const directBase64 = Buffer.from(directBuffer).toString("base64");
      console.log("[Privy] Direct serialization length:", directBase64.length);
      return { signedTransaction: directBase64 };
    }
    
    // Privy returns a plain object with signatures and message
    // We need to properly reconstruct the signed transaction
    console.log("[Privy] Reconstructing signed transaction...");
    
    // Debug: Check all signatures from Privy response
    if (signedTx && signedTx.signatures) {
      const sigs = signedTx.signatures;
      console.log("[Privy] Privy response signatures count:", sigs.length);
      sigs.forEach((sig: any, idx: number) => {
        const sigArray = sig instanceof Uint8Array ? sig : (Array.isArray(sig) ? sig : Object.values(sig));
        const isZero = (sigArray as number[]).every((b: number) => b === 0);
        const firstBytes = (sigArray as number[]).slice(0, 4);
        console.log(`[Privy] Privy sig ${idx}: isZero=${isZero}, first4bytes=[${firstBytes.join(',')}]`);
      });
    }
    
    // For gasless RFQ: index 0 = market maker (empty), index 1 = user (signed)
    // Copy the Privy signatures to our original transaction
    const responseSignatures = signedTx.signatures;
    
    for (let i = 0; i < responseSignatures.length && i < transaction.signatures.length; i++) {
      const sig = responseSignatures[i];
      let sigBytes: Uint8Array;
      
      if (sig instanceof Uint8Array) {
        sigBytes = sig;
      } else if (ArrayBuffer.isView(sig)) {
        sigBytes = new Uint8Array(sig.buffer, sig.byteOffset, sig.byteLength);
      } else if (Array.isArray(sig)) {
        // Array of numbers
        sigBytes = new Uint8Array(sig);
      } else if (typeof sig === 'object') {
        // Plain object with numeric keys (Buffer serialized as JSON)
        const values = Object.values(sig) as number[];
        sigBytes = new Uint8Array(values);
      } else {
        sigBytes = new Uint8Array(64);
      }
      
      const isZero = sigBytes.every((b: number) => b === 0);
      console.log(`[Privy] Copying sig ${i}: isZero=${isZero}, length=${sigBytes.length}, first4=[${sigBytes.slice(0, 4).join(',')}]`);
      
      // Ensure signature is exactly 64 bytes
      if (sigBytes.length !== 64) {
        console.log(`[Privy] Warning: Signature ${i} has incorrect length ${sigBytes.length}, padding/truncating to 64`);
        const correctedSig = new Uint8Array(64);
        correctedSig.set(sigBytes.slice(0, 64));
        sigBytes = correctedSig;
      }
      
      // Copy signature bytes to original transaction
      transaction.signatures[i].set(sigBytes);
    }
    
    // Verify signatures were copied correctly
    console.log("[Privy] Final transaction signatures:");
    transaction.signatures.forEach((sig, idx) => {
      const isZero = sig.every((b: number) => b === 0);
      console.log(`[Privy] Final sig ${idx}: isZero=${isZero}, first4=[${sig.slice(0, 4).join(',')}]`);
    });
    
    // Serialize the transaction with updated signatures
    const signedTxBuffer = Buffer.from(transaction.serialize());
    
    console.log("[Privy] Signed transaction serialized, length:", signedTxBuffer.length);
    return { signedTransaction: signedTxBuffer.toString("base64") };
  } catch (error: any) {
    console.error("[Privy] Failed to sign transaction:", error);
    console.error("[Privy] Error details:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
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
