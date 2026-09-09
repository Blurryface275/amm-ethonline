/* ==========================================================================
   AdaptiveVol AMM - Liquidity Module Controller (Soft Minimalist)
   ========================================================================== */

import { state, subscribe, notify } from './state.js';
import { showToast } from './swap.js';

let userLpShares = 15.0;
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
    <div style="max-width:960px;margin:10px auto 0;display:flex;flex-direction:column;gap:20px">
      
      <!-- Top 3 Pool Overview Stat Cards -->
      <div class="grid g3">
        <div class="stat-card">
          <div class="stat-label">Total Pool TVL</div>
          <div class="stat-val" id="liq-tvl">$5,000,000</div>
          <div class="stat-sub" id="liq-reserves">1,000.0 ETH · 2,500,000 USDC</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">Dynamic LP APY (Est.)</div>
          <div class="stat-val" style="display:flex;align-items:center;gap:8px" id="liq-apy">
            <span>26.8%</span>
            <span class="pill-badge green" style="font-size:11px">+8.4% Volatility Boost</span>
          </div>
          <div class="stat-sub">Higher yields from volatility tiers & MEV penalties</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">Unclaimed Fee Earnings</div>
          <div class="stat-val" style="color:var(--text-main)" id="liq-unclaimed">~$620.00</div>
          <div class="stat-sub" id="liq-unclaimed-tokens">0.124 ETH + 310.00 USDC</div>
        </div>
      </div>

      <!-- Main 2-Column Grid: Manage Liquidity & Position Status -->
      <div class="grid g2">
        
        <!-- Manage Liquidity Card -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">Manage Liquidity</span>
            <div style="display:flex;gap:4px;background:var(--bg-input);padding:3px;border-radius:var(--radius-md);border:1px solid var(--border-subtle)">
              <button class="nav-tab active" id="tab-add-liq" style="padding:4px 12px;font-size:12px">Deposit</button>
              <button class="nav-tab" id="tab-remove-liq" style="padding:4px 12px;font-size:12px">Withdraw</button>
            </div>
          </div>

          <!-- Deposit Section -->
          <div id="section-add-liq">
            <div class="token-field" style="margin-bottom:12px">
              <div class="token-field-header">
                <span>Deposit ETH</span>
                <span>Balance: <span id="deposit-eth-bal" style="color:var(--text-muted)">10.00</span></span>
              </div>
              <div class="token-field-row">
                <input type="number" class="token-input" id="input-deposit-eth" placeholder="0" step="any" min="0" />
                <span class="token-btn">ETH</span>
              </div>
            </div>

            <div class="token-field" style="margin-bottom:14px">
              <div class="token-field-header">
                <span>Deposit USDC (Matched at $2,500/ETH)</span>
                <span>Balance: <span id="deposit-usdc-bal" style="color:var(--text-muted)">25,000.00</span></span>
              </div>
              <div class="token-field-row">
                <input type="number" class="token-input" id="input-deposit-usdc" placeholder="0" step="any" min="0" />
                <span class="token-btn">USDC</span>
              </div>
            </div>

            <div class="info-box" style="margin-bottom:16px">
              <div class="info-row">
                <span>Target Ratio</span>
                <span class="info-val" id="liq-price-ratio">1 ETH = 2,500.00 USDC</span>
              </div>
              <div class="info-row">
                <span>Hook Protection</span>
                <span class="info-val" style="color:#34d399">Active (LVR & Sandwich Shield)</span>
              </div>
              <div class="info-row">
                <span>Estimated Share</span>
                <span class="info-val" id="liq-share-est">~0.10% of Pool</span>
              </div>
            </div>

            <button class="btn-action" id="btn-submit-deposit">
              <span>Deposit Liquidity</span>
            </button>
          </div>

          <!-- Withdraw Section -->
          <div id="section-remove-liq" style="display:none">
            <div class="token-field-header" style="margin-bottom:8px">
              <span>Select withdrawal percentage</span>
            </div>

            <div style="display:flex;gap:6px;margin-bottom:14px">
              <button class="btn-ghost btn-liq-percent" data-pct="25" style="flex:1">25%</button>
              <button class="btn-ghost btn-liq-percent" data-pct="50" style="flex:1">50%</button>
              <button class="btn-ghost btn-liq-percent" data-pct="75" style="flex:1">75%</button>
              <button class="btn-ghost btn-liq-percent active" data-pct="100" style="flex:1">100% (Max)</button>
            </div>

            <div class="info-box" style="margin-bottom:16px">
              <div class="info-row">
                <span>LP Shares to Burn</span>
                <span class="info-val" id="withdraw-shares-val">15.00 LP</span>
              </div>
              <div class="info-row">
                <span>ETH to Receive</span>
                <span class="info-val" id="withdraw-eth-out">~1.50 ETH</span>
              </div>
              <div class="info-row">
                <span>USDC to Receive</span>
                <span class="info-val" id="withdraw-usdc-out">~3,750.00 USDC</span>
              </div>
            </div>

            <button class="btn-action" id="btn-submit-withdraw">
              <span>Withdraw Liquidity</span>
            </button>
          </div>
        </div>

        <!-- Position & Fee Accrual Status -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">Your Position</span>
            <span class="pill-badge green">Earning Fees</span>
          </div>

          <div style="background:var(--bg-input);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:14px;margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px">
              <span style="color:var(--text-muted)">Staked Value</span>
              <strong id="my-staked-val" style="color:var(--text-main)">$7,500.00</strong>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px">
              <span style="color:var(--text-muted)">Pool Ownership</span>
              <strong id="my-pool-share" style="color:var(--primary)">0.15%</strong>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:13px">
              <span style="color:var(--text-muted)">Position Range</span>
              <span class="pill-badge">Full Range (v4 Hook)</span>
            </div>
          </div>

          <div style="background:var(--primary-subtle);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius-md);padding:14px;margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span style="font-weight:600;font-size:13px;color:var(--text-main)">Unclaimed Fee Yield</span>
              <button class="btn-ghost" id="btn-claim-fees" style="padding:3px 8px;font-size:11px;background:rgba(59,130,246,0.15);color:#93c5fd;border-color:rgba(59,130,246,0.3)">
                Claim
              </button>
            </div>
            <p style="font-size:12px;color:var(--text-muted);margin:0">
              Includes base swap fees plus the 5.00% MEV spike penalties collected from arbitrageurs.
            </p>
          </div>

          <div style="font-size:12px;color:var(--text-faint);line-height:1.5">
            Standard AMMs retain flat 0.30% fees regardless of risk. AdaptiveVol AMM automatically scales fee tiers up to 1.00% during turbulence and penalizes bot flow at 5.00%, shielding LPs from adverse selection.
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

  inEth.addEventListener('input', () => {
    const eth = parseFloat(inEth.value) || 0;
    const price = state.pool.currentPrice;
    inUsdc.value = eth > 0 ? (eth * price).toFixed(2) : '';
  });

  inUsdc.addEventListener('input', () => {
    const usdc = parseFloat(inUsdc.value) || 0;
    const price = state.pool.currentPrice;
    inEth.value = usdc > 0 ? (usdc / price).toFixed(4) : '';
  });

  document.querySelectorAll('.btn-liq-percent').forEach(btn => {
    btn.addEventListener('click', () => {
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
      showToast('Enter both ETH and USDC amounts to deposit', 'warn');
      return;
    }

    if (state.tokens.ETH.balance < eth || state.tokens.USDC.balance < usdc) {
      showToast('Insufficient balance for deposit', 'error');
      return;
    }

    state.tokens.ETH.balance -= eth;
    state.tokens.USDC.balance -= usdc;
    state.pool.reserve0 += eth;
    state.pool.reserve1 += usdc;

    const mintedShares = eth * 10;
    userLpShares += mintedShares;

    inEth.value = '';
    inUsdc.value = '';

    showToast(`Deposited ${eth} ETH and ${usdc.toLocaleString()} USDC into pool`, 'success');
    notify();
  });

  btnWithdraw.addEventListener('click', () => {
    if (userLpShares <= 0) {
      showToast('No LP shares to withdraw', 'warn');
      return;
    }

    const activeBtn = document.querySelector('.btn-liq-percent.active');
    const pct = activeBtn ? parseInt(activeBtn.dataset.pct, 10) : 100;
    const sharesToBurn = (userLpShares * pct) / 100;

    const ethReturned = sharesToBurn / 10;
    const usdcReturned = ethReturned * state.pool.currentPrice;

    userLpShares -= sharesToBurn;
    state.tokens.ETH.balance += ethReturned;
    state.tokens.USDC.balance += usdcReturned;
    state.pool.reserve0 -= ethReturned;
    state.pool.reserve1 -= usdcReturned;

    showToast(`Withdrew ${pct}% of position (${ethReturned.toFixed(2)} ETH + ${usdcReturned.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC)`, 'success');
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

    showToast(`Claimed ${eth.toFixed(4)} ETH and ${usdc.toFixed(2)} USDC`, 'success');
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
    document.getElementById('liq-reserves').textContent = `${pool.reserve0.toLocaleString(undefined, { maximumFractionDigits: 1 })} ETH · ${pool.reserve1.toLocaleString(undefined, { maximumFractionDigits: 0 })} USDC`;
    document.getElementById('liq-price-ratio').textContent = `1 ETH = ${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
  }

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

  const unclaimedUSD = (accruedFeesETH * price) + accruedFeesUSDC;
  const unclaimedEl = document.getElementById('liq-unclaimed');
  if (unclaimedEl) {
    unclaimedEl.textContent = `~$${unclaimedUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('liq-unclaimed-tokens').textContent = `${accruedFeesETH.toFixed(3)} ETH + ${accruedFeesUSDC.toFixed(2)} USDC`;
  }
}
