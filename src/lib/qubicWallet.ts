import SignClient from "@walletconnect/sign-client";
import type { ProposalTypes, SignClientTypes } from "@walletconnect/types";

const QUBIC_METHODS = [
  "qubic_requestAccounts",
  "qubic_sendQubic",
  "qubic_signTransaction",
  "qubic_sendTransaction",
  "qubic_sign",
  "qubic_sendAsset",
] as const;

const QUBIC_EVENTS = [
  "accountsChanged",
  "amountChanged",
  "assetAmountChanged",
] as const;

// Use optionalNamespaces instead of requiredNamespaces (deprecated in WalletConnect v2)
export const QUBIC_OPTIONAL_NAMESPACES: ProposalTypes.OptionalNamespaces = {
  qubic: {
    chains: ["qubic:mainnet"],
    methods: [...QUBIC_METHODS],
    events: [...QUBIC_EVENTS],
  },
};

// Keep requiredNamespaces for backward compatibility, but it will be auto-assigned to optionalNamespaces
export const QUBIC_REQUIRED_NAMESPACES: ProposalTypes.RequiredNamespaces =
  QUBIC_OPTIONAL_NAMESPACES as ProposalTypes.RequiredNamespaces;

const getMetadata = (): SignClientTypes.Metadata => ({
  name: "Qubic Wallet Connect",
  description:
    "Unified dashboard for Qubic Wallet, MetaMask Snap, seed, and vault onboarding.",
  url:
    typeof window !== "undefined"
      ? window.location.origin
      : "https://wallet.qubic.org",
  icons: [
    "https://wallet.qubic.org/assets/qubic-icon.png",
    "https://wallet.qubic.org/assets/qubic-gradient.png",
  ],
});

const FALLBACK_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ||
  "c817fdbc74c97c9862e06acf315497a9";

const clientCache = new Map<string, Promise<SignClient>>();

export const getQubicSignClient = async (
  projectId: string = FALLBACK_PROJECT_ID,
) => {
  if (typeof window === "undefined") {
    throw new Error("Qubic Wallet is only available in the browser runtime.");
  }

  if (!projectId) {
    throw new Error(
      "WalletConnect project ID missing. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID or rely on the default HackMadrid ID.",
    );
  }

  if (!clientCache.has(projectId)) {
    // Configure logger to suppress noisy WebSocket errors when using fallback project ID
    const logger = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
      ? undefined // Use default logger for custom project IDs
      : "error"; // Only show errors for fallback project ID to reduce console noise

    clientCache.set(
      projectId,
      SignClient.init({
        projectId,
        metadata: getMetadata(),
        logger,
      }),
    );
  }

  return clientCache.get(projectId)!;
};

export const buildQubicDeepLink = (uri: string) =>
  `qubic-wallet://pairwc/${uri}`;

