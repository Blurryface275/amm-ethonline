/* ==========================================================================
   Adaptive DEX - Application Coordinator (Live Sepolia Web3)
   ========================================================================== */

import { state, subscribe, notify, syncWithSepolia } from './state.js';
import { initSwapModule, showToast } from './swap.js';
import { initLiquidityModule } from './liquidity.js';
import { initMevModule } from './mev.js';
import { initOracleModule } from './oracle.js';
import { initAnalyticsModule } from './analytics.js';
import { SEPOLIA_CONFIG, getWeb3Signer, sendClaimFaucetTx } from './contracts.js';

document.addEventListener('DOMContentLoaded', async () => {
  initNavigation();
  initWalletButton();
  initNavFaucetButton();
  initTelemetryUI();

  initSwapModule();
  initLiquidityModule();
  initAnalyticsModule();
  initMevModule();
  initOracleModule();

  // Auto-connect if already authorized in MetaMask
  await checkExistingConnection();

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

async function checkExistingConnection() {
  if (!window.ethereum) return;
  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts && accounts.length > 0) {
      state.wallet.connected = true;
      state.wallet.address = accounts[0];
      state.wallet.isMetaMask = true;
      updateWalletUI();
      await syncWithSepolia();
      notify();
    }
  } catch (_) {}
}

function updateWalletUI() {
  const walletBtn = document.getElementById('btn-wallet-connect');
  if (!walletBtn) return;

  if (state.wallet.connected && state.wallet.address) {
    const shortAddr = `${state.wallet.address.slice(0, 6)}...${state.wallet.address.slice(-4)}`;
    walletBtn.textContent = `${shortAddr} (${state.wallet.nativeBalance} SEP)`;
    walletBtn.style.background = 'rgba(16, 185, 129, 0.15)';
    walletBtn.style.border = '1px solid var(--accent-green)';
    walletBtn.style.color = '#ffffff';
  } else {
    walletBtn.textContent = 'Connect Wallet';
    walletBtn.style.background = '';
    walletBtn.style.border = '';
    walletBtn.style.color = '';
  }
}

function initWalletButton() {
  const walletBtn = document.getElementById('btn-wallet-connect');
  if (!walletBtn) return;

  walletBtn.addEventListener('click', async () => {
    if (!window.ethereum) {
      showToast('MetaMask not detected. Please install MetaMask to trade on Sepolia.', 'warn');
      return;
    }

    try {
      walletBtn.textContent = 'Connecting...';
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });

      if (accounts && accounts.length > 0) {
        const userAddress = accounts[0];
        state.wallet.connected = true;
        state.wallet.address = userAddress;
        state.wallet.isMetaMask = true;

        try {
          const currentChain = await window.ethereum.request({ method: 'eth_chainId' });
          if (currentChain !== SEPOLIA_CONFIG.chainIdHex) {
            try {
              await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: SEPOLIA_CONFIG.chainIdHex }]
              });
            } catch (switchError) {
              console.warn('Network switch warning:', switchError);
              showToast('Please set your MetaMask network to Sepolia Testnet', 'warn');
            }
          }
        } catch (_) {}

        await syncWithSepolia();
        updateWalletUI();
        showToast(`MetaMask connected: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`, 'success');
        notify();
      } else {
        updateWalletUI();
      }
    } catch (err) {
      console.warn('Wallet connection error:', err);
      updateWalletUI();
    }
  });

  if (window.ethereum) {
    window.ethereum.on('accountsChanged', async (accounts) => {
      if (!accounts || accounts.length === 0) {
        state.wallet.connected = false;
        state.wallet.address = null;
        updateWalletUI();
      } else {
        state.wallet.connected = true;
        state.wallet.address = accounts[0];
        updateWalletUI();
        await syncWithSepolia();
      }
      notify();
    });

    window.ethereum.on('chainChanged', async () => {
      await syncWithSepolia();
      notify();
    });
  }
}

function initNavFaucetButton() {
  const faucetBtn = document.getElementById('btn-nav-faucet');
  if (!faucetBtn) return;

  let isNavClaiming = false;

  faucetBtn.addEventListener('click', async () => {
    if (!state.wallet.connected) {
      const connectBtn = document.getElementById('btn-wallet-connect');
      if (connectBtn) connectBtn.click();
      showToast('Connect your wallet first to claim test tokens', 'info');
      return;
    }

    if (isNavClaiming) return;

    // Check if user already has plenty of test tokens
    if (state.tokens.ETH.balance >= 1000 && state.tokens.USDC.balance >= 1000) {
      showToast(`You already have ${state.tokens.ETH.balance} ETH & ${state.tokens.USDC.balance} USDC test tokens!`, 'info');
    }

    try {
      isNavClaiming = true;
      faucetBtn.disabled = true;
      faucetBtn.innerHTML = '<span class="spinner"></span> <span>Minting...</span>';
      showToast('Confirm test token mint in MetaMask', 'info');

      const signer = await getWeb3Signer();
      if (!signer) throw new Error('No Web3 wallet signer available');

      const tx = await sendClaimFaucetTx(signer, state.wallet.address, 'BOTH');
      showToast('Minting 1,000 ETH and 1,000 USDC on Sepolia...', 'info', tx.hash);

      await tx.wait(1);
      isNavClaiming = false;
      faucetBtn.disabled = false;
      faucetBtn.innerHTML = '<span>🚰 Faucet</span>';

      showToast('Successfully minted 1,000 ETH & 1,000 USDC!', 'success', tx.hash);
      await syncWithSepolia();
      notify();
    } catch (err) {
      isNavClaiming = false;
      faucetBtn.disabled = false;
      faucetBtn.innerHTML = '<span>🚰 Faucet</span>';

      console.error('Faucet claim error:', err);
      const msg = err.reason || err.shortMessage || err.message || '';
      if (msg.includes('in-flight transaction limit') || msg.includes('delegated accounts')) {
        showToast('Minting transaction already in-flight on Sepolia. Syncing balances...', 'info');
        await syncWithSepolia();
        notify();
      } else {
        showToast(msg || 'Faucet mint rejected', 'warn');
      }
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

    updateWalletUI();
  });
}

function startLiveOnChainSync() {
  syncWithSepolia();
  setInterval(() => {
    syncWithSepolia();
  }, 12000);
}
