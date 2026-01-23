import { Connection, VersionedTransaction, PublicKey } from "@solana/web3.js";

const JUPITER_API_KEY = process.env.JUPITER_API_KEY;
const JUPITER_API_URL = "https://api.jup.ag";

export interface UltraOrderResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: any[];
  transaction: string | null;
  requestId: string;
  swapType: string;
  gasless: boolean;
  inUsdValue: number;
  outUsdValue: number;
}

export interface UltraExecuteResponse {
  status: string;
  signature?: string;
  error?: string;
  code?: string;
  inputMint?: string;
  outputMint?: string;
  inputAmount?: string;
  outputAmount?: string;
}

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
  requestId: string;
  transaction: string | null;
  gasless: boolean;
}

export interface SwapResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
}

export async function getUltraOrder(
  inputMint: string,
  outputMint: string,
  amountRaw: string,
  takerAddress?: string
): Promise<UltraOrderResponse> {
  const url = new URL(`${JUPITER_API_URL}/ultra/v1/order`);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", amountRaw);
  if (takerAddress) {
    url.searchParams.set("taker", takerAddress);
  }

  const headers: Record<string, string> = {};
  if (JUPITER_API_KEY) {
    headers["x-api-key"] = JUPITER_API_KEY;
  }

  const response = await fetch(url.toString(), { headers });
  const data = await response.json();
  
  if (data.error) {
    throw new Error(`Jupiter Ultra order error: ${data.error}`);
  }

  return data;
}

export async function executeUltraOrder(
  requestId: string,
  signedTransaction: string
): Promise<UltraExecuteResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (JUPITER_API_KEY) {
    headers["x-api-key"] = JUPITER_API_KEY;
  }

  console.log("[Jupiter] Executing ultra order with requestId:", requestId);
  console.log("[Jupiter] Signed transaction length:", signedTransaction.length);
  
  const response = await fetch(`${JUPITER_API_URL}/ultra/v1/execute`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      requestId,
      signedTransaction,
    }),
  });

  const data = await response.json();
  console.log("[Jupiter] Execute response:", JSON.stringify(data, null, 2));
  return data;
}

export interface V6QuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: any[];
}

export interface V6SwapResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
}

export async function getQuoteV6(
  inputMint: string,
  outputMint: string,
  amountRaw: string
): Promise<V6QuoteResponse> {
  const url = new URL("https://quote-api.jup.ag/v6/quote");
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", amountRaw);
  url.searchParams.set("slippageBps", "100"); // 1% slippage

  console.log("[Jupiter] Getting v6 quote:", url.toString());
  const response = await fetch(url.toString());
  const data = await response.json();
  
  if (data.error) {
    throw new Error(`Jupiter v6 quote error: ${data.error}`);
  }
  
  console.log("[Jupiter] V6 quote received, outAmount:", data.outAmount);
  return data;
}

export async function getSwapTransactionV6(
  quoteResponse: V6QuoteResponse,
  userPublicKey: string
): Promise<V6SwapResponse> {
  console.log("[Jupiter] Getting v6 swap transaction for user:", userPublicKey);
  
  const response = await fetch("https://quote-api.jup.ag/v6/swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  });

  const data = await response.json();
  
  if (data.error) {
    throw new Error(`Jupiter v6 swap error: ${data.error}`);
  }
  
  console.log("[Jupiter] V6 swap transaction received");
  return data;
}

export async function getQuote(
  inputMint: string,
  outputMint: string,
  amountRaw: string,
  takerAddress?: string
): Promise<QuoteResponse> {
  // Use v6 API instead of Ultra API for more reliability
  const v6Quote = await getQuoteV6(inputMint, outputMint, amountRaw);
  
  // Get swap transaction if taker address provided
  let transaction: string | null = null;
  if (takerAddress) {
    const swapData = await getSwapTransactionV6(v6Quote, takerAddress);
    transaction = swapData.swapTransaction;
  }
  
  return {
    inputMint: v6Quote.inputMint,
    outputMint: v6Quote.outputMint,
    inAmount: v6Quote.inAmount,
    outAmount: v6Quote.outAmount,
    otherAmountThreshold: v6Quote.otherAmountThreshold,
    swapMode: v6Quote.swapMode,
    slippageBps: v6Quote.slippageBps,
    priceImpactPct: v6Quote.priceImpactPct,
    routePlan: v6Quote.routePlan,
    requestId: "", // V6 doesn't use requestId
    transaction: transaction,
    gasless: false,
  };
}

export async function getSwapTransaction(
  quoteResponse: QuoteResponse,
  userPublicKey: string
): Promise<SwapResponse> {
  const ultraOrder = await getUltraOrder(
    quoteResponse.inputMint,
    quoteResponse.outputMint,
    quoteResponse.inAmount,
    userPublicKey
  );

  if (!ultraOrder.transaction) {
    throw new Error("No transaction available from Jupiter Ultra");
  }

  return {
    swapTransaction: ultraOrder.transaction,
    lastValidBlockHeight: 0,
    prioritizationFeeLamports: 0,
  };
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
