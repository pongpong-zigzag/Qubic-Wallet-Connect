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

export const QUBIC_REQUIRED_NAMESPACES: ProposalTypes.RequiredNamespaces = {
  qubic: {
    chains: ["qubic:mainnet"],
    methods: [...QUBIC_METHODS],
    events: [...QUBIC_EVENTS],
  },
};

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
  "2d3b11ae82b87043a64c8abd87f865c8";

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
    clientCache.set(projectId, SignClient.init({ projectId, metadata: getMetadata() }));
  }

  return clientCache.get(projectId)!;
};

export const buildQubicDeepLink = (uri: string) =>
  `qubic-wallet://pairwc/${uri}`;

