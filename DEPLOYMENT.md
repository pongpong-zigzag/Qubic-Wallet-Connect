# Deployment Guide

This guide covers deploying Qubic Wallet Connect to production environments like Vercel.

## Prerequisites

1. **WalletConnect Cloud Account**
   - Sign up at https://cloud.walletconnect.com
   - Create a new project
   - Copy your Project ID

2. **Production Domain**
   - Have your production domain ready (e.g., `your-app.vercel.app` or custom domain)

## Environment Variables

Set these in your deployment platform (Vercel, Netlify, etc.):

### Required

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id_here
```

**Important:** The fallback project ID (`2d3b11ae82b87043a64c8abd87f865c8`) only works for `localhost` and will fail in production with "Unauthorized: origin not allowed" errors.

### Optional

```bash
# Override Qubic RPC endpoint (defaults to https://rpc.qubic.org)
NEXT_PUBLIC_QUBIC_RPC_URL=https://rpc.qubic.org

# Override MetaMask Snap (defaults to npm:@ardata-tech/qubic-wallet)
NEXT_PUBLIC_QUBIC_SNAP_ID=npm:@ardata-tech/qubic-wallet
NEXT_PUBLIC_QUBIC_SNAP_VERSION=1.0.7
```

## WalletConnect Cloud Configuration

After creating your WalletConnect project:

1. Go to your project settings in WalletConnect Cloud
2. Navigate to **Allowed Origins** or **Domain Whitelist**
3. Add your production domain(s):
   - `https://your-app.vercel.app`
   - `https://your-custom-domain.com`
   - Include both `https://` and `http://` variants if needed
   - Include subdomains if applicable

**Without this step, WalletConnect connections will fail with code 3000 errors.**

## Vercel Deployment

1. **Connect Repository**
   ```bash
   vercel
   ```

2. **Set Environment Variables**
   - Go to Project Settings → Environment Variables
   - Add `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` with your project ID
   - Optionally add other variables

3. **Configure WalletConnect Cloud**
   - Add your Vercel deployment URL to allowed origins
   - Format: `https://your-project.vercel.app`

4. **Redeploy**
   - Trigger a new deployment after setting environment variables
   - The build will use your production WalletConnect project ID

## Verification Checklist

After deployment, verify:

- [ ] WalletConnect QR code appears when clicking "Pair Qubic Wallet"
- [ ] No "origin not allowed" errors in browser console
- [ ] MetaMask Snap installs correctly (if MetaMask Flask is installed)
- [ ] Seed phrase validation works
- [ ] Vault file import works
- [ ] All wallet connection methods show appropriate status messages

## Troubleshooting

### "Unauthorized: origin not allowed" (code 3000)

**Cause:** Your production domain isn't whitelisted in WalletConnect Cloud.

**Fix:**
1. Check that `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set correctly
2. Verify your domain is added to WalletConnect Cloud allowed origins
3. Ensure you're using `https://` (not `http://`) in production

### MetaMask Snap fails to install

**Cause:** MetaMask Flask not installed or snap ID misconfigured.

**Fix:**
1. Verify user has MetaMask Flask installed (not regular MetaMask)
2. Check `NEXT_PUBLIC_QUBIC_SNAP_ID` if using a custom snap
3. The UI will show an "Install MetaMask Flask" button if MetaMask isn't detected

### Build succeeds but wallet connections fail

**Cause:** Environment variables not available at runtime.

**Fix:**
1. Ensure all `NEXT_PUBLIC_*` variables are set in your deployment platform
2. Redeploy after adding environment variables
3. Check browser console for specific error messages

## Local Development

For local development, the fallback WalletConnect project ID will work automatically. No configuration needed unless you want to test production-like behavior.

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` - WalletConnect will work out of the box.

