/* ==========================================================================
   Adaptive Volatility AMM - Reactive State Store & AMM Math
   ========================================================================== */

export const state = {
  wallet: {
    connected: false,
    address: null,
    chainId: 11155111, // Sepolia default
  },

  tokens: {
    ETH: {
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      balance: 10.00,
      priceUSD: 2500.00,
      icon: '🔷'
    },
    USDC: {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      balance: 25000.00,
      priceUSD: 1.00,
      icon: '💵'
    }
  },

  pool: {
    token0: 'ETH',
    token1: 'USDC',
    reserve0: 1000.0, // 1,000 ETH
    reserve1: 2500000.0, // 2,500,000 USDC ($2,500 / ETH)
    
    // Fee configurations matching AdaptiveFeeHook.sol
    lowFee: 500, // 0.05%
    mediumFee: 3000, // 0.30%
    highFee: 10000, // 1.00%
    mevThresholdBps: 100, // 1.00% move threshold
    mevSpikeFee: 50000, // 5.00% spike fee
    maxStaleness: 3600, // 1 hour

    // Dynamic metrics
    volatilityMetric: 65, // in bps, calm market
    lastVolatilityUpdate: Date.now(),
    currentBlock: 18920420,
    blockStartPrice: 2500.0, // Baseline for the current block
    currentPrice: 2500.0,
    sameBlockSwapsCount: 0,
    
    // Stats tracking
    totalVolumeUSD: 1245080.0,
    totalFeesUSD: 3120.50,
    mevAttacksDefended: 14
  },

  settings: {
    slippageBps: 50, // 0.50%
    isSimulatedMode: true,
  },

  listeners: []
};

export function subscribe(callback) {
  state.listeners.push(callback);
  return () => {
    state.listeners = state.listeners.filter(l => l !== callback);
  };
}

export function notify() {
  state.listeners.forEach(cb => cb(state));
}

// Check staleness of volatility oracle
export function isVolatilityStale() {
  const ageSeconds = (Date.now() - state.pool.lastVolatilityUpdate) / 1000;
  return ageSeconds > state.pool.maxStaleness;
}

// Compute active fee according to AdaptiveFeeHook logic
export function getActiveFee(simulatedPriceMoveBps = 0) {
  const pool = state.pool;

  // 1. Staleness check: fail-safe to HIGH tier
  if (isVolatilityStale()) {
    return {
      tierFee: pool.highFee,
      appliedFee: pool.highFee,
      isMevTriggered: false,
      reason: 'Oracle Stale (Fail-Safe Tier)'
    };
  }

  // 2. Volatility tier resolution
  let tierFee = pool.highFee;
  let reason = 'High Volatility Tier';
  if (pool.volatilityMetric <= 100) {
    tierFee = pool.lowFee;
    reason = 'Low Volatility Tier';
  } else if (pool.volatilityMetric <= 500) {
    tierFee = pool.mediumFee;
    reason = 'Medium Volatility Tier';
  }

  // 3. Intra-block MEV check
  // Compare current price against blockStartPrice
  const priceDelta = Math.abs(pool.currentPrice - pool.blockStartPrice);
  const priceDeltaBps = Math.floor((priceDelta / pool.blockStartPrice) * 10000) + simulatedPriceMoveBps;
  const isMevTriggered = priceDeltaBps > pool.mevThresholdBps;

  const appliedFee = isMevTriggered && pool.mevSpikeFee > tierFee ? pool.mevSpikeFee : tierFee;

  return {
    tierFee,
    appliedFee,
    isMevTriggered,
    priceDeltaBps,
    reason: isMevTriggered ? 'MEV Price Move Detected (Spike Active)' : reason
  };
}

// Exact Uniswap Constant Product output calculation
export function calculateSwapOutput(amountIn, tokenInSymbol) {
  if (!amountIn || isNaN(amountIn) || amountIn <= 0) {
    return {
      amountOut: 0,
      rate: 0,
      priceImpact: 0,
      appliedFeePercent: 0,
      isMevTriggered: false,
      feeAmountUSD: 0
    };
  }

  const pool = state.pool;
  const isZeroForOne = tokenInSymbol === pool.token0; // ETH -> USDC

  const rIn = isZeroForOne ? pool.reserve0 : pool.reserve1;
  const rOut = isZeroForOne ? pool.reserve1 : pool.reserve0;

  const feeData = getActiveFee();
  const feeRate = feeData.appliedFee / 1000000; // e.g. 500 -> 0.0005, 50000 -> 0.05

  const amountInWithFee = amountIn * (1 - feeRate);
  // Constant product formula: (rIn + amountInWithFee) * (rOut - amountOut) = rIn * rOut
  const amountOut = (amountInWithFee * rOut) / (rIn + amountInWithFee);

  // Price impact
  const currentMidPrice = isZeroForOne ? (rOut / rIn) : (rIn / rOut);
  const effectiveExecutionPrice = amountOut / amountIn;
  const priceImpact = Math.max(0, ((currentMidPrice - effectiveExecutionPrice) / currentMidPrice) * 100);

  const feeAmountInToken = amountIn * feeRate;
  const inTokenUSD = state.tokens[tokenInSymbol].priceUSD;
  const feeAmountUSD = feeAmountInToken * inTokenUSD;

  return {
    amountOut,
    rate: effectiveExecutionPrice,
    priceImpact,
    appliedFeeBps: feeData.appliedFee,
    appliedFeePercent: (feeData.appliedFee / 10000).toFixed(4),
    isMevTriggered: feeData.isMevTriggered,
    reason: feeData.reason,
    feeAmountUSD
  };
}

// Execute swap and update local state
export function executeSwap(amountIn, tokenInSymbol, minAmountOut) {
  const result = calculateSwapOutput(amountIn, tokenInSymbol);
  if (result.amountOut < minAmountOut) {
    throw new Error('Transaction slippage exceeded minimum amount out');
  }

  const tokenIn = state.tokens[tokenInSymbol];
  const tokenOutSymbol = tokenInSymbol === state.pool.token0 ? state.pool.token1 : state.pool.token0;
  const tokenOut = state.tokens[tokenOutSymbol];

  if (tokenIn.balance < amountIn) {
    throw new Error(`Insufficient ${tokenInSymbol} balance`);
  }

  // Deduct balance and credit output
  tokenIn.balance -= amountIn;
  tokenOut.balance += result.amountOut;

  // Update AMM Reserves
  const isZeroForOne = tokenInSymbol === state.pool.token0;
  if (isZeroForOne) {
    state.pool.reserve0 += amountIn;
    state.pool.reserve1 -= result.amountOut;
  } else {
    state.pool.reserve1 += amountIn;
    state.pool.reserve0 -= result.amountOut;
  }

  // Update Pool current price
  state.pool.currentPrice = state.pool.reserve1 / state.pool.reserve0;
  state.pool.sameBlockSwapsCount += 1;

  // Track analytics
  const volumeUSD = amountIn * tokenIn.priceUSD;
  state.pool.totalVolumeUSD += volumeUSD;
  state.pool.totalFeesUSD += result.feeAmountUSD;

  notify();
  return result;
}

export function advanceBlock() {
  state.pool.currentBlock += 1;
  state.pool.blockStartPrice = state.pool.currentPrice;
  state.pool.sameBlockSwapsCount = 0;
  notify();
}
