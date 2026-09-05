# Project: amm-ethonline (ETHOnline 2026)

Project Solidity/web3 — hedging strategy pakai Uniswap & Aave.

## Aturan delegasi coding

Untuk task yang butuh nulis/edit/debug kode (Solidity, TypeScript, test, script):
1. JANGAN nulis kode sendiri.
2. Panggil Claude Code lewat terminal tool:
   cd /workspace/amm-ethonline && claude -p "<deskripsi task yang jelas>" --dangerously-skip-permissions
3. Laporin balik ringkasan output Claude Code ke user.

Untuk task ringan (cek status file, git status, baca log, jalanin test yang udah ada) — kerjain sendiri langsung, gak perlu delegasi.

Setelah Claude Code selesai, laporkan ke user dengan prefix "🤖 [via Claude Code]" di awal pesan, biar jelas beda dari respons Hermes langsung.
