/* ==========================================================================
   Adaptive Volatility AMM - MEV Defense Lab & Sandwich Visualizer
   ========================================================================== */

import { state, subscribe } from './state.js';
import { showToast } from './swap.js';

let simStep = 0;
let isPlaying = false;
let moveBps = 150;
let volatilityBps = 60;

export function initMevModule() {
  const container = document.getElementById('mev-container');
  if (!container) return;

  renderMevView(container);
  bindMevEvents();
  subscribe(() => updateMevLiveMetrics());
  updateMevLiveMetrics();
}

function renderMevView(container) {
  container.innerHTML = `
    <div class="swap-wrapper" style="max-width:960px;margin:0 auto">
      
      <!-- Top Overview Banner -->
      <div class="swap-card" style="max-width:none;border-color:rgba(6,182,212,0.3);box-shadow:0 0 30px rgba(6,182,212,0.08)">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:12px">
          <div>
            <h2 style="font-family:var(--font-heading);font-size:22px;margin-bottom:4px">🛡️ Intra-Block MEV Dampening Lab</h2>
            <p style="color:var(--text-secondary);font-size:13.5px;margin:0">
              Interactive test bench to simulate front-run and sandwich attacks against Uniswap v4's <code>AdaptiveFeeHook</code>.
            </p>
          </div>
          <div style="display:flex;gap:8px">
            <span class="mode-badge" style="background:rgba(239,68,68,0.15);color:var(--accent-danger);border-color:rgba(239,68,68,0.35)">
              Spike Override: 5.00%
            </span>
            <span class="mode-badge" style="background:rgba(16,185,129,0.15);color:var(--accent-green);border-color:rgba(16,185,129,0.35)">
              Threshold: 100 bps
            </span>
          </div>
        </div>

        <!-- Controls Row -->
        <div class="grid g2" style="background:var(--bg-card-inner);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:16px;margin:16px 0">
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px">
              <span style="color:var(--text-secondary)">Front-run Price Distortion:</span>
              <strong id="mev-move-label" style="font-family:var(--font-mono);color:var(--primary)">150 bps (+1.50%)</strong>
            </div>
            <input type="range" id="slider-mev-move" min="20" max="300" value="150" style="width:100%;cursor:pointer" />
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-top:4px">
              <span>20 bps (Normal Trade)</span>
              <span style="color:var(--accent-warn)">100 bps (Threshold)</span>
              <span style="color:var(--accent-danger)">300 bps (Aggressive)</span>
            </div>
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px">
              <span style="color:var(--text-secondary)">Background Volatility Tier:</span>
              <strong id="mev-vol-label" style="font-family:var(--font-mono);color:var(--secondary)">60 bps (Low Tier 0.05%)</strong>
            </div>
            <input type="range" id="slider-mev-vol" min="10" max="800" value="60" style="width:100%;cursor:pointer" />
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-top:4px">
              <span>Low (≤100)</span>
              <span>Medium (101-500)</span>
              <span>High (&gt;500)</span>
            </div>
          </div>
        </div>

        <!-- Action Controls -->
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between">
          <div style="display:flex;gap:10px">
            <button class="btn sm" id="btn-play-sandwich">▶️ Run Step-by-Step Simulation</button>
            <button class="btn sm ghost" id="btn-instant-sandwich">⚡ Instant Compare</button>
            <button class="btn sm ghost" id="btn-reset-mev">Reset</button>
          </div>
          <div style="font-size:12px;color:var(--text-muted)" id="sim-status-label">Ready to simulate block #18920421</div>
        </div>
      </div>

      <!-- Visual Mempool / Block Transaction Sequence -->
      <div class="swap-card" style="max-width:none">
        <h3 style="font-size:16px;margin-bottom:12px">⛓️ Same-Block Transaction Pipeline</h3>
        
        <div class="grid" style="grid-template-columns:repeat(4,1fr);gap:12px" id="tx-pipeline">
          
          <!-- TX 1 -->
          <div class="tx-card" id="tx-card-1" style="background:var(--bg-card-inner);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:14px;transition:all 0.3s ease">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span style="font-size:11.5px;font-weight:700;color:var(--text-muted)">TX #1</span>
              <span class="mode-badge" style="font-size:11px;padding:2px 6px">Opening</span>
            </div>
            <strong style="font-size:13.5px;display:block;margin-bottom:4px">Trader Swap</strong>
            <p style="font-size:12px;color:var(--text-secondary);margin:0">Sets block baseline price:</p>
            <div style="font-family:var(--font-mono);font-size:13px;font-weight:700;margin-top:6px" id="tx1-price">$2,500.00</div>
            <div style="font-size:11.5px;color:var(--accent-green);margin-top:4px" id="tx1-fee">Fee: 0.05%</div>
          </div>

          <!-- TX 2 -->
          <div class="tx-card" id="tx-card-2" style="background:var(--bg-card-inner);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:14px;transition:all 0.3s ease">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span style="font-size:11.5px;font-weight:700;color:var(--accent-warn)">TX #2</span>
              <span class="mode-badge" style="font-size:11px;padding:2px 6px;background:rgba(245,158,11,0.15);color:var(--accent-warn);border-color:rgba(245,158,11,0.3)">Front-Run</span>
            </div>
            <strong style="font-size:13.5px;display:block;margin-bottom:4px">MEV Bot Buy</strong>
            <p style="font-size:12px;color:var(--text-secondary);margin:0">Buys 30 ETH to move price:</p>
            <div style="font-family:var(--font-mono);font-size:13px;font-weight:700;margin-top:6px" id="tx2-price">$2,537.50 (+150 bps)</div>
            <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px" id="tx2-fee">Fee: 0.05%</div>
          </div>

          <!-- TX 3 -->
          <div class="tx-card" id="tx-card-3" style="background:var(--bg-card-inner);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:14px;transition:all 0.3s ease">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span style="font-size:11.5px;font-weight:700;color:var(--text-muted)">TX #3</span>
              <span class="mode-badge" style="font-size:11px;padding:2px 6px">Victim</span>
            </div>
            <strong style="font-size:13.5px;display:block;margin-bottom:4px">User Swap</strong>
            <p style="font-size:12px;color:var(--text-secondary);margin:0">Swaps at distorted price:</p>
            <div style="font-family:var(--font-mono);font-size:13px;font-weight:700;margin-top:6px" id="tx3-price">$2,542.10</div>
            <div style="font-size:11.5px;color:var(--accent-danger);margin-top:4px" id="tx3-fee">Fee: 5.00% (Spike)</div>
          </div>

          <!-- TX 4 -->
          <div class="tx-card" id="tx-card-4" style="background:var(--bg-card-inner);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:14px;transition:all 0.3s ease">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span style="font-size:11.5px;font-weight:700;color:var(--accent-danger)">TX #4</span>
              <span class="mode-badge" style="font-size:11px;padding:2px 6px;background:rgba(239,68,68,0.15);color:var(--accent-danger);border-color:rgba(239,68,68,0.3)">Back-Run</span>
            </div>
            <strong style="font-size:13.5px;display:block;margin-bottom:4px">MEV Bot Sell</strong>
            <p style="font-size:12px;color:var(--text-secondary);margin:0">Attempts back-run dump:</p>
            <div style="font-family:var(--font-mono);font-size:13px;font-weight:700;margin-top:6px" id="tx4-price">$2,501.20</div>
            <div style="font-size:11.5px;color:var(--accent-danger);font-weight:700;margin-top:4px" id="tx4-fee">🚨 Fee: 5.00% Spike!</div>
          </div>

        </div>
      </div>

      <!-- Economic Impact & PnL Comparison Matrix -->
      <div class="grid g2" style="width:100%">
        <!-- Unprotected Pool -->
        <div class="swap-card" style="max-width:none;border-color:rgba(239,68,68,0.25)">
          <div class="swap-header">
            <div class="swap-title" style="font-size:17px">
              <span style="color:var(--accent-danger)">❌ Unprotected AMM Pool</span>
            </div>
            <span class="mode-badge" style="background:rgba(239,68,68,0.1);color:var(--accent-danger);border-color:rgba(239,68,68,0.3)">Vulnerable</span>
          </div>
          <p style="font-size:12.5px;color:var(--text-secondary);margin-bottom:12px">
            Standard AMM with fixed 0.30% fee without intra-block price checks.
          </p>
          <div class="trade-details">
            <div class="detail-row">
              <span>Attacker Gross Revenue</span>
              <span class="detail-val" id="std-rev">$76,140.00</span>
            </div>
            <div class="detail-row">
              <span>Attacker Total Swap Fees (0.3%)</span>
              <span class="detail-val" id="std-fee">$453.20</span>
            </div>
            <div class="detail-row" style="border-top:1px dashed var(--border-subtle);padding-top:6px;margin-top:6px">
              <span style="font-weight:700">Attacker Net Profit (PnL)</span>
              <span class="detail-val good" id="std-pnl" style="font-size:15px">+$248.50 (Profitable)</span>
            </div>
          </div>
          <div style="font-size:11.5px;color:var(--accent-danger);padding:8px;background:rgba(239,68,68,0.08);border-radius:var(--radius-sm)">
            ⚠️ Result: Attacker successfully extracts value from the victim trader.
          </div>
        </div>

        <!-- Protected AdaptiveFeeHook Pool -->
        <div class="swap-card" style="max-width:none;border-color:rgba(16,185,129,0.35);box-shadow:0 0 25px rgba(16,185,129,0.08)">
          <div class="swap-header">
            <div class="swap-title" style="font-size:17px">
              <span style="color:var(--accent-green)">🛡️ AdaptiveVol AMM (Hook Protected)</span>
            </div>
            <span class="mode-badge" style="background:rgba(16,185,129,0.1);color:var(--accent-green);border-color:rgba(16,185,129,0.3)">Protected</span>
          </div>
          <p style="font-size:12.5px;color:var(--text-secondary);margin-bottom:12px">
            Active intra-block detection spikes the swap fee to 5.00% when move > 100 bps.
          </p>
          <div class="trade-details">
            <div class="detail-row">
              <span>Attacker Gross Revenue</span>
              <span class="detail-val" id="hook-rev">$76,140.00</span>
            </div>
            <div class="detail-row">
              <span>Attacker Total Swap Fees (5.0%)</span>
              <span class="detail-val danger" id="hook-fee">$3,807.00</span>
            </div>
            <div class="detail-row" style="border-top:1px dashed var(--border-subtle);padding-top:6px;margin-top:6px">
              <span style="font-weight:700">Attacker Net Profit (PnL)</span>
              <span class="detail-val danger" id="hook-pnl" style="font-size:15px">-$3,105.30 (Crushing Loss)</span>
            </div>
          </div>
          <div style="font-size:11.5px;color:var(--accent-green);padding:8px;background:rgba(16,185,129,0.08);border-radius:var(--radius-sm)">
            ✅ Result: MEV spike penalizes the bot $3,105, which is rewarded directly to LPs. Attack failed!
          </div>
        </div>
      </div>

    </div>
  `;
}

function bindMevEvents() {
  const sliderMove = document.getElementById('slider-mev-move');
  const sliderVol = document.getElementById('slider-mev-vol');
  const btnPlay = document.getElementById('btn-play-sandwich');
  const btnInstant = document.getElementById('btn-instant-sandwich');
  const btnReset = document.getElementById('btn-reset-mev');

  sliderMove.addEventListener('input', (e) => {
    moveBps = parseInt(e.target.value, 10);
    document.getElementById('mev-move-label').textContent = `${moveBps} bps (+${(moveBps/100).toFixed(2)}%)`;
    updateMevLiveMetrics();
  });

  sliderVol.addEventListener('input', (e) => {
    volatilityBps = parseInt(e.target.value, 10);
    const tierName = volatilityBps <= 100 ? 'Low (0.05%)' : volatilityBps <= 500 ? 'Medium (0.30%)' : 'High (1.00%)';
    document.getElementById('mev-vol-label').textContent = `${volatilityBps} bps (${tierName})`;
    updateMevLiveMetrics();
  });

  btnPlay.addEventListener('click', () => {
    runStepByStep();
  });

  btnInstant.addEventListener('click', () => {
    runInstant();
  });

  btnReset.addEventListener('click', () => {
    resetCards();
    document.getElementById('sim-status-label').textContent = 'Ready to simulate block #18920421';
    showToast('Sandbox reset to opening baseline', 'success');
  });
}

function updateMevLiveMetrics() {
  const basePrice = state.pool.currentPrice;
  const isThresholdCrossed = moveBps > state.pool.mevThresholdBps;

  // Base tier
  let tierFeePercent = 1.0;
  if (volatilityBps <= 100) tierFeePercent = 0.05;
  else if (volatilityBps <= 500) tierFeePercent = 0.30;

  const pushedPrice = basePrice * (1 + (moveBps / 10000));
  document.getElementById('tx1-price').textContent = `$${basePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('tx1-fee').textContent = `Fee: ${tierFeePercent.toFixed(2)}%`;

  document.getElementById('tx2-price').textContent = `$${pushedPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (+${moveBps} bps)`;
  document.getElementById('tx2-fee').textContent = `Fee: ${tierFeePercent.toFixed(2)}%`;

  document.getElementById('tx3-price').textContent = `$${(pushedPrice * 1.002).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('tx3-fee').textContent = `Fee: ${isThresholdCrossed ? '5.00% (Spike)' : tierFeePercent.toFixed(2) + '%'}`;

  document.getElementById('tx4-price').textContent = `$${(basePrice * 1.0005).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('tx4-fee').textContent = isThresholdCrossed ? '🚨 Fee: 5.00% Spike!' : `Fee: ${tierFeePercent.toFixed(2)}%`;

  // Economic calculations
  const frontrunETH = 30.0;
  const frontrunUSD = frontrunETH * basePrice; // $75,000
  const grossRev = frontrunUSD * (1 + (moveBps / 20000)); // slippage capture
  const stdFee = grossRev * 0.006; // 0.3% in + 0.3% out
  const stdPnL = (grossRev - frontrunUSD) - stdFee;

  const hookFeeRate = isThresholdCrossed ? 0.05 : (tierFeePercent / 100);
  const hookFee = grossRev * hookFeeRate;
  const hookPnL = (grossRev - frontrunUSD) - hookFee;

  document.getElementById('std-rev').textContent = `$${grossRev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('std-fee').textContent = `$${stdFee.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('std-pnl').textContent = `${stdPnL >= 0 ? '+' : ''}$${stdPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${stdPnL >= 0 ? 'Profitable' : 'Loss'})`;
  document.getElementById('std-pnl').className = 'detail-val ' + (stdPnL >= 0 ? 'good' : 'danger');

  document.getElementById('hook-rev').textContent = `$${grossRev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('hook-fee').textContent = `$${hookFee.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('hook-pnl').textContent = `${hookPnL >= 0 ? '+' : ''}$${hookPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${hookPnL >= 0 ? 'Profitable' : 'Crushing Loss'})`;
  document.getElementById('hook-pnl').className = 'detail-val ' + (hookPnL >= 0 ? 'good' : 'danger');
}

function resetCards() {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`tx-card-${i}`);
    if (el) {
      el.style.transform = 'scale(1)';
      el.style.borderColor = 'var(--border-subtle)';
      el.style.boxShadow = 'none';
    }
  }
}

function highlightCard(cardIdx, color = 'var(--primary)') {
  resetCards();
  const el = document.getElementById(`tx-card-${cardIdx}`);
  if (el) {
    el.style.transform = 'scale(1.04)';
    el.style.borderColor = color;
    el.style.boxShadow = `0 0 20px ${color}`;
  }
}

function runStepByStep() {
  if (isPlaying) return;
  isPlaying = true;
  simStep = 1;

  const statusEl = document.getElementById('sim-status-label');

  function nextStep() {
    if (simStep === 1) {
      statusEl.textContent = 'Step 1/4: Normal trade executes. Hook logs baseline sqrtPrice.';
      highlightCard(1, 'var(--accent-green)');
      simStep++;
      setTimeout(nextStep, 1000);
    } else if (simStep === 2) {
      statusEl.textContent = `Step 2/4: MEV Bot front-runs 30 ETH (+${moveBps} bps move).`;
      highlightCard(2, 'var(--accent-warn)');
      simStep++;
      setTimeout(nextStep, 1000);
    } else if (simStep === 3) {
      statusEl.textContent = 'Step 3/4: Victim trade enters pool at inflated price.';
      highlightCard(3, 'var(--secondary)');
      simStep++;
      setTimeout(nextStep, 1000);
    } else if (simStep === 4) {
      const isCrossed = moveBps > state.pool.mevThresholdBps;
      if (isCrossed) {
        statusEl.textContent = `Step 4/4: 🚨 MEV SPIKE TRIGGERED! Back-run taxed 5.00% ($3,800+).`;
        highlightCard(4, 'var(--accent-danger)');
        showToast('MEV Spike Fee (5.00%) triggered! Attack neutralized.', 'warn');
      } else {
        statusEl.textContent = 'Step 4/4: Move within 100 bps threshold. Standard tier fee applied.';
        highlightCard(4, 'var(--accent-green)');
      }
      isPlaying = false;
    }
  }

  nextStep();
}

function runInstant() {
  updateMevLiveMetrics();
  const isCrossed = moveBps > state.pool.mevThresholdBps;
  if (isCrossed) {
    highlightCard(4, 'var(--accent-danger)');
    document.getElementById('sim-status-label').textContent = 'Simulated: Bot lost -$3,105 on back-run due to 5% fee override.';
    showToast('Simulation complete: MEV dampener successfully repelled the sandwich attack!', 'success');
  } else {
    highlightCard(2, 'var(--accent-green)');
    document.getElementById('sim-status-label').textContent = 'Simulated: Move below threshold (safe).';
    showToast('Simulation complete: Normal swap flow.', 'success');
  }
}
