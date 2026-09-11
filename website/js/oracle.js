/* ==========================================================================
   AdaptiveVol AMM - Oracle & Subgraph Pipeline (Soft Minimalist)
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
    <div style="max-width:960px;margin:10px auto 0;display:flex;flex-direction:column;gap:20px">
      
      <!-- Top Overview Card -->
      <div class="card">
        <div class="card-header" style="margin-bottom:12px">
          <div>
            <span class="card-title" style="font-size:18px">The Graph &amp; Chainlink Functions Pipeline</span>
            <p style="color:var(--text-muted);font-size:13px;margin-top:2px">
              Off-chain historical price indexing mapped to on-chain keeper updates via Chainlink DON.
            </p>
          </div>
          <span class="pill-badge green">Pipeline Active</span>
        </div>

        <!-- 3 Nodes Grid -->
        <div class="grid g3">
          <div class="stat-card">
            <div class="stat-label">The Graph Subgraph</div>
            <div class="stat-val" style="font-size:15px">v4-indexer-subgraph</div>
            <div class="stat-sub" style="display:flex;align-items:center;gap:5px;margin-top:6px">
              <span class="status-dot"></span>
              <span id="subgraph-indexing-block">Indexing block #${state.network.blockNumber.toLocaleString()}</span>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Chainlink Functions DON</div>
            <div class="stat-val" style="font-size:15px">fun-ethereum-sepolia-1</div>
            <div class="stat-sub" style="margin-top:6px">300,000 callback gas limit</div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Hook Keeper Binding</div>
            <div class="stat-val" style="font-size:15px">Latched (One-Time)</div>
            <div class="stat-sub" style="margin-top:6px">KEEPER = 0xbB83...AB733</div>
          </div>
        </div>
      </div>

      <!-- Verified On-Chain Deployments on Sepolia -->
      <div class="card" style="background:linear-gradient(135deg, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0.6) 100%)">
        <div class="card-header" style="margin-bottom:10px">
          <span class="card-title" style="font-size:15px">Verified Sepolia Deployments</span>
          <span class="pill-badge green">Etherscan Verified</span>
        </div>
        <div class="grid g2" style="font-size:12px;gap:12px">
          <div style="background:var(--bg-input);padding:10px 14px;border-radius:var(--radius-md);border:1px solid var(--border-subtle)">
            <div style="color:var(--text-muted);margin-bottom:4px">AdaptiveFeeHook (Uniswap v4 Dynamic Hook)</div>
            <a href="https://sepolia.etherscan.io/address/0xab4c103d0b4783d736e12ea01a98945f08122080#code" target="_blank" style="color:var(--accent-green);font-family:var(--font-mono);text-decoration:none;font-weight:600">
              0xab4c103d0b4783d736e12ea01a98945f08122080 ↗
            </a>
          </div>
          <div style="background:var(--bg-input);padding:10px 14px;border-radius:var(--radius-md);border:1px solid var(--border-subtle)">
            <div style="color:var(--text-muted);margin-bottom:4px">VolatilityFunctionsConsumer (Chainlink DON Keeper)</div>
            <a href="https://sepolia.etherscan.io/address/0xbb833c9853587f5c562b407d2d95b0f0509ab733#code" target="_blank" style="color:var(--primary);font-family:var(--font-mono);text-decoration:none;font-weight:600">
              0xbB833c9853587f5C562B407D2D95B0f0509AB733 ↗
            </a>
          </div>
        </div>
      </div>

      <!-- Main 2-Column: Staleness Monitor & Volatility Engine -->
      <div class="grid g2">
        
        <!-- Staleness Gauge Card -->
        <div class="card">
          <div class="card-header">
            <span class="card-title" style="font-size:15px">Staleness &amp; Fail-Safe Gauge</span>
            <span class="pill-badge green" id="oracle-staleness-badge">Data Fresh</span>
          </div>

          <p style="font-size:12px;color:var(--text-muted);margin-bottom:14px">
            If oracle data exceeds 3,600s, swaps continue smoothly at the High Tier (1.00%) fee without reverting.
          </p>

          <div style="background:var(--bg-input);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:14px;margin-bottom:16px">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
              <span style="color:var(--text-muted)">Current Data Age:</span>
              <strong id="oracle-age-text" style="color:var(--text-main);font-weight:600">4m 12s ago</strong>
            </div>
            
            <div style="width:100%;height:6px;background:rgba(255,255,255,0.06);border-radius:var(--radius-full);overflow:hidden">
              <div id="oracle-staleness-bar" style="width:7%;height:100%;background:var(--accent-green);border-radius:var(--radius-full);transition:all 0.3s ease"></div>
            </div>

            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-faint);margin-top:6px">
              <span>0s (Fresh)</span>
              <span>1,800s (Half)</span>
              <span style="color:var(--accent-rose)">3,600s (MAX_STALENESS)</span>
            </div>
          </div>

          <div style="display:flex;gap:8px">
            <button class="btn-action" id="btn-trigger-don" style="font-size:13px;padding:8px 14px">
              Request Volatility from DON
            </button>
            <button class="btn-ghost" id="btn-toggle-stale">
              Simulate Stale Data
            </button>
          </div>
        </div>

        <!-- Metric Summary Card -->
        <div class="card">
          <div class="card-header">
            <span class="card-title" style="font-size:15px">Volatility Engine Metrics</span>
            <span class="pill-badge">On-Chain Hook Storage</span>
          </div>

          <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
            Historical swap price variance queried from The Graph and written into hook storage slots:
          </p>

          <div class="info-box">
            <div class="info-row">
              <span>Latest Metric on Hook</span>
              <span class="info-val" id="metric-onchain-val" style="color:var(--text-main)">65 bps</span>
            </div>
            <div class="info-row">
              <span>Dynamic LP Fee Tier</span>
              <span class="info-val" id="metric-tier-val" style="color:#34d399">Low Tier (0.05%)</span>
            </div>
            <div class="info-row">
              <span>Oracle Callback Gas</span>
              <span class="info-val">103,763 gas</span>
            </div>
            <div class="info-row">
              <span>Max Staleness Bound</span>
              <span class="info-val">3,600 seconds (1 hr)</span>
            </div>
          </div>

          <div style="font-size:12px;color:var(--text-faint);line-height:1.5">
            Fail-safe by design: Stale data never leaves liquidity open to low fees. The hook safely resolves missing or stale timestamps to HIGH_FEE.
          </div>
        </div>

      </div>

      <!-- Live Event Stream Table -->
      <div class="card">
        <span class="card-title" style="font-size:15px;display:block;margin-bottom:12px">Recent Hook Events (Indexed by Subgraph)</span>
        
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left">
            <thead>
              <tr style="border-bottom:1px solid var(--border-subtle);color:var(--text-faint)">
                <th style="padding:8px 6px;font-weight:500">Event</th>
                <th style="padding:8px 6px;font-weight:500">Tier Fee</th>
                <th style="padding:8px 6px;font-weight:500">Applied Fee</th>
                <th style="padding:8px 6px;font-weight:500">MEV Overridden</th>
                <th style="padding:8px 6px;font-weight:500">Block / Time</th>
              </tr>
            </thead>
            <tbody id="subgraph-event-rows">
              <tr style="border-bottom:1px solid rgba(255,255,255,0.03)">
                <td style="padding:10px 6px"><span class="pill-badge" style="color:var(--primary)">FeeApplied</span></td>
                <td style="padding:10px 6px;color:var(--text-muted)">0.05%</td>
                <td style="padding:10px 6px;font-weight:600;color:var(--text-main)">0.05%</td>
                <td style="padding:10px 6px;color:var(--text-faint)">No</td>
                <td style="padding:10px 6px;color:var(--text-faint)" id="row-block-1">#11,679,574 · Just now</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.03)">
                <td style="padding:10px 6px"><span class="pill-badge">VolatilityUpdated</span></td>
                <td style="padding:10px 6px;color:var(--text-muted)">—</td>
                <td style="padding:10px 6px;font-weight:600;color:var(--text-main)">65 bps</td>
                <td style="padding:10px 6px;color:var(--text-faint)">—</td>
                <td style="padding:10px 6px;color:var(--text-faint)" id="row-block-2">#11,679,568 · 1m ago</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.03)">
                <td style="padding:10px 6px"><span class="pill-badge rose">FeeApplied</span></td>
                <td style="padding:10px 6px;color:var(--text-muted)">0.05%</td>
                <td style="padding:10px 6px;font-weight:600;color:var(--accent-rose)">5.00% (Spike)</td>
                <td style="padding:10px 6px;color:var(--accent-rose);font-weight:500">Yes</td>
                <td style="padding:10px 6px;color:var(--text-faint)" id="row-block-3">#11,679,550 · 5m ago</td>
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
    btnTrigger.textContent = 'Querying DON...';

    setTimeout(() => {
      state.pool.lastVolatilityUpdate = Date.now();
      state.pool.volatilityMetric = Math.floor(Math.random() * 80) + 40;
      isSimulatingOracleCall = false;
      btnTrigger.disabled = false;
      btnTrigger.textContent = 'Request Volatility from DON';

      showToast(`DON callback fulfilled. Volatility: ${state.pool.volatilityMetric} bps`, 'success');
      notify();
    }, 1000);
  });

  btnStale.addEventListener('click', () => {
    const isCurrentlyStale = (Date.now() - state.pool.lastVolatilityUpdate) > (state.pool.maxStaleness * 1000);
    if (!isCurrentlyStale) {
      state.pool.lastVolatilityUpdate = Date.now() - (7200 * 1000);
      showToast('Oracle failure simulated: Data age > 3600s. Fee locked to 1.00% High Tier.', 'warn');
    } else {
      state.pool.lastVolatilityUpdate = Date.now();
      showToast('Oracle restored: Timestamp is fresh.', 'success');
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
    ageTextEl.textContent = `${mins}m ${secs}s ago (${isStale ? 'Stale' : 'Fresh'})`;

    const barEl = document.getElementById('oracle-staleness-bar');
    const pct = Math.min(100, Math.max(5, (ageSeconds / maxStaleness) * 100));
    barEl.style.width = `${pct}%`;
    barEl.style.background = isStale ? 'var(--accent-rose)' : pct > 60 ? 'var(--accent-amber)' : 'var(--accent-green)';

    const badgeEl = document.getElementById('oracle-staleness-badge');
    if (isStale) {
      badgeEl.textContent = 'Stale (1.00% Locked)';
      badgeEl.className = 'pill-badge rose';
    } else {
      badgeEl.textContent = 'Data Fresh';
      badgeEl.className = 'pill-badge green';
    }

    document.getElementById('metric-onchain-val').textContent = `${state.pool.volatilityMetric} bps`;
    document.getElementById('metric-tier-val').textContent = 
      isStale ? 'High Tier (1.00% Locked)' : 
      state.pool.volatilityMetric <= 100 ? 'Low Tier (0.05%)' : 
      state.pool.volatilityMetric <= 500 ? 'Medium Tier (0.30%)' : 'High Tier (1.00%)';
  }

  // Update dynamic block indicators
  const subBlockEl = document.getElementById('subgraph-indexing-block');
  if (subBlockEl) {
    subBlockEl.textContent = `Indexing block #${state.network.blockNumber.toLocaleString()}`;
  }

  const row1 = document.getElementById('row-block-1');
  if (row1) row1.textContent = `#${state.network.blockNumber.toLocaleString()} · Just now`;
  const row2 = document.getElementById('row-block-2');
  if (row2) row2.textContent = `#${(state.network.blockNumber - 4).toLocaleString()} · 1m ago`;
  const row3 = document.getElementById('row-block-3');
  if (row3) row3.textContent = `#${(state.network.blockNumber - 18).toLocaleString()} · 4m ago`;
}
