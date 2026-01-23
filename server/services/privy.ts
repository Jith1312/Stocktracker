import { PrivyClient } from "@privy-io/server-auth";

const PRIVY_APP_ID = process.env.PRIVY_APP_ID!;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET!;

if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
  console.warn("[Privy] Missing PRIVY_APP_ID or PRIVY_APP_SECRET");
}

const privyClient = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET);

export async function verifyToken(token: string) {
  try {
    const claims = await privyClient.verifyAuthToken(token);
    return claims;
  } catch (error) {
    console.error("[Privy] Token verification failed:", error);
    return null;
  }
}

export async function getUser(privyDid: string) {
  try {
    const user = await privyClient.getUser(privyDid);
    return user;
  } catch (error) {
    console.error("[Privy] Failed to get user:", error);
    return null;
  }
}

export async function isWalletDelegated(privyDid: string, walletAddress: string): Promise<boolean> {
  try {
    const user = await privyClient.getUser(privyDid);
    if (!user) return false;
    
    const wallet = user.linkedAccounts.find(
      (account: any) => 
        account.type === "wallet" && 
        account.address?.toLowerCase() === walletAddress.toLowerCase()
    );
    
    return wallet?.delegated === true;
  } catch (error) {
    console.error("[Privy] Failed to check delegation:", error);
    return false;
  }
}

export async function signAndSendTransaction(
  walletAddress: string,
  transactionBase64: string
): Promise<{ signature: string } | { error: string }> {
  try {
    const result = await privyClient.walletApi.solana.signAndSendTransaction({
      address: walletAddress,
      caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      transaction: transactionBase64,
    });
    
    console.log("[Privy] Transaction sent successfully:", result);
    return { signature: result.hash };
  } catch (error: any) {
    console.error("[Privy] Failed to sign and send transaction:", error);
    return { error: error.message || "Failed to execute transaction" };
  }
}

export async function signTransaction(
  walletAddress: string,
  transactionBase64: string
): Promise<{ signedTransaction: string } | { error: string }> {
  try {
    const result = await privyClient.walletApi.solana.signTransaction({
      address: walletAddress,
      caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      transaction: transactionBase64,
    });
    
    return { signedTransaction: result.signedTransaction };
  } catch (error: any) {
    console.error("[Privy] Failed to sign transaction:", error);
    return { error: error.message || "Failed to sign transaction" };
  }
}

export { privyClient };
