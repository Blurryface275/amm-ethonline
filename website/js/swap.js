/* ==========================================================================
   Adaptive Volatility AMM - Swap Module Controller (Soft Minimalist)
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
    <div class="swap-container-box">
      <div class="swap-panel">
        <div class="card-header">
          <span class="card-title">Swap</span>
          <div class="pill-badge green" id="live-fee-badge" title="Dynamic LP fee calculated by AdaptiveFeeHook">
            <span class="status-dot"></span>
            <span id="fee-badge-text">0.05% Dynamic Fee</span>
          </div>
        </div>

        <!-- Token In -->
        <div class="token-field">
          <div class="token-field-header">
            <span>You pay</span>
            <span>Balance: <span id="token-in-bal" style="color:var(--text-muted);cursor:pointer;font-weight:500">10.00</span></span>
          </div>
          <div class="token-field-row">
            <input type="number" class="token-input" id="input-amount-in" placeholder="0" step="any" min="0" autocomplete="off" />
            <button class="token-btn" id="btn-select-token-in">
              <span id="token-in-icon">ETH</span>
              <span id="token-in-symbol">ETH</span>
            </button>
          </div>
          <div class="token-field-header" style="margin-top:6px;margin-bottom:0">
            <span class="token-usd-sub" id="token-in-usd">~$0.00</span>
            <button class="btn-ghost" id="btn-max-in" style="padding:1px 6px;font-size:11px">Max</button>
          </div>
        </div>

        <!-- Switch Button -->
        <button class="swap-switch-btn" id="btn-flip-tokens" title="Switch tokens">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </button>

        <!-- Token Out -->
        <div class="token-field">
          <div class="token-field-header">
            <span>You receive</span>
            <span>Balance: <span id="token-out-bal" style="color:var(--text-muted);font-weight:500">25,000.00</span></span>
          </div>
          <div class="token-field-row">
            <input type="number" class="token-input" id="input-amount-out" placeholder="0" readonly />
            <button class="token-btn" id="btn-select-token-out">
              <span id="token-out-icon">USDC</span>
              <span id="token-out-symbol">USDC</span>
            </button>
          </div>
          <div class="token-field-header" style="margin-top:6px;margin-bottom:0">
            <span class="token-usd-sub" id="token-out-usd">~$0.00</span>
          </div>
        </div>

        <!-- Details Accordion -->
        <div class="info-box">
          <div class="info-row">
            <span>Rate</span>
            <span class="info-val" id="trade-rate">—</span>
          </div>
          <div class="info-row">
            <span>Dynamic LP Fee</span>
            <span class="info-val" id="trade-fee">—</span>
          </div>
          <div class="info-row">
            <span>Price Impact</span>
            <span class="info-val" id="trade-impact">0.00%</span>
          </div>
          <div class="info-row">
            <span>Min. Received</span>
            <span class="info-val" id="trade-min-out">—</span>
          </div>
          <div class="info-row">
            <span>Current Block</span>
            <span class="info-val" id="block-status">#18920420</span>
          </div>
        </div>

        <!-- Submit Button -->
        <button class="btn-action" id="btn-submit-swap">
          <span>Swap</span>
        </button>
      </div>

      <!-- Clean Shield Callout -->
      <div class="shield-banner">
        <div class="shield-icon">🛡</div>
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-weight:600;color:var(--text-main)">MEV Dampening Active</span>
            <button class="btn-ghost" id="btn-sim-advance-block" style="font-size:11px;padding:2px 8px">
              Mine Next Block
            </button>
          </div>
          <span>
            If intra-block price movement exceeds 100 bps, the swap fee spikes to 5.00% to protect swappers and LPs against sandwich attacks.
          </span>
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

  amountInput.addEventListener('input', () => updateCalculations());

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

  swapBtn.addEventListener('click', () => handleSwapSubmission());

  advanceBlockBtn.addEventListener('click', () => {
    advanceBlock();
    showToast('Block advanced. Price baseline has been reset.', 'success');
  });
}

function updateSwapView() {
  const tokenIn = state.tokens[currentTokenIn];
  const tokenOut = state.tokens[currentTokenOut];

  document.getElementById('token-in-symbol').textContent = tokenIn.symbol;
  document.getElementById('token-in-icon').textContent = tokenIn.symbol;
  document.getElementById('token-in-bal').textContent = tokenIn.balance.toLocaleString(undefined, { maximumFractionDigits: 4 });

  document.getElementById('token-out-symbol').textContent = tokenOut.symbol;
  document.getElementById('token-out-icon').textContent = tokenOut.symbol;
  document.getElementById('token-out-bal').textContent = tokenOut.balance.toLocaleString(undefined, { maximumFractionDigits: 2 });

  const feeData = getActiveFee();
  const feeBadge = document.getElementById('live-fee-badge');
  const feeText = document.getElementById('fee-badge-text');

  feeText.textContent = `${(feeData.appliedFee / 10000).toFixed(2)}% ${feeData.isMevTriggered ? 'MEV Spike' : 'Dynamic'}`;
  
  if (feeData.isMevTriggered) {
    feeBadge.className = 'pill-badge rose';
  } else {
    feeBadge.className = 'pill-badge green';
  }

  const blockEl = document.getElementById('block-status');
  if (blockEl) blockEl.textContent = `#${state.network.blockNumber.toLocaleString()} (${state.pool.sameBlockSwapsCount} in block)`;
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

  rateEl.textContent = `1 ${tokenIn.symbol} ≈ ${(result.rate).toFixed(tokenIn.symbol === 'ETH' ? 2 : 4)} ${tokenOut.symbol}`;
  feeEl.textContent = `${result.appliedFeePercent}% (${result.reason})`;
  feeEl.style.color = result.isMevTriggered ? 'var(--accent-rose)' : 'var(--text-main)';

  impactEl.textContent = `${result.priceImpact.toFixed(2)}%`;
  impactEl.style.color = result.priceImpact > 3.0 ? 'var(--accent-rose)' : result.priceImpact > 1.0 ? 'var(--accent-amber)' : 'var(--text-main)';

  const minAmountOut = result.amountOut * (1 - (state.settings.slippageBps / 10000));
  minOutEl.textContent = `${minAmountOut.toFixed(minAmountOut > 100 ? 2 : 4)} ${tokenOut.symbol}`;
}

function handleSwapSubmission() {
  const amountIn = parseFloat(document.getElementById('input-amount-in').value) || 0;
  if (amountIn <= 0) {
    showToast('Enter an amount to swap', 'warn');
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
      showToast(`Swap completed with 5.00% MEV spike penalty applied`, 'warn');
    } else {
      showToast(`Swapped ${amountIn} ${currentTokenIn} for ${executed.amountOut.toFixed(2)} ${currentTokenOut}`, 'success');
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
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
    toast.style.transition = 'all 0.2s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}
