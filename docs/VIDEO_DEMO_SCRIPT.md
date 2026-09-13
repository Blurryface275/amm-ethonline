# Video Demo Recording Script: Adaptive Volatility AMM (Uniswap v4 Hook)

> **Format:** Spoken Voiceover Script with Visual Screen Transitions  
> **Target Duration:** 3 Minutes 45 Seconds (Strictly Under 4 Minutes)  
> **Target Pace:** Natural, confident, clear conversational pace (~135–140 words per minute)  
> **Speaker Notes:** Pronounce key terms clearly (*Uniswap v4*, *MEV*, *Etherscan*, *Chainlink Functions*, *The Graph*).

---

## [00:00 – 00:25] Scene 1: Introduction & The Core Problem

**🎙️ Voiceover (Script):**  
"Hello everyone! Welcome to Adaptive DEX. In conventional AMMs like Uniswap v2 and v3, liquidity pools are locked into rigid, static swap fees like zero-point-three percent. When markets are calm, this fee is too expensive for traders. But when volatility spikes, it is far too cheap—allowing toxic MEV arbitrageurs to exploit liquidity providers, causing massive Loss-Versus-Rebalancing, or LVR. Today, we have solved this with our Uniswap v4 Adaptive Fee Hook."

![01_swap_interface_initial](https://raw.githubusercontent.com/Blurryface275/amm-ethonline/main/docs/images/01_swap_interface_initial.png)

---

## [00:25 – 00:55] Scene 2: Product Walkthrough — Seamless Native ETH Swap

**🎙️ Voiceover (Script):**  
"Here is the Adaptive DEX live on Ethereum Sepolia Testnet. Notice our real-time RPC telemetry and native balance integration. Unlike older DEXs that force users to wrap their ETH into WETH, Uniswap v4 lets us swap Native Sepolia ETH directly with zero token approval needed! When I enter zero-point-zero-zero-zero-one ETH, the protocol instantly calculates the exact mid-price of twenty-four hundred and twenty USDC per ETH, showing negligible price impact and dynamic fee protection."

![02_swap_with_amount](https://raw.githubusercontent.com/Blurryface275/amm-ethonline/main/docs/images/02_swap_with_amount.png)

---

## [00:55 – 01:25] Scene 3: Unique Feature — Active Intra-Block MEV Shield

**🎙️ Voiceover (Script):**  
"Now, what makes our protocol truly unique is our active MEV Shield. Most dynamic fee models only track historical volatility, leaving them blind to same-block sandwich attacks. In our MEV Shield Lab, we demonstrate how our hook takes an atomic price baseline at the start of every block. If subsequent trades within that same block push price deviation past one hundred basis points, our hook instantly triggers a punitive five percent fee spike—turning typical sandwich bot profits into heavy net losses!"

![08_mev_shield_lab](https://raw.githubusercontent.com/Blurryface275/amm-ethonline/main/docs/images/08_mev_shield_lab.png)

---

## [01:25 – 01:55] Scene 4: The Decentralized Oracle Pipeline

**🎙️ Voiceover (Script):**  
"To price macro volatility trustlessly, we built a hybrid pipeline combining The Graph and Chainlink Functions. Our dedicated Subgraph indexes swap events directly from the Uniswap v4 PoolManager singleton. Then, a Chainlink Functions DON queries recent swap log-returns, computes true annualized price variance, and pushes the realized volatility metric on-chain directly into our hook. If the oracle ever goes stale, our built-in circuit breaker safely defaults to a defensive high fee tier without breaking swaps."

![09_contracts_oracle_telemetry](https://raw.githubusercontent.com/Blurryface275/amm-ethonline/main/docs/images/09_contracts_oracle_telemetry.png)

---

## [01:55 – 02:25] Scene 5: Dynamic Volatility Tiers & Protocol Analytics

**🎙️ Voiceover (Script):**  
"On the Explore tab, we can monitor the entire protocol state. The hook classifies market conditions into three responsive tiers: a low tier of zero-point-zero-five percent for calm markets, a medium tier of zero-point-thirty percent, and a high tier of one percent during market turbulence. Because the pool was initialized with the dynamic fee flag, Uniswap v4 delegates fee determination entirely to our hook on every single swap."

![06_analytics_explore](https://raw.githubusercontent.com/Blurryface275/amm-ethonline/main/docs/images/06_analytics_explore.png)

---

## [02:25 – 02:55] Scene 6: On-Chain Proof — Transaction 1 (Normal 1.00% Fee)

**🎙️ Voiceover (Script):**  
"Now, let us verify this live on-chain on Sepolia Etherscan. Here is our first live swap transaction hash: zero-x-three-b-three-zero. The transaction succeeded on block eleven-million-six-hundred-eighty-nine-thousand. In the transaction event logs, look at the FeeApplied event emitted by our verified hook. It records tier-fee ten-thousand—which is one percent—applied-fee ten-thousand, and mev-triggered equals False. This proves our baseline dynamic tier in action."

![03_tx1_overview](https://raw.githubusercontent.com/Blurryface275/amm-ethonline/main/docs/images/03_tx1_overview.png)
![04_tx1_fee_applied](https://raw.githubusercontent.com/Blurryface275/amm-ethonline/main/docs/images/04_tx1_fee_applied.png)

---

## [02:55 – 03:25] Scene 7: On-Chain Proof — Transaction 2 (Dynamic 5.00% MEV Spike!)

**🎙️ Voiceover (Script):**  
"And here is the definitive proof of our dynamic mechanism! Immediately in that exact same block, a second swap was executed with transaction hash zero-x-one-c-zero-zero. Because this second trade created an intra-block price deviation exceeding our threshold, inspect the FeeApplied event: tier-fee was ten-thousand, but applied-fee dynamically spiked five-fold to fifty-thousand—which is five percent!—with mev-triggered equal to True. The hook overrode the fee dynamically via Uniswap v4's override flag!"

![05_tx2_mev_spike_fee](https://raw.githubusercontent.com/Blurryface275/amm-ethonline/main/docs/images/05_tx2_mev_spike_fee.png)

---

## [03:25 – 03:45] Scene 8: Liquidity Provider Protection & Conclusion

**🎙️ Voiceover (Script):**  
"That five percent penalty fee does not disappear—it flows directly into the liquidity pool, boosting LP yields and compensating them for toxic order flow. With thirty-four passing Foundry tests and full Sepolia deployment, Adaptive DEX proves that dynamic hooks and active MEV dampening are the future of decentralized exchange. Thank you for watching!"

![07_analytics_pools](https://raw.githubusercontent.com/Blurryface275/amm-ethonline/main/docs/images/07_analytics_pools.png)

---

### Quick Recording Checklist for the Presenter:
- [ ] **Target Run Time:** ~3m 30s to 3m 45s.
- [ ] **Tab 1:** DEX Swap Interface (`http://localhost:8085/`)
- [ ] **Tab 2:** MEV Shield Lab Tab
- [ ] **Tab 3:** Contracts & Oracle Telemetry Tab
- [ ] **Tab 4:** Sepolia Etherscan Tx 1 (`0x3b30...eec5#eventlog`)
- [ ] **Tab 5:** Sepolia Etherscan Tx 2 (`0x1c00...f193#eventlog`)
