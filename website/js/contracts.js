/* ==========================================================================
   Adaptive Volatility AMM - Sepolia Testnet Contracts & Live RPC Service
   ========================================================================== */

export const SEPOLIA_CONFIG = {
  chainId: 11155111,
  chainIdHex: '0xaa36a7',
  networkName: 'Ethereum Sepolia Testnet',
  blockExplorerUrl: 'https://sepolia.etherscan.io',
  
  rpcUrls: [
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://rpc.sepolia.org',
    'https://sepolia.drpc.org'
  ],

  contracts: {
    poolManager: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543',
    adaptiveFeeHook: '0xab4c103d0b4783d736e12ea01a98945f08122080',
    volatilityConsumer: '0xbB833c9853587f5C562B407D2D95B0f0509AB733',
    token0: '0x71e19488aefb43fc0e80df050fbeadbe9e830e2f',
    token1: '0x89e2483a99fa2d2a45a64a3955681e57c63ec169',
    poolId: '0xfa002164aa10ade9439fd684b53822f04455c76dd80261f3c031766b00a44ccf'
  }
};

const POOL_MANAGER_ABI = [
  'function extsload(bytes32 slot) external view returns (bytes32)'
];

const HOOK_ABI = [
  'function volatilityOf(bytes32 poolId) external view returns (uint256 value, uint256 lastUpdateTimestamp)',
  'function KEEPER() external view returns (address)',
  'function keeperSet() external view returns (bool)',
  'function LOW_FEE() external view returns (uint24)',
  'function MEDIUM_FEE() external view returns (uint24)',
  'function HIGH_FEE() external view returns (uint24)',
  'function LOW_VOL_MAX() external view returns (uint256)',
  'function MEDIUM_VOL_MAX() external view returns (uint256)',
  'function MAX_STALENESS() external view returns (uint256)',
  'function MEV_THRESHOLD_BPS() external view returns (uint256)',
  'function MEV_SPIKE_FEE() external view returns (uint24)',
  'function lastBlockNumber(bytes32 poolId) external view returns (uint256)',
  'function lastPriceX96(bytes32 poolId) external view returns (uint160)'
];

const CONSUMER_ABI = [
  'function s_lastRequestId() external view returns (bytes32)',
  'function s_lastResponse() external view returns (bytes)',
  'function s_lastError() external view returns (bytes)',
  'function hook() external view returns (address)'
];

const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)'
];

// Active ethers JsonRpcProvider instance
let cachedProvider = null;
let activeRpcIndex = 0;

export function getRpcProvider() {
  if (typeof window.ethers === 'undefined') {
    console.warn('ethers.js not yet loaded on window');
    return null;
  }

  if (!cachedProvider) {
    const rpcUrl = SEPOLIA_CONFIG.rpcUrls[activeRpcIndex];
    cachedProvider = new window.ethers.JsonRpcProvider(rpcUrl, {
      chainId: SEPOLIA_CONFIG.chainId,
      name: 'sepolia'
    });
  }
  return cachedProvider;
}

export function rotateRpcProvider() {
  activeRpcIndex = (activeRpcIndex + 1) % SEPOLIA_CONFIG.rpcUrls.length;
  cachedProvider = null;
  return getRpcProvider();
}

/**
 * Fetch current block number and measure round-trip latency
 */
export async function fetchLiveBlockInfo() {
  const provider = getRpcProvider();
  if (!provider) return { blockNumber: 11679574, latencyMs: 0 };

  const start = performance.now();
  try {
    const blockNumber = await provider.getBlockNumber();
    const latencyMs = Math.round(performance.now() - start);
    return { blockNumber, latencyMs };
  } catch (err) {
    console.warn('RPC block query failed, rotating provider...', err);
    rotateRpcProvider();
    return { blockNumber: 11679574, latencyMs: 999 };
  }
}

/**
 * Read Uniswap v4 PoolManager slot0 using extsload(slot)
 * Slot calculation: keccak256(abi.encodePacked(poolId, bytes32(uint256(6))))
 */
export async function fetchLivePoolSlot0() {
  const provider = getRpcProvider();
  if (!provider || typeof window.ethers === 'undefined') return null;

  try {
    const poolManagerContract = new window.ethers.Contract(
      SEPOLIA_CONFIG.contracts.poolManager,
      POOL_MANAGER_ABI,
      provider
    );

    // Compute slot for pool state: keccak256(poolId || bytes32(6))
    const poolIdHex = SEPOLIA_CONFIG.contracts.poolId.replace('0x', '');
    const poolsSlotHex = '0000000000000000000000000000000000000000000000000000000000000006';
    const stateSlot = window.ethers.keccak256('0x' + poolIdHex + poolsSlotHex);

    const slot0Raw = await poolManagerContract.extsload(stateSlot);
    const rawBigInt = BigInt(slot0Raw);

    // Unpack Uniswap v4 slot0 layout:
    // lowest 160 bits: sqrtPriceX96
    const sqrtPriceX96 = rawBigInt & ((1n << 160n) - 1n);
    // next 24 bits: tick (int24 sign extended)
    let tick = Number((rawBigInt >> 160n) & 0xFFFFFFn);
    if (tick & 0x800000) {
      tick = tick - 0x1000000; // Sign extend negative int24
    }
    // next 24 bits: protocolFee
    const protocolFee = Number((rawBigInt >> 184n) & 0xFFFFFFn);
    // next 24 bits: lpFee
    const lpFee = Number((rawBigInt >> 208n) & 0xFFFFFFn);

    // Calculate human-readable price: (sqrtPriceX96 / 2^96)^2
    const Q96 = 2n ** 96n;
    const priceRatio = Number(sqrtPriceX96) / Number(Q96);
    const calculatedPrice = priceRatio * priceRatio;

    return {
      sqrtPriceX96: sqrtPriceX96.toString(),
      tick,
      protocolFee,
      lpFee,
      calculatedPrice: calculatedPrice > 0 ? calculatedPrice : 1.0,
      slot0Raw
    };
  } catch (err) {
    console.warn('Failed to read live slot0 from Sepolia PoolManager:', err);
    return null;
  }
}

/**
 * Read AdaptiveFeeHook live parameters and state on Sepolia
 */
export async function fetchLiveHookData() {
  const provider = getRpcProvider();
  if (!provider || typeof window.ethers === 'undefined') return null;

  try {
    const hookContract = new window.ethers.Contract(
      SEPOLIA_CONFIG.contracts.adaptiveFeeHook,
      HOOK_ABI,
      provider
    );

    const poolId = SEPOLIA_CONFIG.contracts.poolId;

    const [
      volResult,
      keeperAddress,
      keeperSet,
      lowFee,
      mediumFee,
      highFee,
      lowVolMax,
      mediumVolMax,
      maxStaleness,
      mevThresholdBps,
      mevSpikeFee,
      lastBlock,
      lastPrice
    ] = await Promise.all([
      hookContract.volatilityOf(poolId).catch(() => [0n, 0n]),
      hookContract.KEEPER().catch(() => SEPOLIA_CONFIG.contracts.volatilityConsumer),
      hookContract.keeperSet().catch(() => true),
      hookContract.LOW_FEE().catch(() => 500),
      hookContract.MEDIUM_FEE().catch(() => 3000),
      hookContract.HIGH_FEE().catch(() => 10000),
      hookContract.LOW_VOL_MAX().catch(() => 100n),
      hookContract.MEDIUM_VOL_MAX().catch(() => 500n),
      hookContract.MAX_STALENESS().catch(() => 3600n),
      hookContract.MEV_THRESHOLD_BPS().catch(() => 100n),
      hookContract.MEV_SPIKE_FEE().catch(() => 50000),
      hookContract.lastBlockNumber(poolId).catch(() => 0n),
      hookContract.lastPriceX96(poolId).catch(() => 0n)
    ]);

    const volValue = Number(volResult[0]);
    const volUpdatedAt = Number(volResult[1]) * 1000; // Convert to ms

    return {
      volatilityMetric: volValue,
      volatilityUpdatedAt: volUpdatedAt,
      keeper: keeperAddress,
      keeperSet,
      lowFee: Number(lowFee),
      mediumFee: Number(mediumFee),
      highFee: Number(highFee),
      lowVolMax: Number(lowVolMax),
      mediumVolMax: Number(mediumVolMax),
      maxStaleness: Number(maxStaleness),
      mevThresholdBps: Number(mevThresholdBps),
      mevSpikeFee: Number(mevSpikeFee),
      lastBlockNumber: Number(lastBlock),
      lastPriceX96: lastPrice.toString()
    };
  } catch (err) {
    console.warn('Failed to read live AdaptiveFeeHook data on Sepolia:', err);
    return null;
  }
}

/**
 * Fetch connected account live Sepolia balances
 */
export async function fetchLiveAccountBalances(accountAddress) {
  if (!accountAddress) return null;
  const provider = getRpcProvider();
  if (!provider || typeof window.ethers === 'undefined') return null;

  try {
    const ethBalanceRaw = await provider.getBalance(accountAddress);
    const ethBalance = parseFloat(window.ethers.formatEther(ethBalanceRaw));

    // Token balances if ERC20 deployed
    let token0Balance = 0;
    let token1Balance = 0;
    try {
      const t0 = new window.ethers.Contract(SEPOLIA_CONFIG.contracts.token0, ERC20_ABI, provider);
      const t1 = new window.ethers.Contract(SEPOLIA_CONFIG.contracts.token1, ERC20_ABI, provider);
      const [b0, b1] = await Promise.all([
        t0.balanceOf(accountAddress).catch(() => 0n),
        t1.balanceOf(accountAddress).catch(() => 0n)
      ]);
      token0Balance = parseFloat(window.ethers.formatEther(b0));
      token1Balance = parseFloat(window.ethers.formatUnits(b1, 6)); // Assuming USDC 6 decimals
    } catch (_) {}

    return {
      ethBalance: Number(ethBalance.toFixed(4)),
      token0Balance: Number(token0Balance.toFixed(2)),
      token1Balance: Number(token1Balance.toFixed(2))
    };
  } catch (err) {
    console.warn('Failed to fetch account Sepolia balances:', err);
    return null;
  }
}
