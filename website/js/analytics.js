/* ==========================================================================
   Adaptive Volatility AMM - Production DEX Explore & Analytics Module
   ========================================================================== */

import { state, subscribe } from './state.js';
import { SEPOLIA_CONFIG } from './contracts.js';

export function initAnalyticsModule() {
  const container = document.getElementById('analytics-container');
  if (!container) return;

  renderAnalyticsView(container);
  subscribe(() => updateAnalyticsView());
  updateAnalyticsView();
}

function renderAnalyticsView(container) {
  container.innerHTML = `
    <div style="max-width:1040px;margin:10px auto 0;display:flex;flex-direction:column;gap:24px">
      
      <!-- Top Market Overview KPIs -->
      <div class="grid g4">
        <div class="stat-card">
          <div class="stat-label">Total Pool TVL</div>
          <div class="stat-val" id="stat-tvl">$2,000,000</div>
          <div class="stat-sub" id="stat-tvl-sub">1,000 ETH · 1,000 USDC</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">24h Trading Volume</div>
          <div class="stat-val" id="stat-volume">$48,920</div>
          <div class="stat-sub">+12.4% last 24h</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">Current Dynamic Fee</div>
          <div class="stat-val" style="color:var(--accent-green)" id="stat-current-fee">0.05%</div>
          <div class="stat-sub" id="stat-fee-sub">Low Volatility Tier</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">MEV Shield Status</div>
          <div class="stat-val" style="color:var(--accent-blue)">Active</div>
          <div class="stat-sub">100 bps threshold · 5% spike</div>
        </div>
      </div>

      <!-- Verified Pools Table -->
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title" style="font-size:16px">Liquidity Pools</h2>
            <p style="color:var(--text-muted);font-size:12px;margin-top:2px">
              Uniswap v4 dynamic hook pools deployed on Ethereum Sepolia
            </p>
          </div>
          <span class="pill-badge green">1 Pool Live</span>
        </div>

        <div class="table-responsive">
          <table class="dex-table">
            <thead>
              <tr>
                <th>Pool</th>
                <th>Fee Tier</th>
                <th>TVL</th>
                <th>24h Volume</th>
                <th>Est. APR</th>
                <th>Pool ID</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <div style="display:flex;align-items:center;gap:10px">
                    <span style="font-size:18px">🔷💵</span>
                    <div>
                      <strong style="color:var(--text-main)">ETH / USDC</strong>
                      <div style="font-size:11px;color:var(--text-muted)">Uniswap v4 Hook</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span class="pill-badge green" id="pool-fee-badge">0.05% Dynamic</span>
                </td>
                <td id="table-tvl">$2,000,000</td>
                <td id="table-volume">$48,920</td>
                <td style="color:var(--accent-green);font-weight:600">24.5%</td>
                <td>
                  <a href="https://sepolia.etherscan.io/address/${SEPOLIA_CONFIG.contracts.poolManager}" target="_blank" class="table-link" title="Canonical PoolManager">
                    0xbcbe...2bab ↗
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Real-Time On-Chain Transaction Stream -->
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title" style="font-size:16px">Recent Transactions</h2>
            <p style="color:var(--text-muted);font-size:12px;margin-top:2px">
              Live on-chain swaps and liquidity events settled on Sepolia
            </p>
          </div>
          <span class="pill-badge">Sepolia (11155111)</span>
        </div>

        <div class="table-responsive">
          <table class="dex-table" id="tx-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Details</th>
                <th>Transaction Hash</th>
                <th>Time</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="tx-table-body">
              <!-- Dynamically rendered -->
            </tbody>
          </table>
        </div>
      </div>

    </div>
  `;
}

function updateAnalyticsView() {
  const pool = state.pool;
  const price = pool.currentPrice || 1.0;
  const tvlUSD = (pool.reserve0 * price) + pool.reserve1;

  const tvlEl = document.getElementById('stat-tvl');
  if (tvlEl) {
    tvlEl.textContent = `$${tvlUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    const subEl = document.getElementById('stat-tvl-sub');
    if (subEl) {
      subEl.textContent = `${pool.reserve0.toLocaleString(undefined, { maximumFractionDigits: 0 })} ETH · ${pool.reserve1.toLocaleString(undefined, { maximumFractionDigits: 0 })} USDC`;
    }
  }

  const volEl = document.getElementById('stat-volume');
  if (volEl) volEl.textContent = `$${pool.totalVolumeUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const feeEl = document.getElementById('stat-current-fee');
  const feeSub = document.getElementById('stat-fee-sub');
  const feeBadge = document.getElementById('pool-fee-badge');

  const feeData = state.pool.volatilityMetric <= state.pool.lowVolMax ? '0.05%' : state.pool.volatilityMetric <= state.pool.mediumVolMax ? '0.30%' : '1.00%';
  const feeTierText = state.pool.volatilityMetric <= state.pool.lowVolMax ? 'Low Volatility Tier' : state.pool.volatilityMetric <= state.pool.mediumVolMax ? 'Medium Volatility Tier' : 'High Volatility Tier';

  if (feeEl) feeEl.textContent = feeData;
  if (feeSub) feeSub.textContent = feeTierText;
  if (feeBadge) feeBadge.textContent = `${feeData} Dynamic`;

  const tblTvl = document.getElementById('table-tvl');
  if (tblTvl) tblTvl.textContent = `$${tvlUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const tblVol = document.getElementById('table-volume');
  if (tblVol) tblVol.textContent = `$${pool.totalVolumeUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  // Update Recent Transactions Table
  const tbody = document.getElementById('tx-table-body');
  if (tbody) {
    if (state.recentTransactions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px">No transactions recorded yet</td></tr>`;
      return;
    }

    tbody.innerHTML = state.recentTransactions.map(tx => {
      const timeAgo = formatTimeAgo(tx.timestamp);
      const shortHash = `${tx.hash.slice(0, 10)}...${tx.hash.slice(-8)}`;
      const isSwap = tx.type.toLowerCase().includes('swap');

      return `
        <tr>
          <td>
            <span class="pill-badge ${isSwap ? 'blue' : 'green'}" style="font-size:11px">
              ${tx.type}
            </span>
          </td>
          <td style="color:var(--text-main);font-size:13px">${tx.details}</td>
          <td>
            <a href="https://sepolia.etherscan.io/tx/${tx.hash}" target="_blank" class="table-link" title="Inspect on Sepolia Etherscan">
              ${shortHash} ↗
            </a>
          </td>
          <td style="color:var(--text-muted);font-size:12px">${timeAgo}</td>
          <td>
            <span class="status-dot-mini confirmed"></span>
            <span style="color:var(--accent-green);font-size:12px;font-weight:500">Confirmed</span>
          </td>
        </tr>
      `;
    }).join('');
  }
}

function formatTimeAgo(timestamp) {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  return `${diffHours}h ago`;
}
