// Executed by the Chainlink Functions DON (one run per VolatilityFunctionsConsumer.requestVolatility call).
// Queries this project's subgraph for a pool's recent swaps and returns
// realized volatility, in basis points of price standard deviation over the
// sampled window, as an ABI-encoded uint256.
//
// bytesArgs[0]: the pool id (bytes32), matching PoolManager's Swap/Initialize event `id`.
//
// AdaptiveFeeHook.sol treats volatility as an opaque uint256 compared
// against LOW_VOLATILITY_MAX / MEDIUM_VOLATILITY_MAX — those thresholds
// must be configured in the same "bps of price stddev" unit this script
// returns.
//
// Not yet run against Chainlink's local Functions simulator (that requires
// the @chainlink/functions-toolkit npm package, not part of this Foundry
// repo) — validate with it before pointing a real subscription at this
// source. See subgraph/schema.graphql for the Swap entity queried below.

const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/REPLACE_ME/adaptive-fee-hook/version/latest";
const SAMPLE_SIZE = 30; // most recent swaps to sample

if (!bytesArgs || bytesArgs.length < 1) {
  throw Error("missing pool id arg");
}
const poolId = bytesArgs[0];

const query = `
  query RecentSwaps($poolId: Bytes!, $first: Int!) {
    swaps(
      where: { pool: $poolId }
      orderBy: blockNumber
      orderDirection: desc
      first: $first
    ) {
      sqrtPriceX96
      blockNumber
    }
  }
`;

const response = await Functions.makeHttpRequest({
  url: SUBGRAPH_URL,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  data: { query, variables: { poolId, first: SAMPLE_SIZE } },
});

if (response.error) {
  throw Error(`subgraph request failed: ${JSON.stringify(response.error)}`);
}

const swaps = response.data?.data?.swaps ?? [];
if (swaps.length < 2) {
  // Not enough history to estimate volatility yet — report zero rather
  // than guessing. This only fires for a brand-new pool; AdaptiveFeeHook's
  // own staleness fallback (not this script) is what protects against a
  // volatility reading that's missing or wrong once the pool is live.
  return Functions.encodeUint256(0);
}

// The subgraph returns most-recent-first; reverse to compute returns in
// chronological order.
const prices = swaps.map((s) => Number(BigInt(s.sqrtPriceX96))).reverse();

const logReturns = [];
for (let i = 1; i < prices.length; i++) {
  logReturns.push(Math.log(prices[i] / prices[i - 1]));
}

const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
const variance = logReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / logReturns.length;
const stdDev = Math.sqrt(variance);

// sqrtPriceX96 moves at roughly half the rate of the underlying price for
// small moves (price = sqrtPrice^2 up to fixed-point scaling), so this
// doubles the sqrtPrice-return stddev to report volatility in terms of the
// underlying price, then scales to basis points.
const volatilityBps = Math.max(0, Math.round(stdDev * 2 * 10000));

return Functions.encodeUint256(volatilityBps);
