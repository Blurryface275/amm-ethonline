# tasks.md

Build window: Sep 4–16, 2026 (13 days). Phases are ordered — later ones assume
earlier ones are done. See `CLAUDE.md` for the full architecture, the
primary-vs-fallback decision, and why MEV dampening moved up from a stretch
goal to core.

> Note: Sep 12 (day 9) is when thesis usability-questionnaire distribution
> starts on your calendar. Budget less hook time that day — it lands in Phase 6 below.

## Phase 0 — Setup (day 1)

- [ ] `forge init`, set up repo
- [ ] Install Uniswap v4-core + v4-periphery as dependencies
- [ ] Confirm testnet, get testnet ETH
- [ ] Decide: Chainlink Functions vs 0G for the bridge — pick one, don't evaluate both
- [ ] Empty hook skeleton implementing `IHooks`, deploy to local anvil, confirm it's callable

## Phase 1 — Core fee logic, no external data yet (day 1–2)

- [ ] `beforeSwap()` with a hardcoded/mocked volatility input — skip the data source entirely for now
- [ ] Fee tier mapping: low / medium / high thresholds
- [ ] Unit tests at tier boundary values
- [ ] Full swap working end-to-end on anvil with the mocked fee logic

## Phase 2 — MEV dampening (day 2–3) — core, build this before the data source

- [ ] Track price at the start of the current block (or last N blocks)
- [ ] Compare current swap price to that baseline, flag an abnormal delta
- [ ] Override the tier fee with a spike when the pattern is detected
- [ ] Tests: normal delta → tier applies unaffected; abnormal delta → spike
      overrides the tier even when the tier alone would be low
- [ ] This doesn't depend on Phase 4's data source — that's the point, it
      survives regardless of which path Phase 4 ends up taking

## Phase 3 — Staleness handling (day 3–4)

- [ ] Timestamp tracking alongside the volatility storage slot
- [ ] Staleness check + fallback-to-high-tier branch
- [ ] Tests: fresh path, stale path, exact boundary at `MAX_STALENESS`

## Phase 4 — Real volatility data source (day 4–7) — the risky part

- [ ] Primary: subgraph indexing pool price history
- [ ] Primary: keeper script reading the subgraph, writing onchain
- [ ] **Checkpoint, day 7:** is data flowing subgraph → onchain reliably?
  - If yes → continue primary path
  - If no → stop debugging the bridge, switch to fallback now
- [ ] Fallback (if triggered): onchain TWAP delta estimator, wired directly
      into `beforeSwap()`, subgraph/keeper dropped entirely — MEV dampening
      and staleness logic from Phases 2–3 need no changes either way

## Phase 5 — Integration + fork testing (day 7–9)

- [ ] Fork test against testnet v4 pool
- [ ] Invariant test: `x*y=k` still holds after fee changes
- [ ] Gas cost check — measure the hook's added overhead per swap, including the MEV check

## Phase 6 — Deploy + demo prep (day 9–11)

- [ ] Deploy to testnet
- [ ] Simple demo script or minimal frontend — show the MEV override
      triggering on a simulated sandwich, not just the volatility tiers changing
- [ ] Record 2–4 min demo video
- [ ] README: problem, solution, architecture diagram, known limitations
      (list the attack vectors from CLAUDE.md as future work — be upfront about it)

## Phase 7 — Submit (day 11–13, don't wait for the deadline)

- [ ] Submit via Hacker Dashboard: repo link, description, demo video
- [ ] Pitch leads with MEV dampening, not the volatility-tier mapping
- [ ] Select Uniswap Foundation + The Graph prizes — only Graph if primary path shipped
- [ ] Submit a few hours before the Sep 16 deadline