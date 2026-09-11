/* ==========================================================================
   Adaptive DEX - Application Coordinator (Live Sepolia Web3)
   ========================================================================== */

import { state, subscribe, notify, syncWithSepolia } from './state.js?v=5';
import { initSwapModule, showToast } from './swap.js?v=5';
import { initLiquidityModule } from './liquidity.js?v=5';
import { initMevModule } from './mev.js?v=5';
import { initOracleModule } from './oracle.js?v=5';
import { initAnalyticsModule } from './analytics.js?v=5';
import { SEPOLIA_CONFIG, getWeb3Signer, sendClaimFaucetTx } from './contracts.js?v=5';

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initWalletButton();
  initNavFaucetButton();
  initTelemetryUI();

  // Initialize UI modules
  initSwapModule();
  initLiquidityModule();
  initAnalyticsModule();
  initMevModule();
  initOracleModule();

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

          await syncWithSepolia();

          const shortAddr = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
          walletBtn.textContent = `${shortAddr} (${state.wallet.nativeBalance} SEP)`;
          walletBtn.style.background = 'rgba(16, 185, 129, 0.15)';
          walletBtn.style.border = '1px solid var(--accent-green)';
          walletBtn.style.color = '#ffffff';

          showToast(`MetaMask connected: ${shortAddr}`, 'success');
          notify();
          return;
        }
      } catch (err) {
        console.warn('Wallet connection error:', err);
        walletBtn.textContent = 'Connect Wallet';
      }
    } else {
      showToast('MetaMask not detected. Please install MetaMask to trade on Sepolia.', 'warn');
    }
  });

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

function initNavFaucetButton() {
  const faucetBtn = document.getElementById('btn-nav-faucet');
  if (!faucetBtn) return;

  faucetBtn.addEventListener('click', async () => {
    if (!state.wallet.connected) {
      const connectBtn = document.getElementById('btn-wallet-connect');
      if (connectBtn) connectBtn.click();
      showToast('Connect your wallet first to claim test tokens', 'info');
      return;
    }

    try {
      showToast('Confirm test token mint in MetaMask', 'info');
      const signer = await getWeb3Signer();
      if (!signer) throw new Error('No Web3 wallet signer available');

      const tx = await sendClaimFaucetTx(signer, state.wallet.address, 'BOTH');
      showToast('Minting 1,000 ETH and 1,000 USDC on Sepolia...', 'info', tx.hash);

      await tx.wait(1);
      showToast('Successfully minted 1,000 ETH & 1,000 USDC!', 'success', tx.hash);
      await syncWithSepolia();
    } catch (err) {
      console.error('Faucet claim error:', err);
      showToast(err.reason || err.message || 'Faucet mint rejected', 'error');
    }
  });
}

function initTelemetryUI() {
  subscribe((s) => {
    const blockPill = document.getElementById('nav-block-pill');
    if (blockPill) {
      blockPill.textContent = `#${s.network.blockNumber.toLocaleString()}`;
    }

    const telBlock = document.getElementById('telemetry-block-number');
    if (telBlock) {
      telBlock.textContent = `#${s.network.blockNumber.toLocaleString()}`;
    }

    const telSync = document.getElementById('telemetry-sync-status');
    if (telSync) {
      if (s.network.syncStatus === 'connected') {
        telSync.innerHTML = `<span style="color:var(--accent-green)">🟢 Connected (${s.network.rpcLatencyMs}ms)</span>`;
      } else if (s.network.syncStatus === 'syncing') {
        telSync.innerHTML = `<span style="color:var(--accent-blue)">🔄 Syncing...</span>`;
      } else {
        telSync.innerHTML = `<span style="color:var(--accent-orange)">🟡 Standby</span>`;
      }
    }

    // Update wallet button if balance changed
    if (s.wallet.connected && s.wallet.address) {
      const walletBtn = document.getElementById('btn-wallet-connect');
      if (walletBtn) {
        const shortAddr = `${s.wallet.address.slice(0, 6)}...${s.wallet.address.slice(-4)}`;
        walletBtn.textContent = `${shortAddr} (${s.wallet.nativeBalance} SEP)`;
      }
    }
  });
}

function startLiveOnChainSync() {
  syncWithSepolia();
  // Poll Sepolia block and states every 12 seconds
  setInterval(() => {
    syncWithSepolia();
  }, 12000);
}
