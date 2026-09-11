/* ==========================================================================
   Adaptive Volatility AMM - DEX State Management & On-Chain Sync
   ========================================================================== */

import {
  fetchLiveBlockInfo,
  fetchLivePoolSlot0,
  fetchLiveHookData,
  fetchLiveAccountBalances,
  SEPOLIA_CONFIG
} from './contracts.js';

export const state = {
  network: {
    chainId: 11155111,
    name: 'Sepolia Testnet',
    blockNumber: 11680120,
    rpcLatencyMs: 38,
    syncStatus: 'connected',
    lastSyncTimestamp: Date.now()
  },

  wallet: {
    connected: false,
    address: null,
    nativeBalance: 0.0,
    isMetaMask: false
  },

  tokens: {
    ETH: {
      symbol: 'ETH',
      name: 'Ethereum (v4-Test)',
      address: SEPOLIA_CONFIG.contracts.token0,
      decimals: 18,
      balance: 0.00,
      priceUSD: 2420.00,
      icon: '🔷'
    },
    USDC: {
      symbol: 'USDC',
      name: 'USD Coin (v4-Test)',
      address: SEPOLIA_CONFIG.contracts.token1,
      decimals: 18,
      balance: 0.00,
      priceUSD: 1.00,
      icon: '💵'
    }
  },

  pool: {
    token0: 'ETH',
    token1: 'USDC',
    addressToken0: SEPOLIA_CONFIG.contracts.token0,
    addressToken1: SEPOLIA_CONFIG.contracts.token1,
    reserve0: 1000.0,
    reserve1: 1000.0,
    
    lowFee: 500,
    mediumFee: 3000,
    highFee: 10000,
    lowVolMax: 100,
    mediumVolMax: 500,
    mevThresholdBps: 100,
    mevSpikeFee: 50000,
    maxStaleness: 3600,

    volatilityMetric: 65,
    lastVolatilityUpdate: Date.now(),
    currentBlock: 11680120,
    blockStartPrice: 1.0,
    currentPrice: 1.0,
    sameBlockSwapsCount: 0,
    sqrtPriceX96: '79228162514264337593543950336',
    tick: 0,
    
    totalVolumeUSD: 48920.0,
    totalFeesUSD: 124.50,
    totalTransactions: 1
  },

  settings: {
    slippageBps: 50,
    deadlineMinutes: 20
  },

  recentTransactions: [
    {
      hash: '0x179a10cf1f73bc527878d39a58fa4d169bd0bb16b61152e407f3b9dbbe8abd16',
      type: 'Add Liquidity',
      details: '1,000 ETH + 1,000 USDC Seeded',
      timestamp: Date.now() - 60000,
      status: 'confirmed'
    }
  ],

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

export function isVolatilityStale() {
  const ageSeconds = (Date.now() - state.pool.lastVolatilityUpdate) / 1000;
  return ageSeconds > state.pool.maxStaleness;
}

export function getActiveFee() {
  const pool = state.pool;

  if (isVolatilityStale()) {
    return {
      tierFee: pool.highFee,
      appliedFee: pool.highFee,
      isMevTriggered: false,
      reason: 'Oracle Stale (Default High)'
    };
  }

  let tierFee = pool.highFee;
  let reason = 'High Volatility';
  if (pool.volatilityMetric <= pool.lowVolMax) {
    tierFee = pool.lowFee;
    reason = 'Low Volatility (0.05%)';
  } else if (pool.volatilityMetric <= pool.mediumVolMax) {
    tierFee = pool.mediumFee;
    reason = 'Standard Volatility (0.30%)';
  }

  const priceDelta = Math.abs(pool.currentPrice - pool.blockStartPrice);
  const priceDeltaBps = Math.floor((priceDelta / (pool.blockStartPrice || 1.0)) * 10000);
  const isMevTriggered = priceDeltaBps > pool.mevThresholdBps;

  const appliedFee = isMevTriggered && pool.mevSpikeFee > tierFee ? pool.mevSpikeFee : tierFee;

  return {
    tierFee,
    appliedFee,
    isMevTriggered,
    priceDeltaBps,
    reason: isMevTriggered ? 'Intra-Block MEV Protection (5.00%)' : reason
  };
}

export function calculateSwapOutput(amountIn, tokenInSymbol) {
  if (!amountIn || isNaN(amountIn) || amountIn <= 0) {
    return {
      amountOut: 0,
      rate: 0,
      priceImpact: 0,
      appliedFeePercent: '0.05',
      isMevTriggered: false,
      feeAmountUSD: 0,
      reason: 'Standard'
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
    appliedFeePercent: (feeData.appliedFee / 10000).toFixed(2),
    isMevTriggered: feeData.isMevTriggered,
    reason: feeData.reason,
    feeAmountUSD
  };
}

export function recordTransaction(hash, type, details) {
  state.recentTransactions.unshift({
    hash,
    type,
    details,
    timestamp: Date.now(),
    status: 'confirmed'
  });
  if (state.recentTransactions.length > 15) {
    state.recentTransactions.pop();
  }
  notify();
}

export async function syncWithSepolia() {
  try {
    state.network.syncStatus = 'syncing';

    const [blockInfo, slot0, hookData] = await Promise.all([
      fetchLiveBlockInfo(),
      fetchLivePoolSlot0(),
      fetchLiveHookData()
    ]);

    if (blockInfo && blockInfo.blockNumber) {
      state.network.blockNumber = blockInfo.blockNumber;
      state.network.rpcLatencyMs = blockInfo.latencyMs;
      state.pool.currentBlock = blockInfo.blockNumber;
    }

    if (slot0) {
      state.pool.sqrtPriceX96 = slot0.sqrtPriceX96;
      state.pool.tick = slot0.tick;
      if (slot0.calculatedPrice > 0) {
        state.pool.currentPrice = slot0.calculatedPrice;
      }
    }

    if (hookData) {
      state.pool.lowFee = hookData.lowFee;
      state.pool.mediumFee = hookData.mediumFee;
      state.pool.highFee = hookData.highFee;
      state.pool.lowVolMax = hookData.lowVolMax;
      state.pool.mediumVolMax = hookData.mediumVolMax;
      state.pool.maxStaleness = hookData.maxStaleness;
      state.pool.mevThresholdBps = hookData.mevThresholdBps;
      state.pool.mevSpikeFee = hookData.mevSpikeFee;
      
      if (hookData.volatilityMetric > 0) {
        state.pool.volatilityMetric = hookData.volatilityMetric;
        state.pool.lastVolatilityUpdate = hookData.volatilityUpdatedAt;
      }
    }

    if (state.wallet.connected && state.wallet.address && !state.wallet.address.includes('...')) {
      const balances = await fetchLiveAccountBalances(state.wallet.address);
      if (balances) {
        state.wallet.nativeBalance = balances.ethBalance;
        state.tokens.ETH.balance = balances.token0Balance;
        state.tokens.USDC.balance = balances.token1Balance;
      }
    }

    state.network.syncStatus = 'connected';
    state.network.lastSyncTimestamp = Date.now();
    notify();
  } catch (err) {
    console.warn('Sepolia on-chain sync error:', err);
    state.network.syncStatus = 'error';
    notify();
  }
}
