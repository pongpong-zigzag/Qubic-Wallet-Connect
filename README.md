# Qubic Wallet Connect

Modern onboarding surface that unifies four credential sources—native Qubic
wallets, MetaMask, private seed phrases, and encrypted vault exports—inside a
single Next.js experience.

## Features

- Qubic handshake flow with real-time status indicators.
- MetaMask (Qubic Snap) bridge that installs the official Qubic Wallet Snap and
  streams Qubic account telemetry straight from MetaMask Flask.
- Private seed / raw key validator that derives real Qubic identities, exposes
  deterministic public IDs, and queries balances from the RPC.
- Vault importer with drag & drop, hashing, zipped JSON extraction, and account
  hydration for `.qubic-vault` bundles.
- Tailwind-driven UI with responsive cards, blur effects, and security copy.

## Development

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` to interact with the dashboard. All wallet
actions are handled client-side; no credentials leave the browser.

## Environment

WalletConnect-powered Qubic pairing requires a Reown/WalletConnect project ID.
A project ID is configured as fallback: `c817fdbc74c97c9862e06acf315497a9`

For production, explicitly set:
```
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=c817fdbc74c97c9862e06acf315497a9
NEXT_PUBLIC_QUBIC_RPC_URL=https://rpc.qubic.org # optional override
NEXT_PUBLIC_QUBIC_SNAP_VERSION=1.0.7           # optional override
```

> **Critical for Production:** The project ID `c817fdbc74c97c9862e06acf315497a9` must have your production domain whitelisted in [WalletConnect Cloud](https://cloud.walletconnect.com). Without whitelisting, connections will fail with "origin not allowed" errors. See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed setup instructions.

MetaMask integration requires **MetaMask Flask** (Snaps-enabled) plus the public
Qubic Wallet Snap (`npm:@ardata-tech/qubic-wallet`). Override the snap identifier
with `NEXT_PUBLIC_QUBIC_SNAP_ID` only if you host a forked snap; otherwise the
default bundled here will auto-install from npm. If a custom snap ID fails to
resolve (for example, because the package is private or missing) the dashboard
now falls back to the official snap and surfaces a warning in the UI. The app
will prompt to install or refresh the active snap as needed.

For end-to-end wallet wiring examples (WalletConnect, Snaps, seed, vault), see
the official [HM25 frontend reference](https://github.com/icyblob/hm25-frontend/tree/main).

## Production

Deploy like any other Next.js App Router project (Vercel, Netlify, container).
Ensure the site is served over HTTPS so the Web Crypto API remains available for
seed hashing and vault checksums.

**See [DEPLOYMENT.md](./DEPLOYMENT.md) for a complete deployment guide**, including:
- WalletConnect Cloud configuration
- Environment variable setup
- Domain whitelisting
- Troubleshooting common issues
