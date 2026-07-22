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
  // Amounts as actually settled onchain, reported by Ultra /execute
  inputAmountResult?: string;
  outputAmountResult?: string;
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
  signedTransaction: string,
  maxRetries: number = 3
): Promise<UltraExecuteResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (JUPITER_API_KEY) {
    headers["x-api-key"] = JUPITER_API_KEY;
  }

  console.log("[Jupiter] Executing ultra order with requestId:", requestId);
  console.log("[Jupiter] Signed transaction length:", signedTransaction.length);
  
  let lastError: UltraExecuteResponse | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[Jupiter] Execute attempt ${attempt}/${maxRetries}`);
    
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
    
    // Success case
    if (data.status === "Success" || data.signature) {
      return data;
    }
    
    // Retryable error codes: -2005 (Internal error), -2000 (Transaction failed to land)
    if ((data.code === -2005 || data.code === -2000) && attempt < maxRetries) {
      console.log(`[Jupiter] Retryable error (${data.code}), waiting ${attempt * 1000}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      lastError = data;
      continue;
    }
    
    // Non-retryable error or max retries reached
    return data;
  }
  
  return lastError || { status: "Failed", error: "Max retries exceeded" };
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
  const url = new URL("https://api.jup.ag/swap/v1/quote");
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", amountRaw);
  url.searchParams.set("slippageBps", "100"); // 1% slippage

  console.log("[Jupiter] Getting v6 quote:", url.toString());
  
  const headers: Record<string, string> = {};
  if (JUPITER_API_KEY) {
    headers["x-api-key"] = JUPITER_API_KEY;
  }
  
  const response = await fetch(url.toString(), { headers });
  const data = await response.json();
  
  console.log("[Jupiter] V6 quote raw response:", JSON.stringify(data).substring(0, 500));
  
  if (data.error || data.code) {
    throw new Error(`Jupiter v6 quote error: ${data.error || data.message}`);
  }
  
  console.log("[Jupiter] V6 quote received, outAmount:", data.outAmount);
  return data;
}

export async function getSwapTransactionV6(
  quoteResponse: V6QuoteResponse,
  userPublicKey: string
): Promise<V6SwapResponse> {
  console.log("[Jupiter] Getting v6 swap transaction for user:", userPublicKey);
  
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (JUPITER_API_KEY) {
    headers["x-api-key"] = JUPITER_API_KEY;
  }
  
  const response = await fetch("https://api.jup.ag/swap/v1/swap", {
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

  const data = await response.json();
  
  console.log("[Jupiter] V6 swap raw response:", JSON.stringify(data).substring(0, 500));
  
  if (data.error || data.code) {
    throw new Error(`Jupiter v6 swap error: ${data.error || data.message}`);
  }
  
  console.log("[Jupiter] V6 swap transaction received, has swapTransaction:", !!data.swapTransaction);
  return data;
}

export async function getQuote(
  inputMint: string,
  outputMint: string,
  amountRaw: string,
  takerAddress?: string
): Promise<QuoteResponse> {
  // Use Ultra API for RFQ-based trading (required for Ondo tokenized stocks)
  console.log("[Jupiter] Getting Ultra quote for:", { inputMint, outputMint, amountRaw, takerAddress });
  
  const ultraOrder = await getUltraOrder(inputMint, outputMint, amountRaw, takerAddress);
  
  console.log("[Jupiter] Ultra order received:", {
    outAmount: ultraOrder.outAmount,
    gasless: ultraOrder.gasless,
    swapType: ultraOrder.swapType,
    hasTransaction: !!ultraOrder.transaction,
    requestId: ultraOrder.requestId
  });
  
  return {
    inputMint: ultraOrder.inputMint,
    outputMint: ultraOrder.outputMint,
    inAmount: ultraOrder.inAmount,
    outAmount: ultraOrder.outAmount,
    otherAmountThreshold: ultraOrder.otherAmountThreshold,
    swapMode: ultraOrder.swapMode,
    slippageBps: ultraOrder.slippageBps,
    priceImpactPct: ultraOrder.priceImpactPct,
    routePlan: ultraOrder.routePlan,
    requestId: ultraOrder.requestId,
    transaction: ultraOrder.transaction,
    gasless: ultraOrder.gasless,
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

export async function getTokenPrices(mints: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  
  try {
    if (mints.length === 0) return {};
    
    // Try Jupiter Price API first
    const mintList = mints.join(",");
    const response = await fetch(`https://price.jup.ag/v6/price?ids=${mintList}`, {
      signal: AbortSignal.timeout(5000),
    });
    
    if (response.ok) {
      const data = await response.json();
      for (const [key, info] of Object.entries(data.data || {})) {
        const priceInfo = info as any;
        if (priceInfo?.price) {
          const mint = priceInfo.id || key;
          prices[mint] = parseFloat(priceInfo.price);
        }
      }
    }
  } catch (error) {
    console.log("[Jupiter] Price API unavailable, using quote-based pricing");
  }
  
  // For any missing prices, get them via Ultra quote API
  const missingMints = mints.filter(m => !prices[m]);
  if (missingMints.length > 0) {
    const USDC_MINT = process.env.USDC_MINT || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const quoteAmount = "1000000"; // 1 USDC (6 decimals)
    
    // Fetch quotes in parallel with rate limiting
    const quotePromises = missingMints.map(async (mint, index) => {
      // Stagger requests slightly to avoid rate limits
      await new Promise(r => setTimeout(r, index * 100));
      
      try {
        const url = `https://api.jup.ag/ultra/v1/order?inputMint=${USDC_MINT}&outputMint=${mint}&amount=${quoteAmount}`;
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (process.env.JUPITER_API_KEY) {
          headers["x-api-key"] = process.env.JUPITER_API_KEY;
        }
        
        const res = await fetch(url, { 
          headers,
          signal: AbortSignal.timeout(8000),
        });
        
        if (res.ok) {
          const data = await res.json();
          // outAmount is in token decimals (usually 9 for Ondo tokens)
          // We sent 1 USDC, so price = 1 / (outAmount / 10^decimals)
          if (data.outAmount) {
            const outAmount = parseFloat(data.outAmount) / 1_000_000_000; // 9 decimals for Ondo
            if (outAmount > 0) {
              prices[mint] = 1 / outAmount; // Price in USD per token
              console.log(`[Jupiter] Quote price for ${mint}: $${prices[mint].toFixed(2)}`);
            }
          }
        }
      } catch (e) {
        // Silently skip failed quotes
      }
    });
    
    await Promise.all(quotePromises);
  }
  
  console.log("[Jupiter] Fetched prices for", Object.keys(prices).length, "tokens");
  return prices;
}
