/* ==========================================================================
   Adaptive Volatility AMM - Production DEX Swap Module (On-Chain Sepolia)
   ========================================================================== */

import {
  state,
  subscribe,
  notify,
  getActiveFee,
  calculateSwapOutput,
  recordTransaction,
  syncWithSepolia
} from './state.js';
import {
  SEPOLIA_CONFIG,
  getWeb3Signer,
  checkTokenAllowance,
  sendApproveTx,
  sendSwapTx,
  sendClaimFaucetTx
} from './contracts.js';

let currentTokenIn = 'ETH';
let currentTokenOut = 'USDC';
let isApproving = false;
let isSwapping = false;
let isClaiming = false;
let hasAllowance = false;

export function initSwapModule() {
  renderSwapUI();
  bindEvents();
  updateSwapView();

  subscribe(() => {
    updateSwapView();
    checkCurrentAllowance();
  });
}

function renderSwapUI() {
  const container = document.getElementById('swap-container');
  if (!container) return;

  container.innerHTML = `
    <div class="swap-wrapper">
      <div class="swap-card">
        <!-- Swap Header -->
        <div class="swap-header">
          <div style="display:flex;align-items:center;gap:10px">
            <h1 class="swap-title">Swap</h1>
            <div class="pill-badge green" id="live-fee-badge">
              <span class="status-dot live-pulse"></span>
              <span id="fee-badge-text">0.05% Dynamic</span>
            </div>
          </div>
          <div class="swap-settings-wrapper">
            <button class="btn-icon" id="btn-toggle-slippage" title="Slippage Settings">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>
            <div class="slippage-popover hidden" id="slippage-dropdown">
              <div class="slippage-title">Max Slippage Tolerance</div>
              <div class="slippage-options">
                <button class="slippage-btn" data-slip="10">0.1%</button>
                <button class="slippage-btn active" data-slip="50">0.5%</button>
                <button class="slippage-btn" data-slip="100">1.0%</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Token In Field -->
        <div class="token-field">
          <div class="token-field-header">
            <span>You pay</span>
            <div class="balance-display">
              <span id="token-in-bal-label">Balance: <strong id="token-in-bal">0.00</strong></span>
              <button class="btn-max" id="btn-max-in">MAX</button>
            </div>
          </div>
          <div class="token-input-row">
            <input 
              type="number" 
              class="token-amount-input" 
              id="input-amount-in" 
              placeholder="0.0" 
              min="0" 
              step="any"
              autocomplete="off"
            />
            <button class="token-btn" id="btn-select-token-in">
              <span class="token-icon" id="token-in-icon">🔷</span>
              <span class="token-symbol" id="token-in-symbol">ETH</span>
            </button>
          </div>
          <div class="token-field-footer">
            <span class="token-usd-sub" id="token-in-usd">~$0.00</span>
          </div>
        </div>

        <!-- Direction Flip Button -->
        <div class="flip-wrapper">
          <button class="btn-flip" id="btn-flip-tokens" title="Switch token direction">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M7 10l5 5 5-5H7z"></path>
            </svg>
          </button>
        </div>

        <!-- Token Out Field -->
        <div class="token-field">
          <div class="token-field-header">
            <span>You receive</span>
            <div class="balance-display">
              <span id="token-out-bal-label">Balance: <strong id="token-out-bal">0.00</strong></span>
            </div>
          </div>
          <div class="token-input-row">
            <input 
              type="text" 
              class="token-amount-input" 
              id="input-amount-out" 
              placeholder="0.0" 
              readonly 
            />
            <button class="token-btn" id="btn-select-token-out">
              <span class="token-icon" id="token-out-icon">💵</span>
              <span class="token-symbol" id="token-out-symbol">USDC</span>
            </button>
          </div>
          <div class="token-field-footer">
            <span class="token-usd-sub" id="token-out-usd">~$0.00</span>
          </div>
        </div>

        <!-- Trade Details Card -->
        <div class="info-box" id="trade-details-box">
          <div class="info-row">
            <span>Rate</span>
            <span class="info-val" id="trade-rate">—</span>
          </div>
          <div class="info-row">
            <span>Dynamic Fee</span>
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
            <span>Routing</span>
            <span class="info-val" style="color:var(--accent-blue)">Uniswap v4 (Sepolia)</span>
          </div>
        </div>

        <!-- Primary Action Button -->
        <button class="btn-action" id="btn-submit-swap">
          <span>Connect Wallet</span>
        </button>

        <!-- Testnet Faucet Quick Callout -->
        <div class="faucet-quickbar">
          <span>Sepolia v4 Test Tokens:</span>
          <button class="faucet-link-btn" id="btn-quick-faucet">
            <span>🚰 Claim 1,000 ETH & USDC</span>
          </button>
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
  const slippageToggle = document.getElementById('btn-toggle-slippage');
  const slippageDropdown = document.getElementById('slippage-dropdown');
  const quickFaucetBtn = document.getElementById('btn-quick-faucet');

  amountInput.addEventListener('input', () => {
    updateCalculations();
    checkCurrentAllowance();
  });

  flipBtn.addEventListener('click', () => {
    const temp = currentTokenIn;
    currentTokenIn = currentTokenOut;
    currentTokenOut = temp;
    updateSwapView();
    updateCalculations();
    checkCurrentAllowance();
  });

  maxBtn.addEventListener('click', () => {
    const bal = state.tokens[currentTokenIn].balance;
    if (bal > 0) {
      amountInput.value = (bal * 0.999).toFixed(4);
    } else if (state.wallet.connected) {
      amountInput.value = '10.0';
      showToast('Populated 10 tokens. Claim test tokens below if needed!', 'info');
    } else {
      amountInput.value = '1.0';
    }
    updateCalculations();
    checkCurrentAllowance();
  });

  swapBtn.addEventListener('click', () => handleMainButtonClick());

  if (quickFaucetBtn) {
    quickFaucetBtn.addEventListener('click', () => handleQuickFaucet());
  }

  if (slippageToggle && slippageDropdown) {
    slippageToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      slippageDropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', () => {
      slippageDropdown.classList.add('hidden');
    });

    const slipBtns = slippageDropdown.querySelectorAll('.slippage-btn');
    slipBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        slipBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.settings.slippageBps = parseInt(btn.dataset.slip, 10);
        updateCalculations();
        slippageDropdown.classList.add('hidden');
        showToast(`Slippage tolerance set to ${(state.settings.slippageBps / 100).toFixed(1)}%`, 'info');
      });
    });
  }
}

function updateSwapView() {
  const tokenIn = state.tokens[currentTokenIn];
  const tokenOut = state.tokens[currentTokenOut];

  const inSym = document.getElementById('token-in-symbol');
  const inIcon = document.getElementById('token-in-icon');
  const inBal = document.getElementById('token-in-bal');
  const inLabel = document.getElementById('token-in-bal-label');

  const outSym = document.getElementById('token-out-symbol');
  const outIcon = document.getElementById('token-out-icon');
  const outBal = document.getElementById('token-out-bal');
  const outLabel = document.getElementById('token-out-bal-label');

  if (inSym) inSym.textContent = tokenIn.symbol;
  if (inIcon) inIcon.textContent = tokenIn.icon;
  if (inBal && inLabel) {
    if (currentTokenIn === 'ETH' && state.wallet.connected && state.wallet.nativeBalance > 0) {
      inLabel.innerHTML = `Balance: <strong id="token-in-bal">${tokenIn.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong> <span style="font-size:11px;font-weight:normal;color:var(--text-muted);margin-left:4px">(${state.wallet.nativeBalance} Sepolia ETH)</span>`;
    } else {
      inLabel.innerHTML = `Balance: <strong id="token-in-bal">${tokenIn.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong>`;
    }
  }

  if (outSym) outSym.textContent = tokenOut.symbol;
  if (outIcon) outIcon.textContent = tokenOut.icon;
  if (outBal && outLabel) {
    if (currentTokenOut === 'ETH' && state.wallet.connected && state.wallet.nativeBalance > 0) {
      outLabel.innerHTML = `Balance: <strong id="token-out-bal">${tokenOut.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong> <span style="font-size:11px;font-weight:normal;color:var(--text-muted);margin-left:4px">(${state.wallet.nativeBalance} Sepolia ETH)</span>`;
    } else {
      outLabel.innerHTML = `Balance: <strong id="token-out-bal">${tokenOut.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong>`;
    }
  }

  const feeData = getActiveFee();
  const feeBadge = document.getElementById('live-fee-badge');
  const feeText = document.getElementById('fee-badge-text');

  if (feeText && feeBadge) {
    feeText.textContent = `${(feeData.appliedFee / 10000).toFixed(2)}% Dynamic`;
    feeBadge.className = feeData.isMevTriggered ? 'pill-badge rose' : 'pill-badge green';
  }
}

function updateCalculations() {
  const amountIn = parseFloat(document.getElementById('input-amount-in')?.value) || 0;
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
    if (amountOutEl) amountOutEl.value = '';
    if (inUsdEl) inUsdEl.textContent = '~$0.00';
    if (outUsdEl) outUsdEl.textContent = '~$0.00';
    if (rateEl) rateEl.textContent = '—';
    if (feeEl) feeEl.textContent = '—';
    if (impactEl) impactEl.textContent = '0.00%';
    if (minOutEl) minOutEl.textContent = '—';
    return;
  }

  const result = calculateSwapOutput(amountIn, currentTokenIn);
  if (amountOutEl) amountOutEl.value = result.amountOut.toFixed(4);

  if (inUsdEl) inUsdEl.textContent = `~$${(amountIn * tokenIn.priceUSD).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (outUsdEl) outUsdEl.textContent = `~$${(result.amountOut * tokenOut.priceUSD).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (rateEl) rateEl.textContent = `1 ${tokenIn.symbol} ≈ ${result.rate.toFixed(4)} ${tokenOut.symbol}`;
  if (feeEl) feeEl.textContent = `${result.appliedFeePercent}%`;
  
  if (impactEl) {
    impactEl.textContent = `${result.priceImpact.toFixed(2)}%`;
    impactEl.style.color = result.priceImpact > 3.0 ? 'var(--accent-rose)' : 'var(--text-main)';
  }

  const minAmountOut = result.amountOut * (1 - (state.settings.slippageBps / 10000));
  if (minOutEl) minOutEl.textContent = `${minAmountOut.toFixed(4)} ${tokenOut.symbol}`;
}

async function checkCurrentAllowance() {
  if (!state.wallet.connected || !state.wallet.address) {
    updateButtonLabel('Connect Wallet');
    return;
  }

  if (isApproving) {
    updateButtonLabel('Approving in MetaMask...', true);
    return;
  }
  if (isSwapping) {
    updateButtonLabel('Swapping on Sepolia...', true);
    return;
  }
  if (isClaiming) {
    updateButtonLabel('Minting Test Tokens...', true);
    return;
  }

  const amountIn = parseFloat(document.getElementById('input-amount-in')?.value) || 0;
  if (amountIn <= 0) {
    updateButtonLabel('Enter an amount');
    return;
  }

  if (state.tokens[currentTokenIn].balance < amountIn) {
    if (state.tokens[currentTokenIn].balance === 0) {
      updateButtonLabel('🚰 Claim 1,000 Test Tokens to Swap');
    } else {
      updateButtonLabel(`Insufficient ${currentTokenIn} balance`);
    }
    return;
  }

  const tokenInAddress = state.tokens[currentTokenIn].address;
  const spender = SEPOLIA_CONFIG.contracts.poolSwapTest;

  try {
    const allowance = await checkTokenAllowance(state.wallet.address, tokenInAddress, spender);
    const amountInWei = window.ethers.parseEther(amountIn > 0 ? amountIn.toString() : '0.001');

    hasAllowance = allowance >= amountInWei;

    if (!hasAllowance) {
      updateButtonLabel(`Approve ${currentTokenIn}`);
    } else {
      updateButtonLabel('Swap');
    }
  } catch (err) {
    console.warn('Allowance check error:', err);
    updateButtonLabel('Swap');
  }
}

function updateButtonLabel(text, disabled = false) {
  const btn = document.getElementById('btn-submit-swap');
  if (!btn) return;
  btn.innerHTML = disabled ? `<span class="spinner"></span> <span>${text}</span>` : `<span>${text}</span>`;
  btn.disabled = disabled;
}

async function handleMainButtonClick() {
  if (!state.wallet.connected) {
    const connectBtn = document.getElementById('btn-wallet-connect');
    if (connectBtn) connectBtn.click();
    return;
  }

  const amountIn = parseFloat(document.getElementById('input-amount-in')?.value) || 0;

  if (state.tokens[currentTokenIn].balance < amountIn && state.tokens[currentTokenIn].balance === 0) {
    await handleQuickFaucet();
    return;
  }

  if (amountIn <= 0) {
    showToast('Enter an amount to swap', 'warn');
    return;
  }

  if (state.tokens[currentTokenIn].balance < amountIn) {
    showToast(`Insufficient ${currentTokenIn} balance`, 'error');
    return;
  }

  if (!hasAllowance) {
    await handleTokenApproval();
    return;
  }

  await handleOnChainSwap(amountIn);
}

async function handleTokenApproval() {
  try {
    isApproving = true;
    updateButtonLabel(`Approving ${currentTokenIn}...`, true);
    showToast(`Please confirm ${currentTokenIn} spend approval in MetaMask`, 'info');

    const signer = await getWeb3Signer();
    if (!signer) throw new Error('No Web3 wallet signer available');

    const tokenAddress = state.tokens[currentTokenIn].address;
    const spender = SEPOLIA_CONFIG.contracts.poolSwapTest;

    const tx = await sendApproveTx(signer, tokenAddress, spender);
    showToast(`Approval submitted. Waiting for confirmation...`, 'info', tx.hash);

    await tx.wait(1);
    isApproving = false;
    hasAllowance = true;

    showToast(`${currentTokenIn} approval confirmed on Sepolia!`, 'success', tx.hash);
    checkCurrentAllowance();
  } catch (err) {
    isApproving = false;
    console.error('Approval failed:', err);
    showToast(err.reason || err.message || 'Approval rejected by user', 'error');
    checkCurrentAllowance();
  }
}

async function handleOnChainSwap(amountIn) {
  try {
    isSwapping = true;
    updateButtonLabel('Confirming Swap in MetaMask...', true);
    showToast('Please confirm swap transaction in MetaMask', 'info');

    const signer = await getWeb3Signer();
    if (!signer) throw new Error('No Web3 wallet signer available');

    const zeroForOne = currentTokenIn === 'ETH';
    const amountInWei = window.ethers.parseEther(amountIn.toString());

    const tx = await sendSwapTx(signer, zeroForOne, amountInWei);
    showToast(`Swap submitted to Sepolia: ${tx.hash.slice(0, 10)}...`, 'info', tx.hash);

    const receipt = await tx.wait(1);
    isSwapping = false;

    showToast(`Swap confirmed on Sepolia!`, 'success', receipt.hash);
    recordTransaction(receipt.hash, 'Swap', `Swapped ${amountIn} ${currentTokenIn} for ${currentTokenOut}`);

    document.getElementById('input-amount-in').value = '';
    updateCalculations();
    await syncWithSepolia();
    checkCurrentAllowance();
  } catch (err) {
    isSwapping = false;
    console.error('Swap failed:', err);
    showToast(err.reason || err.shortMessage || err.message || 'Swap transaction reverted or rejected', 'error');
    checkCurrentAllowance();
  }
}

async function handleQuickFaucet() {
  if (!state.wallet.connected) {
    const connectBtn = document.getElementById('btn-wallet-connect');
    if (connectBtn) connectBtn.click();
    showToast('Connect your wallet first to claim test tokens', 'warn');
    return;
  }

  if (isClaiming) return;

  try {
    isClaiming = true;
    updateButtonLabel('Minting Test Tokens...', true);
    showToast('Please confirm token mint in MetaMask', 'info');

    const signer = await getWeb3Signer();
    if (!signer) throw new Error('No Web3 wallet signer available');

    const tx = await sendClaimFaucetTx(signer, state.wallet.address, 'BOTH');
    showToast('Minting 1,000 ETH & 1,000 USDC on Sepolia...', 'info', tx.hash);

    await tx.wait(1);
    isClaiming = false;
    showToast('Successfully minted 1,000 ETH & 1,000 USDC!', 'success', tx.hash);
    await syncWithSepolia();
    checkCurrentAllowance();
  } catch (err) {
    isClaiming = false;
    console.error('Faucet claim error:', err);
    const msg = err.reason || err.shortMessage || err.message || '';
    if (msg.includes('in-flight transaction limit') || msg.includes('delegated accounts')) {
      showToast('Transaction is already pending or confirmed on Sepolia. Syncing balance...', 'info');
      await syncWithSepolia();
    } else {
      showToast(msg || 'Faucet mint cancelled or rejected', 'warn');
    }
    checkCurrentAllowance();
  }
}

export function showToast(message, type = 'success', txHash = null) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let content = `<span>${message}</span>`;
  if (txHash) {
    content += ` <a href="https://sepolia.etherscan.io/tx/${txHash}" target="_blank" class="toast-link">View on Etherscan ↗</a>`;
  }
  
  toast.innerHTML = content;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
    toast.style.transition = 'all 0.2s ease';
    setTimeout(() => toast.remove(), 250);
  }, 5500);
}
