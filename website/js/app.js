/* ==========================================================================
   Adaptive Volatility AMM - Main Application Coordinator
   ========================================================================== */

import { state, notify } from './state.js';
import { initSwapModule, showToast } from './swap.js';
import { initLiquidityModule } from './liquidity.js';
import { initMevModule } from './mev.js';
import { initOracleModule } from './oracle.js';
import { initAnalyticsModule } from './analytics.js';

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initWalletButton();
  initSwapModule();
  initLiquidityModule();
  initMevModule();
  initOracleModule();
  initAnalyticsModule();
});

function initNavigation() {
  const tabs = document.querySelectorAll('.nav-tab');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.target;
      if (!targetId) return;

      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPane = document.getElementById(targetId);
      if (targetPane) {
        targetPane.classList.add('active');
      }
    });
  });
}

function initWalletButton() {
  const walletBtn = document.getElementById('btn-wallet-connect');
  if (!walletBtn) return;

  walletBtn.addEventListener('click', async () => {
    if (window.ethereum) {
      try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (accounts.length > 0) {
          state.wallet.connected = true;
          state.wallet.address = accounts[0];
          walletBtn.textContent = `${accounts[0].slice(0, 6)}...${accounts[0].slice(-4)}`;
          walletBtn.style.background = 'rgba(16, 185, 129, 0.2)';
          walletBtn.style.border = '1px solid var(--accent-green)';
          showToast(`Wallet connected: ${accounts[0].slice(0, 6)}...${accounts[0].slice(-4)}`, 'success');
          notify();
          return;
        }
      } catch (e) {
        console.warn('Wallet connection cancelled', e);
      }
    }

    // Fallback: Simulated Wallet Account
    state.wallet.connected = true;
    state.wallet.address = '0x71C...B82F';
    walletBtn.textContent = '0x71C...B82F (Demo)';
    walletBtn.style.background = 'rgba(99, 102, 241, 0.2)';
    walletBtn.style.border = '1px solid var(--primary)';
    showToast('Connected in Demo Sandbox Mode (10 ETH seeded)', 'success');
    notify();
  });
}
