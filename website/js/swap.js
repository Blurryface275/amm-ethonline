/* ==========================================================================
   Adaptive Volatility AMM - Swap Module Controller
   ========================================================================== */

import { state, subscribe, calculateSwapOutput, executeSwap, getActiveFee, advanceBlock } from './state.js';

let currentTokenIn = 'ETH';
let currentTokenOut = 'USDC';

export function initSwapModule() {
  const container = document.getElementById('swap-container');
  if (!container) return;

  renderSwapCard(container);
  bindEvents();
  subscribe(() => updateSwapView());
  updateSwapView();
}

function renderSwapCard(container) {
  container.innerHTML = `
    <div class="swap-wrapper">
      <div class="swap-card">
        <div class="swap-header">
          <div class="swap-title">
            <span>Swap Tokens</span>
          </div>
          <div class="fee-badge-live" id="live-fee-badge" title="Dynamic LP fee calculated by AdaptiveFeeHook">
            <span class="status-dot"></span>
            <span id="fee-badge-text">0.05% Dynamic Fee</span>
          </div>
        </div>

        <!-- Token In Box -->
        <div class="token-input-box">
          <div class="input-top-row">
            <span>Pay</span>
            <span>Balance: <strong id="token-in-bal" style="color:var(--text-primary);cursor:pointer">10.00</strong></span>
          </div>
          <div class="input-main-row">
            <input type="number" class="token-amount-input" id="input-amount-in" placeholder="0.0" step="any" min="0" autocomplete="off" />
            <button class="token-pill" id="btn-select-token-in">
              <span class="token-icon" id="token-in-icon">🔷</span>
              <span id="token-in-symbol">ETH</span>
            </button>
          </div>
          <div class="input-top-row" style="margin-top:6px;margin-bottom:0">
            <span class="token-usd-val" id="token-in-usd">~$0.00</span>
            <button class="btn sm ghost" id="btn-max-in" style="padding:2px 6px;font-size:11px">MAX</button>
          </div>
        </div>

        <!-- Flip Button -->
        <button class="swap-flip-btn" id="btn-flip-tokens" title="Switch tokens">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <polyline points="19 12 12 19 5 12"></polyline>
          </svg>
        </button>

        <!-- Token Out Box -->
        <div class="token-input-box">
          <div class="input-top-row">
            <span>Receive (Estimated)</span>
            <span>Balance: <strong id="token-out-bal" style="color:var(--text-primary)">25,000.00</strong></span>
          </div>
          <div class="input-main-row">
            <input type="number" class="token-amount-input" id="input-amount-out" placeholder="0.0" readonly />
            <button class="token-pill" id="btn-select-token-out">
              <span class="token-icon" id="token-out-icon">💵</span>
              <span id="token-out-symbol">USDC</span>
            </button>
          </div>
          <div class="input-top-row" style="margin-top:6px;margin-bottom:0">
            <span class="token-usd-val" id="token-out-usd">~$0.00</span>
          </div>
        </div>

        <!-- Trade Breakdown -->
        <div class="trade-details">
          <div class="detail-row">
            <span>Exchange Rate</span>
            <span class="detail-val" id="trade-rate">—</span>
          </div>
          <div class="detail-row">
            <span>Adaptive LP Fee</span>
            <span class="detail-val" id="trade-fee">—</span>
          </div>
          <div class="detail-row">
            <span>Price Impact</span>
            <span class="detail-val" id="trade-impact">0.00%</span>
          </div>
          <div class="detail-row">
            <span>Minimum Received</span>
            <span class="detail-val" id="trade-min-out">—</span>
          </div>
          <div class="detail-row">
            <span>Block # & Baseline Status</span>
            <span class="detail-val" id="block-status">#18920420 (Clean)</span>
          </div>
        </div>

        <!-- Swap Action Button -->
        <button class="btn-primary-action" id="btn-submit-swap">
          <span>Swap Tokens</span>
        </button>
      </div>

      <!-- MEV Protection & Status Callout -->
      <div class="swap-defense-banner">
        <div class="defense-banner-icon">🛡️</div>
        <div>
          <strong style="color:var(--text-primary);display:block;margin-bottom:2px">Protected by AdaptiveFeeHook v4</strong>
          <span id="defense-banner-text">
            Pool fee actively throttles MEV bots. If an abnormal same-block price move (>100 bps) is detected, the fee spikes to 5.00% to protect your swap execution.
          </span>
          <div style="margin-top:8px">
            <button class="btn sm ghost" id="btn-sim-advance-block" style="font-size:11.5px;padding:3px 8px">
              ⏭️ Mine Next Block (Reset Baseline)
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function bindEvents() {
  const amountInput = document.getElementById('input-amount-in');
  const flipBtn = document.getElementById('btn-flip-tokens');
  const maxBtn = document.getElementById('btn-max-in');
  const swapBtn = document.getElementById('btn-submit-swap');
  const advanceBlockBtn = document.getElementById('btn-sim-advance-block');

  amountInput.addEventListener('input', () => {
    updateCalculations();
  });

  flipBtn.addEventListener('click', () => {
    const temp = currentTokenIn;
    currentTokenIn = currentTokenOut;
    currentTokenOut = temp;
    updateSwapView();
    updateCalculations();
  });

  maxBtn.addEventListener('click', () => {
    const bal = state.tokens[currentTokenIn].balance;
    amountInput.value = bal > 0 ? (bal * 0.999).toFixed(4) : 0;
    updateCalculations();
  });

  swapBtn.addEventListener('click', () => {
    handleSwapSubmission();
  });

  advanceBlockBtn.addEventListener('click', () => {
    advanceBlock();
    showToast('Block advanced! Block price baseline has been reset.', 'success');
  });
}

function updateSwapView() {
  const tokenIn = state.tokens[currentTokenIn];
  const tokenOut = state.tokens[currentTokenOut];

  document.getElementById('token-in-symbol').textContent = tokenIn.symbol;
  document.getElementById('token-in-icon').textContent = tokenIn.icon;
  document.getElementById('token-in-bal').textContent = tokenIn.balance.toLocaleString(undefined, { maximumFractionDigits: 4 });

  document.getElementById('token-out-symbol').textContent = tokenOut.symbol;
  document.getElementById('token-out-icon').textContent = tokenOut.icon;
  document.getElementById('token-out-bal').textContent = tokenOut.balance.toLocaleString(undefined, { maximumFractionDigits: 2 });

  // Update Block and Fee status
  const feeData = getActiveFee();
  const feeBadge = document.getElementById('live-fee-badge');
  const feeText = document.getElementById('fee-badge-text');

  feeText.textContent = `${(feeData.appliedFee / 10000).toFixed(2)}% ${feeData.isMevTriggered ? 'MEV SPIKE' : 'Dynamic Fee'}`;
  
  if (feeData.isMevTriggered) {
    feeBadge.classList.add('spike');
  } else {
    feeBadge.classList.remove('spike');
  }

  document.getElementById('block-status').textContent = 
    `#${state.pool.currentBlock} (${state.pool.sameBlockSwapsCount} swaps)`;
}

function updateCalculations() {
  const amountIn = parseFloat(document.getElementById('input-amount-in').value) || 0;
  const tokenIn = state.tokens[currentTokenIn];
  const tokenOut = state.tokens[currentTokenOut];

  const amountOutEl = document.getElementById('input-amount-out');
  const inUsdEl = document.getElementById('token-in-usd');
  const outUsdEl = document.getElementById('token-out-usd');
  const rateEl = document.getElementById('trade-rate');
  const feeEl = document.getElementById('trade-fee');
  const impactEl = document.getElementById('trade-impact');
  const minOutEl = document.getElementById('trade-min-out');

  if (amountIn <= 0) {
    amountOutEl.value = '';
    inUsdEl.textContent = '~$0.00';
    outUsdEl.textContent = '~$0.00';
    rateEl.textContent = '—';
    feeEl.textContent = '—';
    impactEl.textContent = '0.00%';
    minOutEl.textContent = '—';
    return;
  }

  const result = calculateSwapOutput(amountIn, currentTokenIn);
  amountOutEl.value = result.amountOut.toFixed(result.amountOut > 100 ? 2 : 5);

  inUsdEl.textContent = `~$${(amountIn * tokenIn.priceUSD).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  outUsdEl.textContent = `~$${(result.amountOut * tokenOut.priceUSD).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  rateEl.textContent = `1 ${tokenIn.symbol} ≈ ${(result.rate).toFixed(tokenIn.symbol === 'ETH' ? 2 : 6)} ${tokenOut.symbol}`;
  feeEl.textContent = `${result.appliedFeePercent}% (${result.reason})`;
  
  if (result.isMevTriggered) {
    feeEl.style.color = 'var(--accent-danger)';
  } else {
    feeEl.style.color = 'var(--accent-green)';
  }

  impactEl.textContent = `${result.priceImpact.toFixed(2)}%`;
  impactEl.className = 'detail-val ' + (result.priceImpact > 3.0 ? 'danger' : result.priceImpact > 1.0 ? 'warn' : 'good');

  const minAmountOut = result.amountOut * (1 - (state.settings.slippageBps / 10000));
  minOutEl.textContent = `${minAmountOut.toFixed(minAmountOut > 100 ? 2 : 5)} ${tokenOut.symbol}`;
}

function handleSwapSubmission() {
  const amountIn = parseFloat(document.getElementById('input-amount-in').value) || 0;
  if (amountIn <= 0) {
    showToast('Please enter an amount to swap', 'warn');
    return;
  }

  const tokenIn = state.tokens[currentTokenIn];
  if (tokenIn.balance < amountIn) {
    showToast(`Insufficient ${currentTokenIn} balance`, 'error');
    return;
  }

  const result = calculateSwapOutput(amountIn, currentTokenIn);
  const minAmountOut = result.amountOut * (1 - (state.settings.slippageBps / 10000));

  try {
    const executed = executeSwap(amountIn, currentTokenIn, minAmountOut);
    document.getElementById('input-amount-in').value = '';
    updateCalculations();
    
    if (executed.isMevTriggered) {
      showToast(`Swap executed! Note: MEV Spike Fee of 5.00% was applied due to intra-block volatility.`, 'warn');
    } else {
      showToast(`Swapped ${amountIn} ${currentTokenIn} for ${executed.amountOut.toFixed(2)} ${currentTokenOut}!`, 'success');
    }
  } catch (err) {
    showToast(err.message || 'Swap failed', 'error');
  }
}

export function showToast(message, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✅' : type === 'warn' ? '⚠️' : '❌'}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
