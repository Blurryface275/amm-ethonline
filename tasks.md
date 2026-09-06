# tasks.md

Build window: Sep 4–16, 2026 (13 days). Phases are ordered — later ones assume
earlier ones are done. See `CLAUDE.md` for the full architecture, the
primary-vs-fallback decision, and why MEV dampening moved up from a stretch
goal to core.

> Note: Sep 12 (day 9) is when thesis usability-questionnaire distribution
> starts on your calendar. Budget less hook time that day — it lands in Phase 6 below.

## Phase 0 — Setup (day 1)

- [x] `forge init`, set up repo
- [x] Install Uniswap v4-core + v4-periphery as dependencies (v4-core pinned
      to the `v4.0.0` release tag — the version actually deployed onchain;
      `BaseHook`/`HookMiner` vendored from `Uniswap/v4-hooks-public` rather
      than added as a submodule, see `lib/uniswap-hooks-utils/`)
- [ ] Confirm testnet, get testnet ETH — **unconfirmed**, subgraph.yaml and
      the deploy script assume Sepolia as a placeholder pending team/
      #find-a-team confirmation
- [x] Decide: Chainlink Functions vs 0G for the bridge — went with Chainlink
      Functions (`src/VolatilityFunctionsConsumer.sol`)
- [x] Empty hook skeleton implementing `IHooks`, deploy to local anvil,
      confirm it's callable — done via `script/Deploy.s.sol` (PoolManager +
      hook + dynamic-fee pool init, all confirmed working on a local anvil node)

## Phase 1 — Core fee logic, no external data yet (day 1–2)

- [x] `beforeSwap()` with a hardcoded/mocked volatility input — skip the data source entirely for now
- [x] Fee tier mapping: low / medium / high thresholds
- [x] Unit tests at tier boundary values
- [x] Full swap working end-to-end on anvil with the mocked fee logic

## Phase 2 — MEV dampening (day 2–3) — core, build this before the data source

- [x] Track price at the start of the current block (or last N blocks)
- [x] Compare current swap price to that baseline, flag an abnormal delta
- [x] Override the tier fee with a spike when the pattern is detected
- [x] Tests: normal delta → tier applies unaffected; abnormal delta → spike
      overrides the tier even when the tier alone would be low
- [x] This doesn't depend on Phase 4's data source — that's the point, it
      survives regardless of which path Phase 4 ends up taking

## Phase 3 — Staleness handling (day 3–4)

- [x] Timestamp tracking alongside the volatility storage slot
- [x] Staleness check + fallback-to-high-tier branch
- [x] Tests: fresh path, stale path, exact boundary at `MAX_STALENESS`

## Phase 4 — Real volatility data source (day 4–7) — the risky part

- [x] Primary: subgraph indexing pool price history — scaffolded
      (`subgraph/`: schema, PoolManager Initialize/Swap mapping, manifest).
      **Not yet run through `graph codegen`/`graph build`** (no Node
      toolchain in this environment) — see `subgraph/README.md` for the two
      placeholders (network/address, hook address) that block a real deploy.
- [x] Primary: keeper script reading the subgraph, writing onchain —
      scaffolded as a Chainlink Functions consumer
      (`src/VolatilityFunctionsConsumer.sol`, DON job in
      `functions/volatility-source.js`). Consumer contract is Foundry-tested
      against a hand-written mock router (7 passing tests); the JS itself
      has not been run through Chainlink's local Functions simulator.
- [ ] **Checkpoint, day 7:** is data flowing subgraph → onchain reliably?
  - If yes → continue primary path
  - If no → stop debugging the bridge, switch to fallback now
- [ ] Fallback (if triggered): onchain TWAP delta estimator, wired directly
      into `beforeSwap()`, subgraph/keeper dropped entirely — MEV dampening
      and staleness logic from Phases 2–3 need no changes either way

## Phase 5 — Integration + fork testing (day 7–9)

- [x] Invariant test: `x*y=k` still holds after fee changes (verified strictly monotonic output reduction across fee tiers & state consistency in `test/AdaptiveFeeHookInvariants.t.sol`)
- [x] Gas cost check — measure the hook's added overhead per swap, including the MEV check (overhead is ~16.7k gas on first swap baseline, intra-block checks are ~59k gas total)
- [x] Economic MEV simulation: simulated sandwich attack demonstrates >10x penalty on attacker PnL under the 5% MEV spike override
- [ ] Fork test against testnet v4 pool (pending live testnet RPC / contract verification)

## Phase 6 — Deploy + demo prep (day 9–11)

- [x] Simple demo script or minimal frontend — show the MEV override triggering on a simulated sandwich, not just the volatility tiers changing (interactive sandbox, 4-step sandwich execution trace & demo preset loader added in `website/index.html`)
- [x] README: problem, solution, architecture diagram, known limitations (comprehensive hackathon documentation with Mermaid architecture, gas benchmarks, math invariants, and documented attack surface trade-offs in `README.md`)
- [ ] Deploy to testnet (deployment script scaffolded and tested in `script/Deploy.s.sol`; pending live Sepolia gas/funding)
- [ ] Record 2–4 min demo video (ready for recording using the web sandbox or invariant test execution logs)

## Phase 7 — Submit (day 11–13, don't wait for the deadline)

- [ ] Submit via Hacker Dashboard: repo link, description, demo video
- [ ] Pitch leads with MEV dampening, not the volatility-tier mapping
- [ ] Select Uniswap Foundation + The Graph prizes — only Graph if primary path shipped
- [ ] Submit a few hours before the Sep 16 deadline