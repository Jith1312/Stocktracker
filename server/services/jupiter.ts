import { Connection, VersionedTransaction, PublicKey } from "@solana/web3.js";

const JUPITER_API_KEY = process.env.JUPITER_API_KEY;
const JUPITER_API_URL = JUPITER_API_KEY 
  ? "https://api.jup.ag" 
  : "https://lite-api.jup.ag";

export interface QuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: any[];
  contextSlot: number;
  timeTaken: number;
}

export interface SwapResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
}

export async function getQuote(
  inputMint: string,
  outputMint: string,
  amountRaw: string,
  slippageBps = 50
): Promise<QuoteResponse> {
  const url = new URL(`${JUPITER_API_URL}/swap/v1/quote`);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", amountRaw);
  url.searchParams.set("slippageBps", slippageBps.toString());
  url.searchParams.set("swapMode", "ExactIn");

  const headers: Record<string, string> = {};
  if (JUPITER_API_KEY) {
    headers["x-api-key"] = JUPITER_API_KEY;
  }

  const response = await fetch(url.toString(), { headers });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Jupiter quote error: ${error}`);
  }

  return response.json();
}

export async function getSwapTransaction(
  quoteResponse: QuoteResponse,
  userPublicKey: string
): Promise<SwapResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (JUPITER_API_KEY) {
    headers["x-api-key"] = JUPITER_API_KEY;
  }

  const response = await fetch(`${JUPITER_API_URL}/swap/v1/swap`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Jupiter swap error: ${error}`);
  }

  return response.json();
}

export function usdToRawAmount(usdAmount: number, decimals: number = 6): string {
  return Math.floor(usdAmount * Math.pow(10, decimals)).toString();
}

export function rawAmountToDisplay(rawAmount: string, decimals: number = 6): string {
  const value = parseInt(rawAmount) / Math.pow(10, decimals);
  return value.toFixed(decimals);
}

export async function sendAndConfirmTransaction(
  connection: Connection,
  serializedTransaction: Buffer
): Promise<string> {
  const transaction = VersionedTransaction.deserialize(serializedTransaction);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }, "confirmed");

  return signature;
}

export async function getTokenBalance(
  connection: Connection,
  walletAddress: string,
  mintAddress: string
): Promise<{ balance: string; decimals: number }> {
  try {
    const wallet = new PublicKey(walletAddress);
    const mint = new PublicKey(mintAddress);
    
    const accounts = await connection.getParsedTokenAccountsByOwner(wallet, { mint });
    
    if (accounts.value.length === 0) {
      return { balance: "0", decimals: 6 };
    }

    const account = accounts.value[0].account.data.parsed.info;
    return {
      balance: account.tokenAmount.amount,
      decimals: account.tokenAmount.decimals,
    };
  } catch (error) {
    console.error("[Jupiter] Error getting token balance:", error);
    return { balance: "0", decimals: 6 };
  }
}
