# CLAUDE.md

Persistent context for Claude Code on this repo. Read this before writing any code.

## What this is

A Uniswap v4 hook that adjusts swap fees based on realized volatility, and
actively dampens the sandwich/LVR pattern that volatility-only fee hooks are
otherwise exposed to. Built for ETHOnline 2026 (build window Sep 4–16, 2026).
Targeting Uniswap Foundation and The Graph partner prizes.

**Positioning — read before writing the pitch:** volatility → fee-tier mapping
alone is not novel. It's Uniswap's own documented reference pattern
(`VolatilityBasedFeeHook`), has live production deployments (Atrium Dynamic
Fee, Volatility Oracle Hook), and has been built before in hackathon/academy
settings (autopilot-hook). Don't pitch that part as the innovation — a judge
who knows the ecosystem will recognize it immediately.

The MEV dampening layer is the actual contribution: a lightweight answer to
the same sandwich/LVR problem Angstrom solves with full batch-clearing. Most
pools still ship with zero protection against this, so an accessible, simpler
mitigation has real value even though it's less complete than Angstrom's
mechanism. Lead the pitch with that, not with "we built dynamic fees."

## Architecture — primary path

1. The Graph subgraph indexes historical pool price data (offchain, continuous)
2. A keeper (Chainlink Functions or 0G — pick one on day 1, don't evaluate both)
   queries the subgraph for a volatility metric and writes it onchain with a timestamp
3. `beforeSwap()` reads the stored volatility + timestamp
4. Staleness check: if timestamp > `MAX_STALENESS`, fall back to the **high**
   fee tier. Fail-safe, not fail-open — never revert the swap, never fall back
   to a _low_ tier when data can't be trusted.
5. If fresh, map volatility → tier (low / medium / high)
6. **MEV check — independent of steps 1–5:** compare current price to the
   price at the start of this block. If the delta exceeds a threshold, override
   whatever step 5 computed with a fee spike. This is the differentiator —
   build and test it early, don't leave it for the end.
7. Swap executes at whichever fee is higher: the volatility tier or the MEV-triggered spike

## Architecture — fallback path (use if primary isn't working by day 4 of build week)

Drop The Graph + keeper. Compute volatility onchain from TWAP delta between
blocks — no external oracle, no bridge, no staleness problem because there's
nothing offchain to go stale. The MEV dampening layer is unaffected either
way — it doesn't depend on the Graph pipeline, so it works identically in both paths.

- Loses: The Graph prize eligibility
- Keeps: Uniswap Foundation eligibility, the MEV differentiator, and removes
  the hardest unsolved piece of the build
- **Decision trigger:** if step 2 of the primary path isn't reliably writing a
  value onchain by day 4, cut to this path. Don't spend more than 3–4 days on
  the bridge before deciding.

## Roles

- **LP** — deposits liquidity, benefits passively from the adaptive fee and the MEV dampening, withdraws anytime
- **Trader** — initiates swap, pays whatever fee is active at that moment (tier or MEV spike, whichever is higher)
- **Keeper/bridge** (primary path only) — fetches offchain data, writes it onchain

## Differentiator: MEV dampening (core, not stretch)

Detects abnormal same-block price movement — the front-run/back-run pattern —
and overrides the volatility tier with a fee spike. Directly targets the
documented weakness of volatility-tier-only hooks: a predictable fee curve
lets traders front-run the hike and back-run the drop. Independent of the
Graph/bridge pipeline, so it's buildable and testable regardless of which
architecture path above ends up shipping. This is the one piece of the whole
project a judge who knows the space will actually credit as new.

## Known attack surface — out of scope for hackathon MVP

Real, but not required to solve in 12 days. List these as "known limitations /
future work" in the README rather than trying to mitigate all of them:

- Fee manipulation: attacker spikes the volatility estimator artificially
- Fee curve gaming beyond the sandwich case the MEV layer already covers
- Oracle manipulation via low liquidity: thin pools are easier to move, easier to fake volatility on
- Governance risk: if fee bounds are governable, that's itself an attack
  surface — decide which params are immutable vs governable and don't leave
  it undecided in the final contract

## Tech stack

- Solidity — pin the exact version once the repo is initialized, match v4-core's pragma
- Foundry (forge / cast / anvil)
- Uniswap v4-core + v4-periphery — import from the official repo, don't hand-roll the hook interface
- The Graph (primary path) — graph-cli for the subgraph
- Chainlink Functions or 0G (primary path, bridge)
- Testnet — confirm with team / #find-a-team which testnet the event is using for v4 before writing deploy scripts

## Conventions

- Solidity Style Guide compliant
- NatSpec on all external/public functions
- CEI (checks-effects-interactions) throughout
- Reference the official v4-periphery repo for hook base contracts before writing
  custom hook logic — don't guess `IHooks` or permission flags from memory
- Every fee-tier, staleness, and MEV-override branch needs a Foundry test —
  this logic is the core of the submission and the first place a judge or
  auditor will look

## Testing

- `forge test` for unit tests
- Fork test against a real v4 pool for the swap-execution path
- Required cases:
  - fresh data → correct tier; stale data → falls back to high tier without reverting
  - exact boundary values at each tier threshold
  - same-block price delta below MEV threshold → tier applies normally
  - same-block price delta above MEV threshold → spike overrides the tier, even if the tier alone would've been low

## Commands

```
forge build
forge test -vvv
forge coverage
anvil
forge script script/Deploy.s.sol --rpc-url <testnet> --broadcast
```

## Submission checklist

- Clean commit history (judges check this — no single giant commit)
- 2–4 minute demo video — show the MEV override triggering, not just the volatility tiers changing
- Pitch framing: lead with MEV dampening as the contribution; mention the
  volatility-tier mapping as necessary infrastructure, not the headline
- Select up to 3 partner prizes on the submission form — only select The Graph
  if the primary path was actually shipped, not if you cut to fallback
- Submit via Hacker Dashboard a few hours before the Sep 16 deadline, not at the last minute
