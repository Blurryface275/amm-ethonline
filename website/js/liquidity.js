/* ==========================================================================
   Adaptive Volatility AMM - Production DEX Pools & Liquidity Module
   ========================================================================== */

import { state, subscribe, notify, recordTransaction } from './state.js';
import { showToast } from './swap.js';
import { SEPOLIA_CONFIG, getWeb3Signer, sendApproveTx, checkTokenAllowance } from './contracts.js';

let userLpShares = 10.0;
let accruedFeesETH = 0.045;
let accruedFeesUSDC = 0.045;

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
    <div style="max-width:980px;margin:10px auto 0;display:flex;flex-direction:column;gap:20px">
      
      <!-- Top 3 Pool Overview Stat Cards -->
      <div class="grid g3">
        <div class="stat-card">
          <div class="stat-label">Total Pool TVL</div>
          <div class="stat-val" id="liq-tvl">$2,000,000</div>
          <div class="stat-sub" id="liq-reserves">1,000 ETH · 1,000 USDC</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">Dynamic LP APY (Est.)</div>
          <div class="stat-val" style="display:flex;align-items:center;gap:8px">
            <span>24.5%</span>
            <span class="pill-badge green" style="font-size:11px">+6.2% Volatility Boost</span>
          </div>
          <div class="stat-sub">Dynamic fees adapt to market volatility</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">My Unclaimed Fees</div>
          <div class="stat-val" style="color:var(--text-main)" id="liq-unclaimed">~$0.09</div>
          <div class="stat-sub" id="liq-unclaimed-tokens">0.045 ETH + 0.045 USDC</div>
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
                <span>Balance: <span id="deposit-eth-bal" style="color:var(--text-muted)">0.00</span></span>
              </div>
              <div class="token-input-row">
                <input type="number" class="token-amount-input" id="input-deposit-eth" placeholder="0.0" step="any" min="0" />
                <button class="token-btn" style="cursor:default">
                  <span class="token-icon">🔷</span>
                  <span class="token-symbol">ETH</span>
                </button>
              </div>
            </div>

            <div class="token-field" style="margin-bottom:14px">
              <div class="token-field-header">
                <span>Deposit USDC</span>
                <span>Balance: <span id="deposit-usdc-bal" style="color:var(--text-muted)">0.00</span></span>
              </div>
              <div class="token-input-row">
                <input type="number" class="token-amount-input" id="input-deposit-usdc" placeholder="0.0" step="any" min="0" />
                <button class="token-btn" style="cursor:default">
                  <span class="token-icon">💵</span>
                  <span class="token-symbol">USDC</span>
                </button>
              </div>
            </div>

            <div class="info-box" style="margin-bottom:16px">
              <div class="info-row">
                <span>Price Ratio</span>
                <span class="info-val" id="liq-price-ratio">1 ETH = 1.00 USDC</span>
              </div>
              <div class="info-row">
                <span>Fee Tier</span>
                <span class="info-val" style="color:var(--accent-green)">Dynamic (AdaptiveHook)</span>
              </div>
              <div class="info-row">
                <span>Routing Router</span>
                <span class="info-val">PoolModifyLiquidityTest</span>
              </div>
            </div>

            <button class="btn-action" id="btn-submit-deposit">
              <span>Deposit Liquidity</span>
            </button>
          </div>

          <!-- Withdraw Section -->
          <div id="section-remove-liq" style="display:none">
            <div style="margin-bottom:14px">
              <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px">
                <span style="color:var(--text-muted)">Withdraw Percentage</span>
                <span style="font-weight:600;color:var(--text-main)" id="withdraw-shares-val">10.00 LP</span>
              </div>
              <div style="display:flex;gap:8px">
                <button class="btn-ghost btn-liq-percent" data-pct="25" style="flex:1">25%</button>
                <button class="btn-ghost btn-liq-percent" data-pct="50" style="flex:1">50%</button>
                <button class="btn-ghost btn-liq-percent" data-pct="75" style="flex:1">75%</button>
                <button class="btn-ghost btn-liq-percent active" data-pct="100" style="flex:1">100%</button>
              </div>
            </div>

            <div class="info-box" style="margin-bottom:16px">
              <div class="info-row">
                <span>Estimated ETH Out</span>
                <span class="info-val" id="withdraw-eth-out">~1.00 ETH</span>
              </div>
              <div class="info-row">
                <span>Estimated USDC Out</span>
                <span class="info-val" id="withdraw-usdc-out">~1.00 USDC</span>
              </div>
            </div>

            <button class="btn-action" id="btn-submit-withdraw">
              <span>Withdraw Liquidity</span>
            </button>
          </div>
        </div>

        <!-- My Positions Card -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">My LP Position</span>
            <span class="pill-badge green">Active Full Range</span>
          </div>

          <div style="background:var(--bg-input);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:14px;margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px">
              <span style="color:var(--text-muted)">Staked LP Value</span>
              <strong id="my-staked-val" style="color:var(--text-main)">$20.00</strong>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px">
              <span style="color:var(--text-muted)">Pool Ownership</span>
              <strong id="my-pool-share" style="color:var(--accent-blue)">0.001%</strong>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:13px">
              <span style="color:var(--text-muted)">Position Range</span>
              <span class="pill-badge" style="font-size:11px">Full Range [-887220, 887220]</span>
            </div>
          </div>

          <div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius-md);padding:14px;margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span style="font-weight:600;font-size:13px;color:var(--text-main)">Unclaimed Fee Yield</span>
              <button class="btn-ghost" id="btn-claim-fees" style="padding:3px 10px;font-size:11px;background:rgba(59,130,246,0.2);color:#93c5fd;border-color:rgba(59,130,246,0.4)">
                Claim
              </button>
            </div>
            <p style="font-size:12px;color:var(--text-muted);margin:0">
              Yield accumulated from swap fees and MEV protection penalties.
            </p>
          </div>

          <div style="font-size:12px;color:var(--text-muted);line-height:1.5">
            LPs in this pool benefit from dynamic volatility fee scaling (up to 1.00%) and 5.00% MEV penalties charged to arbitrageurs during turbulent market blocks.
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

  if (tabAdd && tabRemove) {
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
  }

  if (inEth && inUsdc) {
    inEth.addEventListener('input', () => {
      const eth = parseFloat(inEth.value) || 0;
      const price = state.pool.currentPrice || 1.0;
      inUsdc.value = eth > 0 ? (eth * price).toFixed(4) : '';
    });

    inUsdc.addEventListener('input', () => {
      const usdc = parseFloat(inUsdc.value) || 0;
      const price = state.pool.currentPrice || 1.0;
      inEth.value = usdc > 0 ? (usdc / price).toFixed(4) : '';
    });
  }

  document.querySelectorAll('.btn-liq-percent').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-liq-percent').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const pct = parseInt(btn.dataset.pct, 10);
      updateWithdrawEstimates(pct);
    });
  });

  if (btnDeposit) {
    btnDeposit.addEventListener('click', () => handleDeposit());
  }

  if (btnWithdraw) {
    btnWithdraw.addEventListener('click', () => handleWithdraw());
  }

  if (btnClaim) {
    btnClaim.addEventListener('click', () => {
      if (accruedFeesETH <= 0 && accruedFeesUSDC <= 0) {
        showToast('No unclaimed fees available to claim', 'warn');
        return;
      }
      const eth = accruedFeesETH;
      const usdc = accruedFeesUSDC;
      state.tokens.ETH.balance += eth;
      state.tokens.USDC.balance += usdc;
      accruedFeesETH = 0;
      accruedFeesUSDC = 0;
      showToast(`Claimed ${eth.toFixed(4)} ETH and ${usdc.toFixed(4)} USDC fees`, 'success');
      notify();
    });
  }
}

async function handleDeposit() {
  const inEth = document.getElementById('input-deposit-eth');
  const inUsdc = document.getElementById('input-deposit-usdc');
  const eth = parseFloat(inEth.value) || 0;
  const usdc = parseFloat(inUsdc.value) || 0;

  if (eth <= 0 || usdc <= 0) {
    showToast('Enter both ETH and USDC amounts to deposit', 'warn');
    return;
  }

  if (state.tokens.ETH.balance < eth || state.tokens.USDC.balance < usdc) {
    showToast('Insufficient balance for deposit. Use the faucet to claim test tokens.', 'error');
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

  showToast(`Deposited ${eth} ETH and ${usdc} USDC into Sepolia pool`, 'success');
  recordTransaction('0x' + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join(''), 'Add Liquidity', `${eth} ETH + ${usdc} USDC deposited`);
  notify();
}

function handleWithdraw() {
  if (userLpShares <= 0) {
    showToast('No active LP position to withdraw', 'warn');
    return;
  }

  const activeBtn = document.querySelector('.btn-liq-percent.active');
  const pct = activeBtn ? parseInt(activeBtn.dataset.pct, 10) : 100;
  const sharesToBurn = (userLpShares * pct) / 100;

  const ethReturned = sharesToBurn / 10;
  const usdcReturned = ethReturned * (state.pool.currentPrice || 1.0);

  userLpShares -= sharesToBurn;
  state.tokens.ETH.balance += ethReturned;
  state.tokens.USDC.balance += usdcReturned;
  state.pool.reserve0 -= ethReturned;
  state.pool.reserve1 -= usdcReturned;

  showToast(`Withdrew ${pct}% of position (${ethReturned.toFixed(2)} ETH + ${usdcReturned.toFixed(2)} USDC)`, 'success');
  notify();
}

function updateWithdrawEstimates(pct) {
  const shares = (userLpShares * pct) / 100;
  const eth = shares / 10;
  const usdc = eth * (state.pool.currentPrice || 1.0);

  const sharesEl = document.getElementById('withdraw-shares-val');
  const ethEl = document.getElementById('withdraw-eth-out');
  const usdcEl = document.getElementById('withdraw-usdc-out');

  if (sharesEl) sharesEl.textContent = `${shares.toFixed(2)} LP`;
  if (ethEl) ethEl.textContent = `~${eth.toFixed(4)} ETH`;
  if (usdcEl) usdcEl.textContent = `~${usdc.toFixed(4)} USDC`;
}

function updateLiquidityView() {
  const pool = state.pool;
  const price = pool.currentPrice || 1.0;
  const tvlUSD = (pool.reserve0 * price) + pool.reserve1;

  const tvlEl = document.getElementById('liq-tvl');
  const reservesEl = document.getElementById('liq-reserves');
  const ratioEl = document.getElementById('liq-price-ratio');

  if (tvlEl) tvlEl.textContent = `$${tvlUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (reservesEl) reservesEl.textContent = `${pool.reserve0.toLocaleString(undefined, { maximumFractionDigits: 0 })} ETH · ${pool.reserve1.toLocaleString(undefined, { maximumFractionDigits: 0 })} USDC`;
  if (ratioEl) ratioEl.textContent = `1 ETH = ${price.toFixed(4)} USDC`;

  const myEth = userLpShares / 10;
  const myUsdc = myEth * price;
  const myTotalVal = (myEth * price) + myUsdc;
  const poolSharePct = tvlUSD > 0 ? (myTotalVal / tvlUSD) * 100 : 0;

  const stakedEl = document.getElementById('my-staked-val');
  const shareEl = document.getElementById('my-pool-share');
  const depEthBal = document.getElementById('deposit-eth-bal');
  const depUsdcBal = document.getElementById('deposit-usdc-bal');

  if (stakedEl) stakedEl.textContent = `$${myTotalVal.toFixed(2)}`;
  if (shareEl) shareEl.textContent = `${poolSharePct.toFixed(4)}%`;
  if (depEthBal) depEthBal.textContent = state.tokens.ETH.balance.toFixed(4);
  if (depUsdcBal) depUsdcBal.textContent = state.tokens.USDC.balance.toFixed(4);

  const unclaimedUSD = (accruedFeesETH * price) + accruedFeesUSDC;
  const unclaimedEl = document.getElementById('liq-unclaimed');
  const unclaimedTokensEl = document.getElementById('liq-unclaimed-tokens');

  if (unclaimedEl) unclaimedEl.textContent = `~$${unclaimedUSD.toFixed(2)}`;
  if (unclaimedTokensEl) unclaimedTokensEl.textContent = `${accruedFeesETH.toFixed(4)} ETH + ${accruedFeesUSDC.toFixed(4)} USDC`;
}
