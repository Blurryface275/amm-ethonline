# Adaptive Fee Hook subgraph

Indexes raw Uniswap v4 `PoolManager` price history (`Initialize` and `Swap`
events) for pools that use `AdaptiveFeeHook`. This is deliberately a thin
indexer: it records what happened onchain and nothing more. Turning that
history into a volatility metric is `functions/volatility-source.js`'s job,
run by the Chainlink Functions DON, not this subgraph's.

## Two placeholders that must be filled in before this deploys

1. **`subgraph.yaml`**: `network` and `source.address` are placeholders
   (`sepolia` / the zero address). claude.md flags the testnet choice as
   something to confirm with the event organizers before writing deploy
   scripts — `network` should become whichever testnet that is, and
   `source.address` the actual `PoolManager` address on it.
2. **`src/mapping.ts`**: `HOOK_ADDRESS` is the zero address. `PoolManager` is
   a singleton shared by every v4 pool on the network, not just this
   project's, so the mapping scopes indexing down to pools that use our hook
   by comparing `Initialize`'s `hooks` field against this constant. It can't
   be templated at build time since the hook's address depends on the
   `HookMiner` salt chosen at deploy time — fill it in once `AdaptiveFeeHook`
   is actually deployed, then redeploy the subgraph.

## Not yet verified

`graph codegen` / `graph build` have not been run — this repo has no Node
toolchain installed, so `src/mapping.ts`'s use of the generated
`../generated/PoolManager/PoolManager` and `../generated/schema` bindings is
written to the well-established graph-ts conventions (integer types →
`BigInt`, `address`/`bytes32` → `Address`/`Bytes`) but hasn't been compiled.
Run `npm install && npm run codegen && npm run build` here before deploying,
and fix up anything AssemblyScript's stricter type-checking flags.

## Workflow once the placeholders are filled in

```
cd subgraph
npm install
npm run codegen
npm run build
npm run deploy   # requires `graph auth` against Subgraph Studio first
```

## Why volatility computation lives in the keeper, not here

AssemblyScript (the subgraph mapping language) has no floating-point-free
standard deviation story worth trusting for a fee-determining calculation,
and every subgraph redeploy costs a resync. Keeping this subgraph a pure
event mirror means the volatility formula in
`functions/volatility-source.js` can change freely without ever touching
the indexer.
