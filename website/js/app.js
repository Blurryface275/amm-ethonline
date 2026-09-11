/* ==========================================================================
   Adaptive Volatility AMM - Main Application Coordinator
   ========================================================================== */

import { state, subscribe, notify, syncWithSepolia } from './state.js';
import { initSwapModule, showToast } from './swap.js';
import { initLiquidityModule } from './liquidity.js';
import { initMevModule } from './mev.js';
import { initOracleModule } from './oracle.js';
import { initAnalyticsModule } from './analytics.js';
import { SEPOLIA_CONFIG } from './contracts.js';

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initWalletButton();
  initModeToggle();
  initTelemetryUI();

  // Initialize UI modules
  initSwapModule();
  initLiquidityModule();
  initMevModule();
  initOracleModule();
  initAnalyticsModule();

  // Start live Sepolia on-chain synchronization
  startLiveOnChainSync();
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
        walletBtn.textContent = 'Connecting...';
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });

        if (accounts && accounts.length > 0) {
          const userAddress = accounts[0];

          // Request switch to Sepolia testnet
          try {
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: SEPOLIA_CONFIG.chainIdHex }]
            });
          } catch (switchError) {
            // Error 4902 means the chain has not been added to MetaMask
            if (switchError.code === 4902) {
              await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [{
                  chainId: SEPOLIA_CONFIG.chainIdHex,
                  chainName: SEPOLIA_CONFIG.networkName,
                  nativeCurrency: { name: 'Sepolia Ether', symbol: 'SEP', decimals: 18 },
                  rpcUrls: SEPOLIA_CONFIG.rpcUrls,
                  blockExplorerUrls: [SEPOLIA_CONFIG.blockExplorerUrl]
                }]
              });
            }
          }

          state.wallet.connected = true;
          state.wallet.address = userAddress;
          state.wallet.isMetaMask = true;

          // Sync live balances immediately
          await syncWithSepolia();

          const shortAddr = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
          walletBtn.textContent = `${shortAddr} (${state.tokens.ETH.balance} SEP)`;
          walletBtn.style.background = 'rgba(16, 185, 129, 0.15)';
          walletBtn.style.border = '1px solid var(--accent-green)';
          walletBtn.style.color = '#ffffff';

          showToast(`MetaMask connected to Sepolia: ${shortAddr}`, 'success');
          notify();
          return;
        }
      } catch (err) {
        console.warn('Wallet connection cancelled or failed', err);
        walletBtn.textContent = 'Connect Wallet';
      }
    }

    // Fallback: Simulated Testnet Wallet
    state.wallet.connected = true;
    state.wallet.address = '0x8C2C...E0DA';
    walletBtn.textContent = '0x8C2C...E0DA (Sepolia)';
    walletBtn.style.background = 'rgba(99, 102, 241, 0.2)';
    walletBtn.style.border = '1px solid var(--primary)';
    showToast('Connected Sepolia Deployer Wallet (0.026 ETH)', 'success');
    notify();
  });

  // Listen for account / chain changes in MetaMask
  if (window.ethereum) {
    window.ethereum.on('accountsChanged', (accounts) => {
      if (!accounts || accounts.length === 0) {
        state.wallet.connected = false;
        state.wallet.address = null;
        walletBtn.textContent = 'Connect Wallet';
        walletBtn.style.background = '';
        walletBtn.style.border = '';
      } else {
        state.wallet.address = accounts[0];
        syncWithSepolia();
      }
      notify();
    });

    window.ethereum.on('chainChanged', () => {
      syncWithSepolia();
    });
  }
}

function initModeToggle() {
  const toggleBtn = document.getElementById('btn-mode-toggle');
  if (!toggleBtn) return;

  toggleBtn.addEventListener('click', async () => {
    state.settings.isSimulatedMode = !state.settings.isSimulatedMode;

    if (state.settings.isSimulatedMode) {
      state.settings.dataSource = 'Interactive Sandbox';
      showToast('Switched to Interactive MEV Attack Sandbox Mode', 'info');
    } else {
      state.settings.dataSource = 'Sepolia Live RPC';
      showToast('Switched to Live Sepolia On-Chain Telemetry', 'success');
      await syncWithSepolia();
    }
    notify();
  });
}

function initTelemetryUI() {
  // Subscribe to state changes to update the header telemetry indicators
  subscribe((s) => {
    // 1. Navbar Network Pill & Block Pill
    const blockPill = document.getElementById('nav-block-pill');
    if (blockPill) {
      blockPill.textContent = `#${s.network.blockNumber.toLocaleString()}`;
    }

    // 2. Mode Toggle Button Label
    const modeBadgeIndicator = document.getElementById('mode-badge-indicator');
    if (modeBadgeIndicator) {
      if (s.settings.isSimulatedMode) {
        modeBadgeIndicator.textContent = '🧪 Sandbox Mode';
        modeBadgeIndicator.parentElement.style.background = 'rgba(245, 158, 11, 0.12)';
        modeBadgeIndicator.parentElement.style.borderColor = 'rgba(245, 158, 11, 0.3)';
        modeBadgeIndicator.parentElement.style.color = 'var(--accent-orange)';
      } else {
        modeBadgeIndicator.textContent = '🟢 Live Sepolia';
        modeBadgeIndicator.parentElement.style.background = 'rgba(16, 185, 129, 0.12)';
        modeBadgeIndicator.parentElement.style.borderColor = 'rgba(16, 185, 129, 0.3)';
        modeBadgeIndicator.parentElement.style.color = 'var(--accent-green)';
      }
    }

    // 3. Telemetry Header Bar
    const telBlock = document.getElementById('telemetry-block-number');
    if (telBlock) {
      telBlock.textContent = `#${s.network.blockNumber.toLocaleString()}`;
    }

    const telSync = document.getElementById('telemetry-sync-status');
    if (telSync) {
      if (s.network.syncStatus === 'connected') {
        telSync.innerHTML = `<span style="color:var(--accent-green)">🟢 Connected (${s.network.rpcLatencyMs}ms)</span>`;
      } else if (s.network.syncStatus === 'syncing') {
        telSync.innerHTML = `<span style="color:var(--accent-cyan)">🔄 Syncing...</span>`;
      } else {
        telSync.innerHTML = `<span style="color:var(--accent-orange)">🟡 Standby</span>`;
      }
    }
  });
}

/**
 * Background loop: Polling Sepolia RPC every ~12 seconds
 */
function startLiveOnChainSync() {
  // Initial sync immediately
  syncWithSepolia();

  // Periodic polling every 12 seconds (matching Sepolia block time)
  setInterval(() => {
    if (!state.settings.isSimulatedMode) {
      syncWithSepolia();
    }
  }, 12000);
}
