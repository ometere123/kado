# Kado

DeFi + Agent Economy demo on Solana devnet. Five Anchor programs, one token ($RLO), one interface.

## Programs

| Program | Description |
|---------|-------------|
| **Vault** | Stake $RLO to earn yield; borrow against your position |
| **Flux AMM** | Constant-product AMM for swapping $RLO ↔ USDC |
| **Streamline** | Schedule recurring on-chain payments, executed automatically by a server-side crank |
| **Lockbox** | Send tokens via a one-time claim link (`kado://claim/...`) |
| **Forge** | Post and claim bounties (Grid UI) |

## Stack

- **Chain** — Solana devnet
- **Programs** — Anchor 0.31.1 / Rust
- **Frontend** — Next.js 14 (App Router), Tailwind CSS, @coral-xyz/anchor
- **Wallet** — Solana Wallet Adapter (Phantom, Backpack, etc.)

## Getting started

```bash
# Install dependencies
cd app
npm install

# Set up environment
cp .env.example .env.local
# Fill in NEXT_PUBLIC_RPC_URL, FAUCET_KEYPAIR, CRANK_KEYPAIR

# Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_RPC_URL` | Solana RPC endpoint (default: devnet) |
| `FAUCET_KEYPAIR` | Base58 keypair for the $RLO faucet |
| `CRANK_KEYPAIR` | Base58 keypair for the Streamline auto-pay crank |

> Both keypairs should hold devnet SOL to cover transaction fees.

## Features

- **Auto-pay crank** — Streamline payments execute automatically server-side; no wallet interaction needed after schedule creation
- **Explorer picker** — Switch between Solana FM, Solscan, and Explorer in the header
- **Faucet** — Request devnet $RLO directly from the UI
- **Claim links** — Lockbox generates `kado://claim/...` links redeemable by any wallet

## Notes

- Devnet only — no real funds involved
- $RLO is a demo token with no monetary value
