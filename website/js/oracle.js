/* ==========================================================================
   Adaptive Volatility AMM - Oracle & Subgraph Pipeline Module
   ========================================================================== */

import { state, subscribe, notify } from './state.js';
import { showToast } from './swap.js';

let isSimulatingOracleCall = false;

export function initOracleModule() {
  const container = document.getElementById('oracle-container');
  if (!container) return;

  renderOracleView(container);
  bindOracleEvents();
  subscribe(() => updateOracleView());
  updateOracleView();
}

function renderOracleView(container) {
  container.innerHTML = `
    <div class="swap-wrapper" style="max-width:960px;margin:0 auto">
      
      <!-- Pipeline Header Banner -->
      <div class="swap-card" style="max-width:none">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:14px">
          <div>
            <h2 style="font-family:var(--font-heading);font-size:22px;margin-bottom:4px">🔮 The Graph & Chainlink Functions Pipeline</h2>
            <p style="color:var(--text-secondary);font-size:13.5px;margin:0">
              Off-chain historical price indexing via The Graph, verified compute and on-chain bridging via Chainlink Functions DON.
            </p>
          </div>
          <span class="mode-badge" style="background:rgba(16,185,129,0.15);color:var(--accent-green);border-color:rgba(16,185,129,0.35)">
            ● Pipeline Operational
          </span>
        </div>

        <!-- 3 Nodes Status Grid -->
        <div class="grid g3">
          <div class="stat">
            <div class="l">The Graph Subgraph</div>
            <div class="v" style="font-size:17px;color:var(--text-primary)">v4-indexer-subgraph</div>
            <div style="font-size:11.5px;color:var(--accent-green);margin-top:4px">● Indexing Block #18920421</div>
          </div>
          <div class="stat">
            <div class="l">Chainlink Functions DON</div>
            <div class="v" style="font-size:17px;color:var(--secondary)">fun-ethereum-sepolia-1</div>
            <div style="font-size:11.5px;color:var(--secondary);margin-top:4px">● DON Active (300k gas limit)</div>
          </div>
          <div class="stat">
            <div class="l">Hook Keeper Binding</div>
            <div class="v" style="font-size:17px;color:var(--accent-green)">Latched (One-Time)</div>
            <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px">KEEPER = Consumer.sol</div>
          </div>
        </div>
      </div>

      <!-- Staleness Fail-Safe Monitor -->
      <div class="grid g2" style="width:100%">
        <div class="swap-card" style="max-width:none">
          <div class="swap-header">
            <div class="swap-title" style="font-size:17px">
              <span>⏱️ Oracle Staleness &amp; Fail-Safe Gauge</span>
            </div>
            <span class="mode-badge" id="oracle-staleness-badge">Data Fresh</span>
          </div>

          <p style="font-size:12.5px;color:var(--text-secondary);margin-bottom:14px">
            If off-chain data fails or exceeds <code>MAX_STALENESS (3600s)</code>, the hook <strong>never reverts swaps</strong>. It automatically defaults to the <strong>High Tier Fee (1.00%)</strong> to protect LPs.
          </p>

          <div style="background:var(--bg-card-inner);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:14px;margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px">
              <span>Data Age:</span>
              <strong style="font-family:var(--font-mono)" id="oracle-age-text">4m 12s ago</strong>
            </div>
            <div style="width:100%;height:8px;background:rgba(255,255,255,0.06);border-radius:var(--radius-full);overflow:hidden">
              <div id="oracle-staleness-bar" style="width:7%;height:100%;background:var(--accent-green);border-radius:var(--radius-full);transition:all 0.4s ease"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-top:6px">
              <span>0s (Fresh)</span>
              <span>1800s (Half)</span>
              <span style="color:var(--accent-danger)">3600s (MAX_STALENESS)</span>
            </div>
          </div>

          <div style="display:flex;gap:10px">
            <button class="btn sm" id="btn-trigger-don" style="flex:1">
              ⚡ Request Volatility from DON
            </button>
            <button class="btn sm ghost" id="btn-toggle-stale">
              Simulate Stale Oracle
            </button>
          </div>
        </div>

        <!-- Real-Time Metrics & Off-Chain Computation -->
        <div class="swap-card" style="max-width:none">
          <div class="swap-header">
            <div class="swap-title" style="font-size:17px">
              <span>🧮 Off-Chain Volatility Engine</span>
            </div>
            <span class="mode-badge" style="background:rgba(99,102,241,0.12);color:#a5b4fc">JavaScript in DON</span>
          </div>

          <p style="font-size:12.5px;color:var(--text-secondary);margin-bottom:12px">
            Realized volatility is calculated by querying the 100 most recent swap intervals from The Graph:
          </p>

          <div style="background:rgba(10,14,22,0.6);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:12px;font-family:var(--font-mono);font-size:11.5px;color:var(--text-secondary);margin-bottom:14px;overflow-x:auto">
            <code>// functions/volatility-source.js</code><br/>
            <code>const query = '{ swaps(first:100, orderBy:timestamp) { sqrtPriceX96 } }';</code><br/>
            <code>const stdDev = calculateAnnualizedVol(swaps);</code><br/>
            <code>return Functions.encodeUint256(Math.round(stdDev));</code>
          </div>

          <div class="trade-details" style="margin:0">
            <div class="detail-row">
              <span>Latest Metric Written On-Chain</span>
              <span class="detail-val good" id="metric-onchain-val">65 bps</span>
            </div>
            <div class="detail-row">
              <span>Resulting Dynamic LP Tier</span>
              <span class="detail-val" id="metric-tier-val">Low Fee (0.05%)</span>
            </div>
            <div class="detail-row">
              <span>Gas Used by Chainlink Callback</span>
              <span class="detail-val">103,763 gas</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Recent Subgraph FeeApplied & VolatilityUpdated Events -->
      <div class="swap-card" style="max-width:none">
        <h3 style="font-size:16px;margin-bottom:12px">📡 Live Subgraph Event Stream (The Graph)</h3>
        
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12.5px;text-align:left">
            <thead>
              <tr style="border-bottom:1px solid var(--border-subtle);color:var(--text-muted)">
                <th style="padding:8px">Event</th>
                <th style="padding:8px">Tier Fee</th>
                <th style="padding:8px">Applied Fee</th>
                <th style="padding:8px">MEV Triggered</th>
                <th style="padding:8px">Block / Timestamp</th>
              </tr>
            </thead>
            <tbody id="subgraph-event-rows">
              <tr style="border-bottom:1px solid rgba(255,255,255,0.04)">
                <td style="padding:8px"><code style="color:var(--primary)">FeeApplied</code></td>
                <td style="padding:8px">0.05%</td>
                <td style="padding:8px;font-weight:700;color:var(--accent-green)">0.05%</td>
                <td style="padding:8px">false</td>
                <td style="padding:8px;color:var(--text-muted)">#18920420 · Just now</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.04)">
                <td style="padding:8px"><code style="color:var(--secondary)">VolatilityUpdated</code></td>
                <td style="padding:8px">—</td>
                <td style="padding:8px;font-weight:700">65 bps</td>
                <td style="padding:8px">—</td>
                <td style="padding:8px;color:var(--text-muted)">#18920418 · 4m ago</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.04)">
                <td style="padding:8px"><code style="color:var(--primary)">FeeApplied</code></td>
                <td style="padding:8px">0.05%</td>
                <td style="padding:8px;font-weight:700;color:var(--accent-danger)">🚨 5.00% (Spike)</td>
                <td style="padding:8px;color:var(--accent-danger);font-weight:700">true</td>
                <td style="padding:8px;color:var(--text-muted)">#18920412 · 12m ago</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </div>
  `;
}

function bindOracleEvents() {
  const btnTrigger = document.getElementById('btn-trigger-don');
  const btnStale = document.getElementById('btn-toggle-stale');

  btnTrigger.addEventListener('click', () => {
    if (isSimulatingOracleCall) return;
    isSimulatingOracleCall = true;
    btnTrigger.disabled = true;
    btnTrigger.textContent = '⏳ Querying Subgraph & DON...';

    setTimeout(() => {
      // Simulate receiving fresh volatility metric from DON
      state.pool.lastVolatilityUpdate = Date.now();
      state.pool.volatilityMetric = Math.floor(Math.random() * 80) + 40; // 40-120 bps
      isSimulatingOracleCall = false;
      btnTrigger.disabled = false;
      btnTrigger.textContent = '⚡ Request Volatility from DON';

      showToast(`DON callback fulfilled! New volatility: ${state.pool.volatilityMetric} bps. Timestamp updated.`, 'success');
      notify();
    }, 1200);
  });

  btnStale.addEventListener('click', () => {
    const isCurrentlyStale = (Date.now() - state.pool.lastVolatilityUpdate) > (state.pool.maxStaleness * 1000);
    if (!isCurrentlyStale) {
      // Make it stale: warp time backwards by 2 hours
      state.pool.lastVolatilityUpdate = Date.now() - (7200 * 1000);
      showToast('Simulated Oracle Failure: Data age > 3600s. Hook fail-safe locks fee to 1.00% High Tier!', 'warn');
    } else {
      // Refresh
      state.pool.lastVolatilityUpdate = Date.now();
      showToast('Oracle data refreshed: Timestamp restored to fresh state.', 'success');
    }
    notify();
  });
}

function updateOracleView() {
  const ageSeconds = Math.floor((Date.now() - state.pool.lastVolatilityUpdate) / 1000);
  const maxStaleness = state.pool.maxStaleness;
  const isStale = ageSeconds > maxStaleness;

  const ageTextEl = document.getElementById('oracle-age-text');
  if (ageTextEl) {
    const mins = Math.floor(ageSeconds / 60);
    const secs = ageSeconds % 60;
    ageTextEl.textContent = `${mins}m ${secs}s ago (${isStale ? 'STALE' : 'FRESH'})`;

    const barEl = document.getElementById('oracle-staleness-bar');
    const pct = Math.min(100, Math.max(5, (ageSeconds / maxStaleness) * 100));
    barEl.style.width = `${pct}%`;
    barEl.style.background = isStale ? 'var(--accent-danger)' : pct > 60 ? 'var(--accent-warn)' : 'var(--accent-green)';

    const badgeEl = document.getElementById('oracle-staleness-badge');
    if (isStale) {
      badgeEl.textContent = '🚨 Stale (High Tier 1.00% Locked)';
      badgeEl.style.background = 'rgba(239,68,68,0.15)';
      badgeEl.style.color = 'var(--accent-danger)';
      badgeEl.style.borderColor = 'rgba(239,68,68,0.3)';
    } else {
      badgeEl.textContent = 'Data Fresh (Low Tier Active)';
      badgeEl.style.background = 'rgba(16,185,129,0.12)';
      badgeEl.style.color = 'var(--accent-green)';
      badgeEl.style.borderColor = 'rgba(16,185,129,0.25)';
    }

    document.getElementById('metric-onchain-val').textContent = `${state.pool.volatilityMetric} bps`;
    document.getElementById('metric-tier-val').textContent = 
      isStale ? '1.00% (Fail-Safe Locked)' : 
      state.pool.volatilityMetric <= 100 ? 'Low Fee (0.05%)' : 
      state.pool.volatilityMetric <= 500 ? 'Medium Fee (0.30%)' : 'High Fee (1.00%)';
  }
}
