/* ==========================================================================
   Adaptive Volatility AMM - Reactive State Store & AMM Math
   ========================================================================== */

import {
  SEPOLIA_CONFIG,
  fetchLiveBlockInfo,
  fetchLivePoolSlot0,
  fetchLiveHookData,
  fetchLiveAccountBalances
} from './contracts.js';

export const state = {
  wallet: {
    connected: false,
    address: null,
    chainId: 11155111, // Sepolia default
    isMetaMask: false
  },

  network: {
    name: 'Ethereum Sepolia Testnet',
    chainId: 11155111,
    isLiveConnected: true,
    blockNumber: 11679574,
    rpcLatencyMs: 45,
    lastSyncTimestamp: null,
    syncStatus: 'connecting', // 'connecting' | 'connected' | 'error'
    poolId: SEPOLIA_CONFIG.contracts.poolId,
    hookAddress: SEPOLIA_CONFIG.contracts.adaptiveFeeHook,
    consumerAddress: SEPOLIA_CONFIG.contracts.volatilityConsumer,
    poolManagerAddress: SEPOLIA_CONFIG.contracts.poolManager
  },

  tokens: {
    ETH: {
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      balance: 10.00,
      priceUSD: 2420.00,
      icon: '🔷'
    },
    USDC: {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      balance: 24200.00,
      priceUSD: 1.00,
      icon: '💵'
    }
  },

  pool: {
    token0: 'ETH',
    token1: 'USDC',
    reserve0: 1000.0, // 1,000 ETH
    reserve1: 2420000.0, // 2,420,000 USDC
    
    // Fee configurations matching AdaptiveFeeHook.sol on Sepolia
    lowFee: 500, // 0.05%
    mediumFee: 3000, // 0.30%
    highFee: 10000, // 1.00%
    lowVolMax: 100,
    mediumVolMax: 500,
    mevThresholdBps: 100, // 1.00% move threshold
    mevSpikeFee: 50000, // 5.00% spike fee
    maxStaleness: 3600, // 1 hour

    // Dynamic on-chain metrics
    volatilityMetric: 65, // in bps
    lastVolatilityUpdate: Date.now(),
    currentBlock: 11679574,
    blockStartPrice: 2420.0, // Baseline for the current block
    currentPrice: 2420.0,
    sameBlockSwapsCount: 0,
    sqrtPriceX96: '79228162514264337593543950336', // 1.0 in Q96
    tick: 0,
    
    // Stats tracking
    totalVolumeUSD: 1245080.0,
    totalFeesUSD: 3120.50,
    mevAttacksDefended: 14
  },

  settings: {
    slippageBps: 50, // 0.50%
    isSimulatedMode: false, // Default: LIVE ON-CHAIN SEPOLIA MODE
    dataSource: 'Sepolia Live RPC'
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
  if (pool.volatilityMetric <= pool.lowVolMax) {
    tierFee = pool.lowFee;
    reason = 'Low Volatility Tier (Calm Market)';
  } else if (pool.volatilityMetric <= pool.mediumVolMax) {
    tierFee = pool.mediumFee;
    reason = 'Medium Volatility Tier (Normal Market)';
  }

  // 3. Intra-block MEV check
  const priceDelta = Math.abs(pool.currentPrice - pool.blockStartPrice);
  const priceDeltaBps = Math.floor((priceDelta / pool.blockStartPrice) * 10000) + simulatedPriceMoveBps;
  const isMevTriggered = priceDeltaBps > pool.mevThresholdBps;

  const appliedFee = isMevTriggered && pool.mevSpikeFee > tierFee ? pool.mevSpikeFee : tierFee;

  return {
    tierFee,
    appliedFee,
    isMevTriggered,
    priceDeltaBps,
    reason: isMevTriggered ? 'MEV Price Move Detected (5% Punitive Spike)' : reason
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
  const isZeroForOne = tokenInSymbol === pool.token0;

  const rIn = isZeroForOne ? pool.reserve0 : pool.reserve1;
  const rOut = isZeroForOne ? pool.reserve1 : pool.reserve0;

  const feeData = getActiveFee();
  const feeRate = feeData.appliedFee / 1000000;

  const amountInWithFee = amountIn * (1 - feeRate);
  const amountOut = (amountInWithFee * rOut) / (rIn + amountInWithFee);

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
  state.network.blockNumber = state.pool.currentBlock;
  state.pool.blockStartPrice = state.pool.currentPrice;
  state.pool.sameBlockSwapsCount = 0;
  notify();
}

/**
 * Perform live on-chain synchronization with Ethereum Sepolia
 */
export async function syncWithSepolia() {
  try {
    state.network.syncStatus = 'syncing';

    // 1. Fetch live block number and latency
    const blockInfo = await fetchLiveBlockInfo();
    if (blockInfo && blockInfo.blockNumber) {
      state.network.blockNumber = blockInfo.blockNumber;
      state.network.rpcLatencyMs = blockInfo.latencyMs;
      state.pool.currentBlock = blockInfo.blockNumber;
    }

    // 2. Fetch live Uniswap v4 slot0 (sqrtPriceX96 & tick)
    const slot0 = await fetchLivePoolSlot0();
    if (slot0) {
      state.pool.sqrtPriceX96 = slot0.sqrtPriceX96;
      state.pool.tick = slot0.tick;
    }

    // 3. Fetch live Hook parameters
    const hookData = await fetchLiveHookData();
    if (hookData) {
      state.pool.lowFee = hookData.lowFee;
      state.pool.mediumFee = hookData.mediumFee;
      state.pool.highFee = hookData.highFee;
      state.pool.lowVolMax = hookData.lowVolMax;
      state.pool.mediumVolMax = hookData.mediumVolMax;
      state.pool.maxStaleness = hookData.maxStaleness;
      state.pool.mevThresholdBps = hookData.mevThresholdBps;
      state.pool.mevSpikeFee = hookData.mevSpikeFee;
      
      // If on-chain volatility metric has been updated, use it; otherwise maintain active simulation metric
      if (hookData.volatilityMetric > 0) {
        state.pool.volatilityMetric = hookData.volatilityMetric;
        state.pool.lastVolatilityUpdate = hookData.volatilityUpdatedAt;
      }
    }

    // 4. If wallet connected, update real balance
    if (state.wallet.connected && state.wallet.address && !state.wallet.address.includes('...')) {
      const balances = await fetchLiveAccountBalances(state.wallet.address);
      if (balances && typeof balances.ethBalance === 'number') {
        state.tokens.ETH.balance = balances.ethBalance;
      }
    }

    state.network.syncStatus = 'connected';
    state.network.lastSyncTimestamp = Date.now();
    notify();
  } catch (err) {
    console.warn('Sepolia on-chain sync encountered an error:', err);
    state.network.syncStatus = 'error';
    notify();
  }
}
