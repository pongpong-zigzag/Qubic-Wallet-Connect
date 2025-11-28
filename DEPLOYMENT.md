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
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=c817fdbc74c97c9862e06acf315497a9
```

**Important Notes:**
- The project ID `c817fdbc74c97c9862e06acf315497a9` is configured as the fallback and will be used if `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is not set.
- **For production deployments**, you should still set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` explicitly in your deployment platform's environment variables.
- **Critical:** You must whitelist your production domain in WalletConnect Cloud (https://cloud.walletconnect.com) for the project ID `c817fdbc74c97c9862e06acf315497a9`. Without whitelisting, connections will fail with "Unauthorized: origin not allowed" errors.

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
   - Add `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` with value: `c817fdbc74c97c9862e06acf315497a9`
   - Optionally add other variables
   - **Note:** Even though this is the fallback, setting it explicitly ensures consistency

3. **Configure WalletConnect Cloud** (CRITICAL)
   - Go to https://cloud.walletconnect.com
   - Find your project with ID: `c817fdbc74c97c9862e06acf315497a9`
   - Navigate to **Allowed Origins** or **Domain Whitelist**
   - Add your Vercel deployment URL(s):
     - `https://your-project.vercel.app` (your Vercel deployment)
     - `https://your-custom-domain.com` (if using custom domain)
   - **This step is required** - without it, WalletConnect connections will fail

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

**Cause:** Your production domain isn't whitelisted in WalletConnect Cloud for project ID `c817fdbc74c97c9862e06acf315497a9`.

**Symptoms:**
- QR code and URI will generate (you'll see them)
- Connection will fail when wallet tries to connect
- Error message: "origin not allowed" or code 3000
- Console shows: "Fatal socket error: WebSocket connection closed abnormally with code: 3000"

**Fix:**
1. Go to https://cloud.walletconnect.com
2. Find your project with ID: `c817fdbc74c97c9862e06acf315497a9`
3. Navigate to **Allowed Origins** or **Domain Whitelist**
4. Add your production domain(s):
   - `https://your-project.vercel.app`
   - `https://your-custom-domain.com` (if applicable)
5. Ensure `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=c817fdbc74c97c9862e06acf315497a9` is set in your deployment platform
6. Redeploy your application after whitelisting

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

For local development, the configured WalletConnect project ID (`c817fdbc74c97c9862e06acf315497a9`) will work automatically. No configuration needed unless you want to test with a different project ID.

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` - WalletConnect will work out of the box.

**Note:** If `localhost` isn't whitelisted in your WalletConnect Cloud project, you may see connection errors. You can either:
- Add `http://localhost:3000` to the allowed origins in WalletConnect Cloud
- Or set a different `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` for local development

