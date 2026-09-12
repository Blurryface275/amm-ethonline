/* ==========================================================================
   Adaptive Volatility AMM - Sepolia Testnet Contracts & Web3 Services
   ========================================================================== */

export const SEPOLIA_CONFIG = {
  chainId: 11155111,
  chainIdHex: '0xaa36a7',
  networkName: 'Ethereum Sepolia Testnet',
  blockExplorerUrl: 'https://sepolia.etherscan.io',
  
  rpcUrls: [
    'https://eth-sepolia.g.alchemy.com/v2/uLr2P86TqWknPAkOy_p0p',
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://rpc.sepolia.org',
    'https://sepolia.drpc.org'
  ],

  contracts: {
    poolManager: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543',
    adaptiveFeeHook: '0xab4c103d0b4783d736e12ea01a98945f08122080',
    volatilityConsumer: '0xbB833c9853587f5C562B407D2D95B0f0509AB733',
    token0: '0x0000000000000000000000000000000000000000', // Native Sepolia ETH
    token1: '0xCb5C55727ABc3067BC7E26b66ad0f5140Af0e64a', // USDC Mock (18 dec)
    poolId: '0xbcbe7126c965bfb0e5220eaeb1c4ff402c37ae1f7bb654ff4bcf4a5632542bab',
    poolSwapTest: '0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe',
    modifyLiquidityRouter: '0x0C478023803a644c94c4CE1C1e7b9A087e411B0A',
    tickSpacing: 60,
    dynamicFeeFlag: 8388608
  }
};

export const POOL_MANAGER_ABI = [
  'function extsload(bytes32 slot) external view returns (bytes32)'
];

export const HOOK_ABI = [
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

export const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function mint(address to, uint256 amount) external'
];

export const POOL_SWAP_TEST_ABI = [
  'function swap((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, (bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96) params, (bool takeClaims, bool settleUsingBurn) testSettings, bytes hookData) external payable returns (int256 delta)'
];

export const POOL_MODIFY_LIQUIDITY_ABI = [
  'function modifyLiquidity((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, (int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt) params, bytes hookData) external payable returns (int256 delta)'
];

export const MIN_SQRT_PRICE_LIMIT = 4295128740n;
export const MAX_SQRT_PRICE_LIMIT = 1461446703485210103287273052203988822378723970341n;

let cachedProvider = null;
let activeRpcIndex = 0;

export function getRpcProvider() {
  if (typeof window.ethers === 'undefined') return null;
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

export async function getWeb3Signer() {
  if (typeof window.ethereum === 'undefined' || typeof window.ethers === 'undefined') return null;
  const browserProvider = new window.ethers.BrowserProvider(window.ethereum);
  return await browserProvider.getSigner();
}

export async function fetchLiveBlockInfo() {
  const provider = getRpcProvider();
  if (!provider) return { blockNumber: 11680100, latencyMs: 0 };

  const start = performance.now();
  try {
    const blockNumber = await provider.getBlockNumber();
    const latencyMs = Math.round(performance.now() - start);
    return { blockNumber, latencyMs };
  } catch (err) {
    rotateRpcProvider();
    return { blockNumber: 11680100, latencyMs: 999 };
  }
}

export async function fetchLivePoolSlot0() {
  const provider = getRpcProvider();
  if (!provider || typeof window.ethers === 'undefined') return null;

  try {
    const poolManagerContract = new window.ethers.Contract(
      SEPOLIA_CONFIG.contracts.poolManager,
      POOL_MANAGER_ABI,
      provider
    );

    const poolIdHex = SEPOLIA_CONFIG.contracts.poolId.replace('0x', '');
    const poolsSlotHex = '0000000000000000000000000000000000000000000000000000000000000006';
    const stateSlot = window.ethers.keccak256('0x' + poolIdHex + poolsSlotHex);

    const slot0Raw = await poolManagerContract.extsload(stateSlot);
    const rawBigInt = BigInt(slot0Raw);

    const sqrtPriceX96 = rawBigInt & ((1n << 160n) - 1n);
    let tick = Number((rawBigInt >> 160n) & 0xFFFFFFn);
    if (tick & 0x800000) {
      tick = tick - 0x1000000;
    }
    const protocolFee = Number((rawBigInt >> 184n) & 0xFFFFFFn);
    const lpFee = Number((rawBigInt >> 208n) & 0xFFFFFFn);

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
    console.warn('Failed to read live slot0:', err);
    return null;
  }
}

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

    return {
      volatilityMetric: Number(volResult[0]),
      volatilityUpdatedAt: Number(volResult[1]) * 1000,
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
    console.warn('Failed to read live Hook data:', err);
    return null;
  }
}

export async function fetchLiveAccountBalances(accountAddress) {
  if (!accountAddress) return null;

  let ethBalance = 0;

  // 1. Query Native Sepolia ETH balance
  if (typeof window.ethereum !== 'undefined' && typeof window.ethers !== 'undefined') {
    try {
      const hex = await window.ethereum.request({
        method: 'eth_getBalance',
        params: [accountAddress, 'latest']
      });
      if (hex) {
        ethBalance = parseFloat(window.ethers.formatEther(hex));
      }
    } catch (_) {}
  }

  const provider = getRpcProvider();
  if (ethBalance === 0 && provider && typeof window.ethers !== 'undefined') {
    try {
      const bRaw = await provider.getBalance(accountAddress);
      ethBalance = parseFloat(window.ethers.formatEther(bRaw));
    } catch (_) {}
  }

  // 2. Query USDC token balance
  let token1Balance = 0;
  try {
    let ercProvider = null;
    if (typeof window.ethereum !== 'undefined' && typeof window.ethers !== 'undefined') {
      ercProvider = new window.ethers.BrowserProvider(window.ethereum);
    } else {
      ercProvider = provider;
    }

    if (ercProvider && typeof window.ethers !== 'undefined') {
      const t1 = new window.ethers.Contract(SEPOLIA_CONFIG.contracts.token1, ERC20_ABI, ercProvider);
      const b1 = await t1.balanceOf(accountAddress).catch(() => 0n);
      token1Balance = parseFloat(window.ethers.formatEther(b1));
    }
  } catch (err) {
    console.warn('USDC balance check error:', err);
  }

  return {
    ethBalance: Number(ethBalance.toFixed(4)),
    token0Balance: Number(ethBalance.toFixed(4)), // Token0 IS native Sepolia ETH
    token1Balance: Number(token1Balance.toFixed(4))
  };
}

export async function checkTokenAllowance(accountAddress, tokenAddress, spenderAddress) {
  if (!accountAddress) return 0n;
  // Native ETH requires no ERC20 approval
  if (!tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000') {
    return window.ethers ? window.ethers.MaxUint256 : 115792089237316195423570985008687907853269984665640564039457584007913129639935n;
  }
  try {
    let provider = null;
    if (typeof window.ethereum !== 'undefined' && typeof window.ethers !== 'undefined') {
      provider = new window.ethers.BrowserProvider(window.ethereum);
    } else {
      provider = getRpcProvider();
    }
    if (!provider) return 0n;
    const contract = new window.ethers.Contract(tokenAddress, ERC20_ABI, provider);
    return await contract.allowance(accountAddress, spenderAddress);
  } catch (_) {
    return 0n;
  }
}

export async function sendApproveTx(signer, tokenAddress, spenderAddress) {
  const contract = new window.ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const maxUint256 = window.ethers.MaxUint256;
  const tx = await contract.approve(spenderAddress, maxUint256);
  return tx;
}

export async function sendSwapTx(signer, zeroForOne, amountInWei) {
  const poolSwapContract = new window.ethers.Contract(
    SEPOLIA_CONFIG.contracts.poolSwapTest,
    POOL_SWAP_TEST_ABI,
    signer
  );

  const poolKey = [
    SEPOLIA_CONFIG.contracts.token0,
    SEPOLIA_CONFIG.contracts.token1,
    SEPOLIA_CONFIG.contracts.dynamicFeeFlag,
    SEPOLIA_CONFIG.contracts.tickSpacing,
    SEPOLIA_CONFIG.contracts.adaptiveFeeHook
  ];

  const sqrtPriceLimit = zeroForOne ? MIN_SQRT_PRICE_LIMIT : MAX_SQRT_PRICE_LIMIT;
  const swapParams = [
    zeroForOne,
    -BigInt(amountInWei),
    sqrtPriceLimit
  ];

  const testSettings = [
    false,
    false
  ];

  // If paying Native Sepolia ETH (zeroForOne), attach msg.value!
  const overrides = zeroForOne ? { value: BigInt(amountInWei) } : {};

  const tx = await poolSwapContract.swap(poolKey, swapParams, testSettings, '0x', overrides);
  return tx;
}

export async function sendClaimFaucetTx(signer, recipientAddress, tokenChoice = 'USDC') {
  const amount = window.ethers.parseEther('1000');
  const t1 = new window.ethers.Contract(SEPOLIA_CONFIG.contracts.token1, ERC20_ABI, signer);
  return await t1.mint(recipientAddress, amount);
}
