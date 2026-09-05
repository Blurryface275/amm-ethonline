import { Address, BigInt } from "@graphprotocol/graph-ts";
import { Initialize, Swap as SwapEvent } from "../generated/PoolManager/PoolManager";
import { Pool, Swap } from "../generated/schema";

// PLACEHOLDER — the address AdaptiveFeeHook is actually deployed to.
// PoolManager is a singleton shared by every v4 pool on the network, not
// just ours, so this scopes indexing down to pools that use our hook:
// handleInitialize only creates a Pool entity when `hooks` matches, and
// handleSwap only records a Swap when a matching Pool entity already
// exists. Update after AdaptiveFeeHook is deployed and redeploy the
// subgraph — this cannot be templated at build time since the hook's
// address depends on the HookMiner salt chosen at deploy time.
const HOOK_ADDRESS = Address.fromString("0x0000000000000000000000000000000000000000");

export function handleInitialize(event: Initialize): void {
  if (!event.params.hooks.equals(HOOK_ADDRESS)) {
    return;
  }

  const pool = new Pool(event.params.id);
  pool.currency0 = event.params.currency0;
  pool.currency1 = event.params.currency1;
  pool.fee = event.params.fee;
  pool.tickSpacing = event.params.tickSpacing;
  pool.hooks = event.params.hooks;
  pool.createdAtBlock = event.block.number;
  pool.createdAtTimestamp = event.block.timestamp;
  pool.sqrtPriceX96 = event.params.sqrtPriceX96;
  pool.tick = event.params.tick;
  pool.swapCount = BigInt.zero();
  pool.save();
}

export function handleSwap(event: SwapEvent): void {
  const pool = Pool.load(event.params.id);
  if (pool == null) {
    // Not one of our hook's pools (see HOOK_ADDRESS above) — ignore.
    return;
  }

  const swapId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const swap = new Swap(swapId);
  swap.pool = pool.id;
  swap.sender = event.params.sender;
  swap.amount0 = event.params.amount0;
  swap.amount1 = event.params.amount1;
  swap.sqrtPriceX96 = event.params.sqrtPriceX96;
  swap.liquidity = event.params.liquidity;
  swap.tick = event.params.tick;
  swap.fee = event.params.fee;
  swap.blockNumber = event.block.number;
  swap.timestamp = event.block.timestamp;
  swap.transactionHash = event.transaction.hash;
  swap.save();

  pool.sqrtPriceX96 = event.params.sqrtPriceX96;
  pool.tick = event.params.tick;
  pool.swapCount = pool.swapCount.plus(BigInt.fromI32(1));
  pool.save();
}
