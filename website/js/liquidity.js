/* ==========================================================================
   Adaptive Volatility AMM - Liquidity Module Controller
   ========================================================================== */

import { state, subscribe, notify } from './state.js';
import { showToast } from './swap.js';

let userLpShares = 15.0; // 15 LP tokens initial simulated position
let accruedFeesETH = 0.124;
let accruedFeesUSDC = 310.00;

export function initLiquidityModule() {
  const container = document.getElementById('liquidity-container');
  if (!container) return;

  renderLiquidityView(container);
  bindLiquidityEvents();
  subscribe(() => updateLiquidityView());
  updateLiquidityView();
}

function renderLiquidityView(container) {
  container.innerHTML = `
    <div class="swap-wrapper" style="max-width:880px;margin:0 auto">
      
      <!-- Top Pool Metrics Summary -->
      <div class="grid g3" style="width:100%;margin-bottom:20px">
        <div class="stat">
          <div class="l">Total Pool TVL</div>
          <div class="v" id="liq-tvl" style="color:var(--text-primary)">$5,000,000</div>
          <div class="note" style="margin-top:4px" id="liq-reserves">1,000 ETH · 2.5M USDC</div>
        </div>
        <div class="stat">
          <div class="l">Dynamic Fee APY (Est.)</div>
          <div class="v" style="color:var(--accent-green)" id="liq-apy">26.8% <span style="font-size:12px;color:var(--accent-green)">▲ +8.4%</span></div>
          <div class="note" style="margin-top:4px">Boosted by Volatility Tiers & MEV Spikes</div>
        </div>
        <div class="stat">
          <div class="l">Unclaimed Fee Earnings</div>
          <div class="v" style="color:var(--secondary)" id="liq-unclaimed">~$620.00</div>
          <div class="note" style="margin-top:4px" id="liq-unclaimed-tokens">0.124 ETH + 310 USDC</div>
        </div>
      </div>

      <div class="grid g2" style="width:100%">
        <!-- Deposit / Withdraw Liquidity Card -->
        <div class="swap-card" style="max-width:none">
          <div class="swap-header">
            <div class="swap-title">
              <span>Manage Liquidity</span>
            </div>
            <div class="nav-links" style="padding:2px">
              <button class="nav-tab active" id="tab-add-liq" style="padding:4px 12px;font-size:12px">Deposit</button>
              <button class="nav-tab" id="tab-remove-liq" style="padding:4px 12px;font-size:12px">Withdraw</button>
            </div>
          </div>

          <!-- Deposit Section -->
          <div id="section-add-liq">
            <div class="token-input-box">
              <div class="input-top-row">
                <span>Deposit ETH</span>
                <span>Balance: <strong id="deposit-eth-bal">10.00</strong></span>
              </div>
              <div class="input-main-row">
                <input type="number" class="token-amount-input" id="input-deposit-eth" placeholder="0.0" step="any" min="0" />
                <span class="token-pill">🔷 ETH</span>
              </div>
            </div>

            <div class="token-input-box" style="margin-top:12px">
              <div class="input-top-row">
                <span>Deposit USDC (Matched at $2,500/ETH)</span>
                <span>Balance: <strong id="deposit-usdc-bal">25,000.00</strong></span>
              </div>
              <div class="input-main-row">
                <input type="number" class="token-amount-input" id="input-deposit-usdc" placeholder="0.0" step="any" min="0" />
                <span class="token-pill">💵 USDC</span>
              </div>
            </div>

            <div class="trade-details" style="margin:14px 0">
              <div class="detail-row">
                <span>Target Price Ratio</span>
                <span class="detail-val" id="liq-price-ratio">1 ETH = 2,500 USDC</span>
              </div>
              <div class="detail-row">
                <span>Hook Protection Mode</span>
                <span class="detail-val good">Active (LVR & Sandwich Shield)</span>
              </div>
              <div class="detail-row">
                <span>Est. Pool Share</span>
                <span class="detail-val" id="liq-share-est">~0.10%</span>
              </div>
            </div>

            <button class="btn-primary-action" id="btn-submit-deposit">
              <span>Deposit Liquidity</span>
            </button>
          </div>

          <!-- Withdraw Section (Hidden initially) -->
          <div id="section-remove-liq" style="display:none">
            <p class="note" style="margin-bottom:12px">Select percentage of your LP position to withdraw back to your wallet:</p>
            
            <div style="display:flex;gap:8px;margin-bottom:14px">
              <button class="btn sm ghost btn-liq-percent" data-pct="25">25%</button>
              <button class="btn sm ghost btn-liq-percent" data-pct="50">50%</button>
              <button class="btn sm ghost btn-liq-percent" data-pct="75">75%</button>
              <button class="btn sm ghost btn-liq-percent active" data-pct="100">100% (MAX)</button>
            </div>

            <div class="trade-details" style="margin:14px 0">
              <div class="detail-row">
                <span>LP Shares to Burn</span>
                <span class="detail-val" id="withdraw-shares-val">15.00 LP</span>
              </div>
              <div class="detail-row">
                <span>Est. ETH to Receive</span>
                <span class="detail-val good" id="withdraw-eth-out">~1.50 ETH</span>
              </div>
              <div class="detail-row">
                <span>Est. USDC to Receive</span>
                <span class="detail-val good" id="withdraw-usdc-out">~3,750.00 USDC</span>
              </div>
            </div>

            <button class="btn-primary-action" id="btn-submit-withdraw">
              <span>Withdraw Liquidity</span>
            </button>
          </div>
        </div>

        <!-- Position & Fee Accrual Card -->
        <div class="swap-card" style="max-width:none">
          <div class="swap-header">
            <div class="swap-title">
              <span>Your LP Position</span>
            </div>
            <span class="mode-badge" id="lp-status-badge">Earning Fees</span>
          </div>

          <div style="background:var(--bg-card-inner);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:16px;margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;margin-bottom:10px">
              <span style="font-size:13px;color:var(--text-secondary)">Your Total Staked</span>
              <strong style="font-family:var(--font-mono)" id="my-staked-val">$7,500.00</strong>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:10px">
              <span style="font-size:13px;color:var(--text-secondary)">Pool Ownership</span>
              <strong style="font-family:var(--font-mono);color:var(--primary)" id="my-pool-share">0.15%</strong>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span style="font-size:13px;color:var(--text-secondary)">Position Range</span>
              <span class="mode-badge" style="background:rgba(16,185,129,0.1);color:var(--accent-green);border-color:rgba(16,185,129,0.3)">Full Range (v4 Hook)</span>
            </div>
          </div>

          <div style="border:1px solid rgba(6,182,212,0.25);background:rgba(6,182,212,0.06);border-radius:var(--radius-md);padding:16px;margin-bottom:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <strong style="color:var(--secondary);font-size:13px">🎁 Unclaimed Fee Rewards</strong>
              <button class="btn sm" id="btn-claim-fees" style="padding:4px 10px;font-size:12px">Claim Fees</button>
            </div>
            <p style="font-size:12.5px;color:var(--text-secondary);margin:0">
              Your share of collected swap fees, including the 5.00% MEV spike taxes captured from sandwich attempts.
            </p>
          </div>

          <!-- Why LPs Earn More with AdaptiveFeeHook Callout -->
          <div style="font-size:12.5px;color:var(--text-muted);line-height:1.6">
            💡 <strong>Why LPs earn higher yields:</strong> Standard pools only collect a flat 0.30% even when volatility reaches extreme levels. AdaptiveVol AMM automatically increases fees up to 1.00% during market turbulence and taxes malicious bot traffic at 5.00%, distributing the upside directly to LPs.
          </div>
        </div>
      </div>
    </div>
  `;
}

function bindLiquidityEvents() {
  const tabAdd = document.getElementById('tab-add-liq');
  const tabRemove = document.getElementById('tab-remove-liq');
  const secAdd = document.getElementById('section-add-liq');
  const secRemove = document.getElementById('section-remove-liq');

  const inEth = document.getElementById('input-deposit-eth');
  const inUsdc = document.getElementById('input-deposit-usdc');
  const btnDeposit = document.getElementById('btn-submit-deposit');
  const btnWithdraw = document.getElementById('btn-submit-withdraw');
  const btnClaim = document.getElementById('btn-claim-fees');

  tabAdd.addEventListener('click', () => {
    tabAdd.classList.add('active');
    tabRemove.classList.remove('active');
    secAdd.style.display = 'block';
    secRemove.style.display = 'none';
  });

  tabRemove.addEventListener('click', () => {
    tabRemove.classList.add('active');
    tabAdd.classList.remove('active');
    secAdd.style.display = 'none';
    secRemove.style.display = 'block';
    updateWithdrawEstimates(100);
  });

  // Auto-ratio inputs
  inEth.addEventListener('input', () => {
    const eth = parseFloat(inEth.value) || 0;
    const price = state.pool.currentPrice;
    if (eth > 0) {
      inUsdc.value = (eth * price).toFixed(2);
    } else {
      inUsdc.value = '';
    }
  });

  inUsdc.addEventListener('input', () => {
    const usdc = parseFloat(inUsdc.value) || 0;
    const price = state.pool.currentPrice;
    if (usdc > 0) {
      inEth.value = (usdc / price).toFixed(4);
    } else {
      inEth.value = '';
    }
  });

  document.querySelectorAll('.btn-liq-percent').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.btn-liq-percent').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const pct = parseInt(btn.dataset.pct, 10);
      updateWithdrawEstimates(pct);
    });
  });

  btnDeposit.addEventListener('click', () => {
    const eth = parseFloat(inEth.value) || 0;
    const usdc = parseFloat(inUsdc.value) || 0;

    if (eth <= 0 || usdc <= 0) {
      showToast('Please enter both ETH and USDC deposit amounts', 'warn');
      return;
    }

    if (state.tokens.ETH.balance < eth || state.tokens.USDC.balance < usdc) {
      showToast('Insufficient balance for deposit', 'error');
      return;
    }

    // Deduct balances & add to pool
    state.tokens.ETH.balance -= eth;
    state.tokens.USDC.balance -= usdc;
    state.pool.reserve0 += eth;
    state.pool.reserve1 += usdc;

    const mintedShares = eth * 10;
    userLpShares += mintedShares;

    inEth.value = '';
    inUsdc.value = '';

    showToast(`Deposited ${eth} ETH + ${usdc.toLocaleString()} USDC into pool! Received ${mintedShares.toFixed(2)} LP shares.`, 'success');
    notify();
  });

  btnWithdraw.addEventListener('click', () => {
    if (userLpShares <= 0) {
      showToast('No LP shares available to withdraw', 'warn');
      return;
    }

    const activeBtn = document.querySelector('.btn-liq-percent.active');
    const pct = activeBtn ? parseInt(activeBtn.dataset.pct, 10) : 100;
    const sharesToBurn = (userLpShares * pct) / 100;

    const ethReturned = (sharesToBurn / 10);
    const usdcReturned = ethReturned * state.pool.currentPrice;

    userLpShares -= sharesToBurn;
    state.tokens.ETH.balance += ethReturned;
    state.tokens.USDC.balance += usdcReturned;
    state.pool.reserve0 -= ethReturned;
    state.pool.reserve1 -= usdcReturned;

    showToast(`Withdrew ${pct}% of liquidity position (${ethReturned.toFixed(2)} ETH + ${usdcReturned.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC)!`, 'success');
    notify();
  });

  btnClaim.addEventListener('click', () => {
    if (accruedFeesETH <= 0 && accruedFeesUSDC <= 0) {
      showToast('No unclaimed fees available', 'warn');
      return;
    }

    const eth = accruedFeesETH;
    const usdc = accruedFeesUSDC;
    state.tokens.ETH.balance += eth;
    state.tokens.USDC.balance += usdc;

    accruedFeesETH = 0;
    accruedFeesUSDC = 0;

    showToast(`Claimed ${eth.toFixed(4)} ETH and ${usdc.toFixed(2)} USDC in LP fee yields!`, 'success');
    notify();
  });
}

function updateWithdrawEstimates(pct) {
  const shares = (userLpShares * pct) / 100;
  const eth = shares / 10;
  const usdc = eth * state.pool.currentPrice;

  document.getElementById('withdraw-shares-val').textContent = `${shares.toFixed(2)} LP`;
  document.getElementById('withdraw-eth-out').textContent = `~${eth.toFixed(2)} ETH`;
  document.getElementById('withdraw-usdc-out').textContent = `~${usdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
}

function updateLiquidityView() {
  const pool = state.pool;
  const price = pool.currentPrice;

  const tvlUSD = (pool.reserve0 * price) + pool.reserve1;
  const tvlEl = document.getElementById('liq-tvl');
  if (tvlEl) {
    tvlEl.textContent = `$${tvlUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    document.getElementById('liq-reserves').textContent = `${pool.reserve0.toLocaleString(undefined, { maximumFractionDigits: 1 })} ETH · ${(pool.reserve1 / 1e6).toFixed(2)}M USDC`;
    document.getElementById('liq-price-ratio').textContent = `1 ETH = ${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
  }

  // User position
  const myEth = userLpShares / 10;
  const myUsdc = myEth * price;
  const myTotalVal = (myEth * price) + myUsdc;
  const poolSharePct = tvlUSD > 0 ? (myTotalVal / tvlUSD) * 100 : 0;

  const stakedEl = document.getElementById('my-staked-val');
  if (stakedEl) {
    stakedEl.textContent = `$${myTotalVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('my-pool-share').textContent = `${poolSharePct.toFixed(2)}%`;
    document.getElementById('deposit-eth-bal').textContent = state.tokens.ETH.balance.toFixed(4);
    document.getElementById('deposit-usdc-bal').textContent = state.tokens.USDC.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Fees
  const unclaimedUSD = (accruedFeesETH * price) + accruedFeesUSDC;
  const unclaimedEl = document.getElementById('liq-unclaimed');
  if (unclaimedEl) {
    unclaimedEl.textContent = `~$${unclaimedUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('liq-unclaimed-tokens').textContent = `${accruedFeesETH.toFixed(3)} ETH + ${accruedFeesUSDC.toFixed(2)} USDC`;
  }
}
