/* ==========================================================================
   AdaptiveVol AMM - MEV Defense Lab Controller (Soft Minimalist)
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
    <div style="max-width:960px;margin:10px auto 0;display:flex;flex-direction:column;gap:20px">
      
      <!-- Top Overview Card -->
      <div class="card">
        <div class="card-header" style="margin-bottom:12px">
          <div>
            <span class="card-title" style="font-size:18px">Intra-Block MEV Defense Lab</span>
            <p style="color:var(--text-muted);font-size:13px;margin-top:2px">
              Simulate sandwich and arbitrage attacks to verify the hook's 5.00% fee spike penalty.
            </p>
          </div>
          <div style="display:flex;gap:6px">
            <span class="pill-badge rose">Spike Fee: 5.00%</span>
            <span class="pill-badge green">Threshold: 100 bps</span>
          </div>
        </div>

        <!-- Slider Controls -->
        <div class="grid g2" style="background:var(--bg-input);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:14px;margin:12px 0 16px">
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
              <span style="color:var(--text-muted)">Front-run Price Move:</span>
              <strong id="mev-move-label" style="color:var(--primary);font-weight:600">150 bps (+1.50%)</strong>
            </div>
            <input type="range" id="slider-mev-move" min="20" max="300" value="150" style="width:100%;cursor:pointer;accent-color:var(--primary)" />
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-faint);margin-top:4px">
              <span>20 bps (Calm)</span>
              <span style="color:var(--accent-amber)">100 bps (Threshold)</span>
              <span style="color:var(--accent-rose)">300 bps (Aggressive)</span>
            </div>
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
              <span style="color:var(--text-muted)">Oracle Volatility Baseline:</span>
              <strong id="mev-vol-label" style="color:var(--text-main);font-weight:600">60 bps (Low Tier 0.05%)</strong>
            </div>
            <input type="range" id="slider-mev-vol" min="10" max="800" value="60" style="width:100%;cursor:pointer;accent-color:var(--primary)" />
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-faint);margin-top:4px">
              <span>Low (≤100)</span>
              <span>Medium (101-500)</span>
              <span>High (>500)</span>
            </div>
          </div>
        </div>

        <!-- Buttons Row -->
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div style="display:flex;gap:8px">
            <button class="btn-action" id="btn-play-sandwich" style="width:auto;padding:8px 16px;font-size:13px">
              Run Step-by-Step
            </button>
            <button class="btn-ghost" id="btn-instant-sandwich">
              Instant Compare
            </button>
            <button class="btn-ghost" id="btn-reset-mev">
              Reset
            </button>
          </div>
          <span style="font-size:12px;color:var(--text-faint)" id="sim-status-label">Ready to simulate block #18920421</span>
        </div>
      </div>

      <!-- Same-Block 4-Step Pipeline -->
      <div class="card">
        <span class="card-title" style="font-size:15px;display:block;margin-bottom:14px">Transaction Sequence in Block</span>
        
        <div class="grid g4" id="tx-pipeline">
          
          <div class="stat-card" id="tx-card-1" style="transition:border-color 0.2s ease">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <span style="font-size:11px;font-weight:600;color:var(--text-faint)">1 · OPENING</span>
              <span class="pill-badge" style="font-size:10px;padding:1px 5px">Baseline</span>
            </div>
            <div style="font-size:13px;font-weight:600;color:var(--text-main);margin-bottom:2px">Opening Swap</div>
            <div class="stat-val" style="font-size:16px" id="tx1-price">$2,500.00</div>
            <div style="font-size:11.5px;color:var(--accent-green);margin-top:4px" id="tx1-fee">Fee: 0.05%</div>
          </div>

          <div class="stat-card" id="tx-card-2" style="transition:border-color 0.2s ease">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <span style="font-size:11px;font-weight:600;color:var(--accent-amber)">2 · FRONT-RUN</span>
              <span class="pill-badge amber" style="font-size:10px;padding:1px 5px">Bot Buy</span>
            </div>
            <div style="font-size:13px;font-weight:600;color:var(--text-main);margin-bottom:2px">Bot Buys 30 ETH</div>
            <div class="stat-val" style="font-size:16px" id="tx2-price">$2,537.50</div>
            <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px" id="tx2-fee">Fee: 0.05%</div>
          </div>

          <div class="stat-card" id="tx-card-3" style="transition:border-color 0.2s ease">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <span style="font-size:11px;font-weight:600;color:var(--text-faint)">3 · VICTIM</span>
              <span class="pill-badge" style="font-size:10px;padding:1px 5px">Trader</span>
            </div>
            <div style="font-size:13px;font-weight:600;color:var(--text-main);margin-bottom:2px">User Swap</div>
            <div class="stat-val" style="font-size:16px" id="tx3-price">$2,542.10</div>
            <div style="font-size:11.5px;color:var(--accent-rose);margin-top:4px" id="tx3-fee">Fee: 5.00%</div>
          </div>

          <div class="stat-card" id="tx-card-4" style="transition:border-color 0.2s ease">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <span style="font-size:11px;font-weight:600;color:var(--accent-rose)">4 · BACK-RUN</span>
              <span class="pill-badge rose" style="font-size:10px;padding:1px 5px">Bot Sell</span>
            </div>
            <div style="font-size:13px;font-weight:600;color:var(--text-main);margin-bottom:2px">Bot Dumps ETH</div>
            <div class="stat-val" style="font-size:16px" id="tx4-price">$2,501.20</div>
            <div style="font-size:11.5px;color:var(--accent-rose);font-weight:600;margin-top:4px" id="tx4-fee">Spike: 5.00%</div>
          </div>

        </div>
      </div>

      <!-- Economic PnL Comparison Matrix -->
      <div class="grid g2">
        
        <!-- Unprotected Pool -->
        <div class="card">
          <div class="card-header">
            <span class="card-title" style="font-size:15px;color:var(--text-main)">Standard AMM (Unprotected)</span>
            <span class="pill-badge rose">Vulnerable</span>
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
            Fixed 0.30% fee without same-block price move detection.
          </p>
          <div class="info-box">
            <div class="info-row">
              <span>Gross Trade Revenue</span>
              <span class="info-val" id="std-rev">$76,140.00</span>
            </div>
            <div class="info-row">
              <span>Swap Fees Deducted (0.3%)</span>
              <span class="info-val" id="std-fee">$453.20</span>
            </div>
            <div class="info-row" style="border-top:1px solid var(--border-subtle);padding-top:6px;margin-top:6px">
              <span style="font-weight:600">Attacker Net Profit</span>
              <span class="info-val" id="std-pnl" style="color:#34d399;font-weight:600">+$248.50</span>
            </div>
          </div>
          <div style="font-size:12px;color:var(--accent-amber)">
            Bot successfully extracts profit at the victim's expense.
          </div>
        </div>

        <!-- Protected AdaptiveVol Pool -->
        <div class="card">
          <div class="card-header">
            <span class="card-title" style="font-size:15px;color:var(--text-main)">AdaptiveVol AMM (Hook Protected)</span>
            <span class="pill-badge green">Protected</span>
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
            Same-block price delta &gt; 100 bps triggers the 5.00% fee spike.
          </p>
          <div class="info-box">
            <div class="info-row">
              <span>Gross Trade Revenue</span>
              <span class="info-val" id="hook-rev">$76,140.00</span>
            </div>
            <div class="info-row">
              <span>Swap Fees Deducted (5.0%)</span>
              <span class="info-val" id="hook-fee" style="color:var(--accent-rose)">$3,807.00</span>
            </div>
            <div class="info-row" style="border-top:1px solid var(--border-subtle);padding-top:6px;margin-top:6px">
              <span style="font-weight:600">Attacker Net Profit</span>
              <span class="info-val" id="hook-pnl" style="color:var(--accent-rose);font-weight:600">-$3,105.30</span>
            </div>
          </div>
          <div style="font-size:12px;color:#34d399">
            Bot loses $3,105 on the sell leg. The penalty is distributed to LPs.
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

  btnPlay.addEventListener('click', () => runStepByStep());
  btnInstant.addEventListener('click', () => runInstant());
  btnReset.addEventListener('click', () => {
    resetCards();
    document.getElementById('sim-status-label').textContent = 'Ready to simulate block #18920421';
    showToast('Simulation reset to baseline', 'success');
  });
}

function updateMevLiveMetrics() {
  const basePrice = state.pool.currentPrice;
  const isThresholdCrossed = moveBps > state.pool.mevThresholdBps;

  let tierFeePercent = 1.0;
  if (volatilityBps <= 100) tierFeePercent = 0.05;
  else if (volatilityBps <= 500) tierFeePercent = 0.30;

  const pushedPrice = basePrice * (1 + (moveBps / 10000));
  document.getElementById('tx1-price').textContent = `$${basePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('tx1-fee').textContent = `Fee: ${tierFeePercent.toFixed(2)}%`;

  document.getElementById('tx2-price').textContent = `$${pushedPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('tx2-fee').textContent = `Fee: ${tierFeePercent.toFixed(2)}%`;

  document.getElementById('tx3-price').textContent = `$${(pushedPrice * 1.002).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('tx3-fee').textContent = `Fee: ${isThresholdCrossed ? '5.00%' : tierFeePercent.toFixed(2) + '%'}`;

  document.getElementById('tx4-price').textContent = `$${(basePrice * 1.0005).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('tx4-fee').textContent = isThresholdCrossed ? 'Fee: 5.00%' : `Fee: ${tierFeePercent.toFixed(2)}%`;

  const frontrunETH = 30.0;
  const frontrunUSD = frontrunETH * basePrice;
  const grossRev = frontrunUSD * (1 + (moveBps / 20000));
  const stdFee = grossRev * 0.006;
  const stdPnL = (grossRev - frontrunUSD) - stdFee;

  const hookFeeRate = isThresholdCrossed ? 0.05 : (tierFeePercent / 100);
  const hookFee = grossRev * hookFeeRate;
  const hookPnL = (grossRev - frontrunUSD) - hookFee;

  document.getElementById('std-rev').textContent = `$${grossRev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('std-fee').textContent = `$${stdFee.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('std-pnl').textContent = `${stdPnL >= 0 ? '+' : ''}$${stdPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('std-pnl').style.color = stdPnL >= 0 ? '#34d399' : '#fb7185';

  document.getElementById('hook-rev').textContent = `$${grossRev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('hook-fee').textContent = `$${hookFee.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('hook-pnl').textContent = `${hookPnL >= 0 ? '+' : ''}$${hookPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('hook-pnl').style.color = hookPnL >= 0 ? '#34d399' : '#fb7185';
}

function resetCards() {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`tx-card-${i}`);
    if (el) {
      el.style.borderColor = 'var(--border-subtle)';
    }
  }
}

function highlightCard(cardIdx, color = 'var(--primary)') {
  resetCards();
  const el = document.getElementById(`tx-card-${cardIdx}`);
  if (el) {
    el.style.borderColor = color;
  }
}

function runStepByStep() {
  if (isPlaying) return;
  isPlaying = true;
  simStep = 1;

  const statusEl = document.getElementById('sim-status-label');

  function nextStep() {
    if (simStep === 1) {
      statusEl.textContent = 'Step 1/4: Opening swap sets block baseline price';
      highlightCard(1, 'var(--accent-green)');
      simStep++;
      setTimeout(nextStep, 900);
    } else if (simStep === 2) {
      statusEl.textContent = `Step 2/4: Bot front-runs with 30 ETH (+${moveBps} bps move)`;
      highlightCard(2, 'var(--accent-amber)');
      simStep++;
      setTimeout(nextStep, 900);
    } else if (simStep === 3) {
      statusEl.textContent = 'Step 3/4: Victim trade enters pool at shifted price';
      highlightCard(3, 'var(--primary)');
      simStep++;
      setTimeout(nextStep, 900);
    } else if (simStep === 4) {
      const isCrossed = moveBps > state.pool.mevThresholdBps;
      if (isCrossed) {
        statusEl.textContent = 'Step 4/4: MEV spike fee (5.00%) applied on back-run';
        highlightCard(4, 'var(--accent-rose)');
        showToast('MEV Spike (5.00%) triggered. Attack neutralized.', 'warn');
      } else {
        statusEl.textContent = 'Step 4/4: Move within 100 bps threshold. Standard tier applied.';
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
    highlightCard(4, 'var(--accent-rose)');
    document.getElementById('sim-status-label').textContent = 'Comparison: Bot lost -$3,105 on back-run due to 5% fee override';
    showToast('MEV dampener neutralized sandwich attack', 'success');
  } else {
    highlightCard(2, 'var(--accent-green)');
    document.getElementById('sim-status-label').textContent = 'Comparison: Move below 100 bps threshold';
    showToast('Normal swap flow', 'success');
  }
}
