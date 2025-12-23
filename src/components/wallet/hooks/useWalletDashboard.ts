"use client";

import JSZip from "jszip";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import type SignClient from "@walletconnect/sign-client";
import type { SessionTypes, SignClientTypes } from "@walletconnect/types";
import { QubicVault } from "@qubic-lib/qubic-ts-vault-library";

import {
  buildQubicDeepLink,
  getQubicSignClient,
  QUBIC_OPTIONAL_NAMESPACES,
} from "@/lib/qubicWallet";
import type {
  DerivedIdentity,
  IdentitySnapshot,
} from "@/lib/qubicIdentity";
import {
  deriveIdentityFromPrivateKey,
  deriveIdentityFromSeed,
  fetchIdentitySnapshot,
} from "@/lib/qubicIdentity";

const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || undefined;
const SDK_ERRORS = {
  USER_DISCONNECTED: { code: 6000, message: "User disconnected" },
} as const;

const getSdkError = (key: keyof typeof SDK_ERRORS) => SDK_ERRORS[key];
// Public WalletConnect project ID that works for demos (may require domain whitelisting for production)
const WALLETCONNECT_FALLBACK_PROJECT_ID =
  "197942ee5616373eb5a46007404eeffe";
// Use fallback in all environments to ensure URI/QR code generation works
// Connection may fail in production if domain isn't whitelisted, but at least QR code will appear
const EFFECTIVE_WALLETCONNECT_PROJECT_ID =
  WALLETCONNECT_PROJECT_ID ?? WALLETCONNECT_FALLBACK_PROJECT_ID;
const DEFAULT_QUBIC_SNAP_ID = "npm:@ardata-tech/qubic-wallet";
const QUBIC_SNAP_ID =
  process.env.NEXT_PUBLIC_QUBIC_SNAP_ID ?? DEFAULT_QUBIC_SNAP_ID;
const QUBIC_SNAP_VERSION =
  process.env.NEXT_PUBLIC_QUBIC_SNAP_VERSION ?? "1.0.7";
export const QUBIC_WALLET_URL = "https://wallet.qubic.org/";
const METAMASK_FLASK_URL = "https://metamask.io/";

type ConnectionState = "idle" | "connecting" | "connected" | "error";

type SeedState =
  | { state: "idle"; message?: string }
  | { state: "invalid"; message: string }
  | {
      state: "processing";
      message: string;
    }
  | {
      state: "ready";
      message: string;
      fingerprint: string;
      descriptor: string;
      identity?: SeedIdentityDetails;
    };

type VaultState =
  | { state: "idle"; message?: string }
  | { state: "processing"; message: string }
  | {
      state: "ready";
      message: string;
      fileName: string;
      size: number;
      checksum: string;
      summary?: VaultSummary;
      accounts?: VaultAccount[];
    }
  | { state: "error"; message: string };

type VaultSummary = {
  accounts?: number;
  lastUpdated?: string;
};

type VaultFileAccount = {
  name?: string;
  alias?: string;
  seed?: string;
  privateKey?: string;
  publicKey?: string;
  publicId?: string;
  password?: string;
};

type VaultUpload = {
  file: File;
  buffer: ArrayBuffer;
  name: string;
  size: number;
  checksum: string;
};

type SeedIdentityDetails = {
  publicId: string;
  publicKeyHex: string;
  privateKeyHex: string;
  balance?: string;
  ownedAssetCount?: number;
};

type VaultAccount = {
  name?: string;
  source: "seed" | "privateKey" | "publicKey" | "unknown";
  publicId: string;
  balance?: string;
};

type NativeQubicAccount = {
  address?: string;
  name?: string;
  amount?: number;
};

type SeedClassification =
  | { valid: true; descriptor: string }
  | { valid: false };

type QubicAsset = {
  assetName: string;
  issuerIdentity: string;
  ownedAmount: number;
};

type QubicAccount = {
  address: string;
  name?: string;
  amount?: number;
  assets?: QubicAsset[];
};

type QubicSession = {
  topic: string;
  address: string;
  chainId: string;
  expiry?: number;
  walletName?: string;
  walletUrl?: string;
  accounts?: QubicAccount[];
  transport: "native" | "walletconnect";
};

type StatusDescriptor = {
  label: string;
  state: ConnectionState;
  description?: string;
};

export type {
  ConnectionState,
  StatusDescriptor,
  SeedState,
  VaultState,
  VaultUpload,
  VaultAccount,
  QubicAccount,
  QubicSession,
};

const digestHex = async (data: string | ArrayBuffer): Promise<string> => {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    throw new Error("Secure context required to hash payload.");
  }

  const source =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : new Uint8Array(data);

  const buffer = await window.crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const shorten = (value?: string | null, size = 4) => {
  if (!value) return "";
  return value.length <= size * 2 + 2
    ? value
    : `${value.slice(0, size)}…${value.slice(-size)}`;
};

const parseVaultSummary = (raw: string): VaultSummary | undefined => {
  try {
    const parsed = JSON.parse(raw) as {
      accounts?: unknown;
      updatedAt?: string;
      lastUpdated?: string;
    };

    const accounts = Array.isArray(parsed.accounts)
      ? parsed.accounts.length
      : undefined;

    return {
      accounts,
      lastUpdated: parsed.updatedAt ?? parsed.lastUpdated,
    };
  } catch {
    return undefined;
  }
};

const classifySeed = (seed: string): SeedClassification => {
  const normalized = seed.trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  const isMnemonic = words.length >= 12 && words.length <= 24;
  const compact = normalized.replace(/\s+/g, "");
  const isHex = /^[0-9a-fA-F]{64}$/u.test(compact);

  if (isMnemonic) {
    return {
      valid: true,
      descriptor: `${words.length}-word mnemonic`,
    };
  }

  if (isHex) {
    return {
      valid: true,
      descriptor: "64-character private key",
    };
  }

  return { valid: false };
};

const QUBIC_SEED_REGEX = /^[a-z]{55,}$/u;
const HEX_PRIVATE_KEY_REGEX = /^[0-9a-fA-F]{64}$/u;
const QUBIC_IDENTITY_REGEX = /^[A-Z]{60}$/u;

const isQubicSeed = (value: string) => QUBIC_SEED_REGEX.test(value);
const isHexPrivateKey = (value: string) =>
  HEX_PRIVATE_KEY_REGEX.test(value.replace(/^0x/, ""));
const isQubicIdentity = (value: string) =>
  QUBIC_IDENTITY_REGEX.test(value);

const buildSeedIdentityDetails = (
  details: DerivedIdentity,
  snapshot?: IdentitySnapshot,
): SeedIdentityDetails => ({
  publicId: details.publicId,
  publicKeyHex: details.publicKeyHex,
  privateKeyHex: details.privateKeyHex,
  balance: snapshot?.balance?.balance,
  ownedAssetCount: Array.isArray(snapshot?.ownedAssets)
    ? snapshot?.ownedAssets.length
    : undefined,
});

const isZipArchive = (buffer: ArrayBuffer) => {
  if (buffer.byteLength < 4) return false;
  const signature = new Uint8Array(buffer.slice(0, 4));
  return signature[0] === 0x50 && signature[1] === 0x4b;
};

const extractVaultText = async (buffer: ArrayBuffer) => {
  if (!isZipArchive(buffer)) {
    return new TextDecoder().decode(buffer);
  }

  const zip = await JSZip.loadAsync(buffer);
  const files = Object.values(zip.files);
  const jsonFile =
    files.find((file) => !file.dir && file.name.endsWith(".json")) ??
    files.find((file) => !file.dir);

  if (!jsonFile) {
    throw new Error("Vault archive does not contain any readable entries.");
  }

  return jsonFile.async("string");
};

const safeJsonParse = (text: string) => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const looksEncryptedVault = (value: unknown) =>
  Boolean(
    value &&
      typeof value === "object" &&
      "cipher" in value &&
      "iv" in value &&
      "salt" in value,
  );

const isEncryptedVaultText = (text: string) => looksEncryptedVault(safeJsonParse(text));

const normalizeSeedInput = (value: string) => value.trim().toLowerCase();
const normalizePrivateKeyInput = (value: string) =>
  value.trim().replace(/^0x/i, "");

const buildWatchOnlyAccount = async (
  publicId: string,
  name?: string,
): Promise<VaultAccount> => {
  const snapshot = await fetchIdentitySnapshot(publicId);
  return {
    name: name ?? "Watch-only account",
    source: "publicKey",
    publicId,
    balance: snapshot.balance?.balance,
  };
};

const deriveVaultAccount = async (
  entry: VaultFileAccount,
): Promise<VaultAccount | null> => {
  const label = entry.name ?? entry.alias;

  if (entry.seed) {
    const normalizedSeed = normalizeSeedInput(entry.seed);
    if (isQubicSeed(normalizedSeed)) {
      const details = await deriveIdentityFromSeed(normalizedSeed);
      const snapshot = await fetchIdentitySnapshot(details.publicId);
      return {
        name: label,
        source: "seed",
        publicId: details.publicId,
        balance: snapshot.balance?.balance,
      };
    }
  }

  if (entry.privateKey) {
    const normalizedKey = normalizePrivateKeyInput(entry.privateKey);
    if (isHexPrivateKey(normalizedKey)) {
      const details = await deriveIdentityFromPrivateKey(normalizedKey);
      const snapshot = await fetchIdentitySnapshot(details.publicId);
      return {
        name: label,
        source: "privateKey",
        publicId: details.publicId,
        balance: snapshot.balance?.balance,
      };
    }
  }

  const identityCandidate = entry.publicId ?? entry.publicKey;
  if (identityCandidate && isQubicIdentity(identityCandidate)) {
    return buildWatchOnlyAccount(identityCandidate, label);
  }

  return null;
};

const collectVaultEntries = (value: unknown): VaultFileAccount[] => {
  const results: VaultFileAccount[] = [];
  const consume = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      candidate.forEach((item) => {
        if (item && typeof item === "object") {
          results.push(item as VaultFileAccount);
        }
      });
    }
  };

  if (Array.isArray(value)) {
    consume(value);
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    ["accounts", "wallets", "seeds", "entries", "data"].forEach((key) => {
      if (Array.isArray(obj[key])) {
        consume(obj[key]);
      }
    });
    if (!results.length) {
      Object.values(obj).forEach((val) => {
        if (Array.isArray(val)) {
          consume(val);
        }
      });
    }
  }
  return results;
};

const deriveVaultAccounts = async (entries: VaultFileAccount[]) => {
  const derived = await Promise.all(
    entries.map(async (entry) => {
      try {
        return await deriveVaultAccount(entry);
      } catch (error) {
        console.warn("Failed to derive vault entry", entry.name ?? entry.alias, error);
        return null;
      }
    }),
  );

  const accounts = derived.filter(
    (account): account is VaultAccount => Boolean(account),
  );

  if (!accounts.length) {
    throw new Error(
      "No compatible seeds, private keys, or identities were found in this vault file.",
    );
  }

  return accounts;
};

const parsePlainVaultFile = async (text: string) => {
  const parsed = safeJsonParse(text);
  if (!parsed) {
    throw new Error("Vault file is not valid JSON.");
  }
  const entries = collectVaultEntries(parsed);
  if (!entries.length) {
    throw new Error("This vault file does not contain any account entries.");
  }
  return deriveVaultAccounts(entries);
};

const textToArrayBuffer = (text: string) =>
  new TextEncoder().encode(text).buffer;

const parseQubicAccountString = (value?: string) => {
  if (!value) return null;
  const [namespace, chainId, address] = value.split(":");
  if (!namespace || !chainId || !address) return null;
  return { namespace, chainId, address };
};

const formatExpiryRelative = (timestamp?: number) => {
  if (!timestamp) return "—";
  const diff = timestamp - Date.now();
  if (diff <= 0) return "expired";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
};

const formatAbsoluteDate = (timestamp?: number) => {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString();
};

const buildStatusDescriptor = (
  label: string,
  state: ConnectionState,
  description?: string,
): StatusDescriptor => ({
  label,
  state,
  description,
});

export const useWalletDashboard = () => {
  const [qubicStatus, setQubicStatus] = useState<ConnectionState>("idle");
  const [qubicMessage, setQubicMessage] = useState<string>();
  const [qubicSession, setQubicSession] = useState<QubicSession | null>(null);
  const [walletConnectUri, setWalletConnectUri] = useState<string | null>(null);
  const [qubicReady, setQubicReady] = useState(false);
  const signClientRef = useRef<SignClient | null>(null);
  const qubicSessionRef = useRef<QubicSession | null>(null);

  const [metaStatus, setMetaStatus] = useState<ConnectionState>("idle");
  const [metaMessage, setMetaMessage] = useState<string>();
  const [snapAccounts, setSnapAccounts] = useState<QubicAccount[]>([]);
  const [metamaskAvailable, setMetamaskAvailable] = useState(false);

  const [seedInput, setSeedInput] = useState("");
  const [seedState, setSeedState] = useState<SeedState>({ state: "idle" });
  const [seedVisible, setSeedVisible] = useState(false);

  const [vaultState, setVaultState] = useState<VaultState>({
    state: "idle",
  });
  const [vaultPassword, setVaultPassword] = useState("");
  const [vaultUpload, setVaultUpload] = useState<VaultUpload | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const walletConnectProjectId = EFFECTIVE_WALLETCONNECT_PROJECT_ID;
  const usingFallbackProjectId =
    !WALLETCONNECT_PROJECT_ID &&
    walletConnectProjectId === WALLETCONNECT_FALLBACK_PROJECT_ID;
  const [hasNativeQubic, setHasNativeQubic] = useState(false);
  const qubicVaultRef = useRef<QubicVault | null>(null);

  useEffect(() => {
    qubicSessionRef.current = qubicSession;
  }, [qubicSession]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const detect = () => {
      setHasNativeQubic(Boolean(window.qubic));
    };
    detect();
    const interval = window.setInterval(detect, 3000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setMetamaskAvailable(Boolean(window.ethereum?.request));
  }, []);

  // Polyfill crypto.randomUUID for older browsers/extensions
  useEffect(() => {
    if (typeof window === "undefined" || typeof crypto === "undefined") return;

    if (!crypto.randomUUID) {
      crypto.randomUUID = function () {
        // Fallback implementation using crypto.getRandomValues
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
        bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10
        const hex = Array.from(bytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        return [
          hex.slice(0, 8),
          hex.slice(8, 12),
          hex.slice(12, 16),
          hex.slice(16, 20),
          hex.slice(20, 32),
        ].join("-") as `${string}-${string}-${string}-${string}-${string}`;
      };
    }
  }, []);

  // Global error handler to suppress expected WalletConnect WebSocket errors
  useEffect(() => {
    if (typeof window === "undefined" || !usingFallbackProjectId) return;

    // Intercept console methods to filter WalletConnect noise
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    const originalConsoleLog = console.log;

    const shouldSuppress = (args: unknown[]): boolean => {
      // Check structured log objects (pino format)
      if (args.length > 0) {
        const firstArg = args[0];
        if (
          typeof firstArg === "object" &&
          firstArg !== null &&
          !Array.isArray(firstArg)
        ) {
          const obj = firstArg as Record<string, unknown>;
          // Check for pino logger structure
          if (
            (obj.Level === 60 || obj.level === 60) &&
            (obj.context === "core" || obj.context === "'core'")
          ) {
            const msg = String(obj.msg || "");
            if (
              msg.includes("Fatal socket error") ||
              msg.includes("code: 3000") ||
              msg.includes("Unauthorized: origin not allowed") ||
              msg.includes("WebSocket connection closed abnormally")
            ) {
              return true;
            }
          }
        }
      }

      // Check string messages
      const message = args.map((arg) => {
        if (typeof arg === "object" && arg !== null) {
          // Try to extract meaningful info from objects
          const obj = arg as Record<string, unknown>;
          return [
            obj.msg,
            obj.message,
            obj.context,
            obj.Level,
            obj.level,
            JSON.stringify(obj),
          ]
            .filter(Boolean)
            .join(" ");
        }
        return String(arg);
      }).join(" ");

      return (
        message.includes("code: 3000") ||
        message.includes("Unauthorized: origin not allowed") ||
        message.includes("WebSocket connection closed abnormally") ||
        message.includes("Fatal socket error") ||
        message.includes("Level: 60") ||
        message.includes("level: 60") ||
        message.includes("context: 'core'") ||
        message.includes('context: "core"')
      );
    };

    console.error = (...args: unknown[]) => {
      if (!shouldSuppress(args)) {
        originalConsoleError.apply(console, args);
      }
    };

    console.warn = (...args: unknown[]) => {
      if (!shouldSuppress(args)) {
        originalConsoleWarn.apply(console, args);
      }
    };

    console.log = (...args: unknown[]) => {
      if (!shouldSuppress(args)) {
        originalConsoleLog.apply(console, args);
      }
    };

    const handleError = (event: ErrorEvent) => {
      const message = event.message || String(event.error || "");
      if (shouldSuppress([message])) {
        event.preventDefault();
        event.stopPropagation();
        return false;
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const message = String(event.reason || "");
      if (shouldSuppress([message])) {
        event.preventDefault();
        return false;
      }
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
      console.log = originalConsoleLog;
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [usingFallbackProjectId]);

  const openMetamaskDownload = useCallback(() => {
    if (typeof window === "undefined") return;
    window.open(METAMASK_FLASK_URL, "_blank", "noreferrer");
  }, []);

  const unlockEncryptedVault = useCallback(
    async (upload: VaultUpload, password: string) => {
      if (!password.trim()) {
        throw new Error("Enter the password used to create this vault.");
      }

      const vault =
        qubicVaultRef.current ?? new QubicVault();
      qubicVaultRef.current = vault;

      await vault.importAndUnlock(true, password, null, upload.file);
      const seeds = vault.getSeeds().filter((seed) => !seed.isOnlyWatch);
      if (!seeds.length) {
        throw new Error("Vault unlocked but contains no spendable seeds.");
      }

      const accounts = await Promise.all(
        seeds.map(async (seed): Promise<VaultAccount | null> => {
          try {
            const revealedSeed = await vault.revealSeed(seed.publicId);
            const details = await deriveIdentityFromSeed(revealedSeed);
            const snapshot = await fetchIdentitySnapshot(details.publicId);
            return {
              name: seed.alias ?? seed.publicId,
              source: "seed",
              publicId: details.publicId,
              balance: snapshot.balance?.balance,
            } satisfies VaultAccount;
          } catch (error) {
            console.warn("Failed to derive seed from vault", seed.publicId, error);
            return null;
          }
        }),
      );

      const usable = accounts.filter(
        (account): account is VaultAccount => Boolean(account),
      );

      if (!usable.length) {
        throw new Error("Unable to derive any accounts from this vault.");
      }

      return usable;
    },
    [],
  );

  const handleVaultUnlock = useCallback(async () => {
    if (!vaultUpload) {
      setVaultState({
        state: "error",
        message: "Upload an encrypted vault before unlocking.",
      });
      return;
    }

    setVaultState({
      state: "processing",
      message: "Unlocking encrypted vault…",
    });

    try {
      const accounts = await unlockEncryptedVault(vaultUpload, vaultPassword);
      setVaultUpload(null);
      setVaultPassword("");
      setVaultState({
        state: "ready",
        message: "Vault ready to unlock.",
        fileName: vaultUpload.name,
        size: vaultUpload.size,
        checksum: vaultUpload.checksum,
        summary: {
          accounts: accounts.length,
          lastUpdated: new Date().toISOString(),
        },
        accounts,
      });
    } catch (error) {
      setVaultState({
        state: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to unlock vault file.",
      });
    }
  }, [unlockEncryptedVault, vaultPassword, vaultUpload]);

  const hydrateQubicSession = useCallback((session: SessionTypes.Struct) => {
    const namespace = session.namespaces?.qubic;
    const primaryAccount = parseQubicAccountString(namespace?.accounts?.[0]);
    if (!namespace || !primaryAccount) return;

    const expiryMs =
      typeof session.expiry === "number" ? session.expiry * 1000 : undefined;

    setQubicSession((prev) => ({
      topic: session.topic,
      address: primaryAccount.address,
      chainId: primaryAccount.chainId,
      expiry: expiryMs,
      walletName: session.peer.metadata?.name,
      walletUrl: session.peer.metadata?.url,
      accounts: prev?.accounts,
      transport: "walletconnect",
    }));
    setQubicStatus("connected");
    setQubicMessage(
      `Linked ${shorten(primaryAccount.address)} · ${formatExpiryRelative(expiryMs)}`,
    );
  }, []);

  const fetchAccountsSnapshot = useCallback(
    async (client: SignClient, session: SessionTypes.Struct) => {
      try {
        const response = (await client.request({
          topic: session.topic,
          chainId: "qubic:mainnet",
          request: {
            method: "qubic_requestAccounts",
            params: [],
          },
        })) as QubicAccount[];

        if (Array.isArray(response) && response.length > 0) {
          setQubicSession((prev) =>
            prev
              ? {
                  ...prev,
                  accounts: response,
                }
              : prev,
          );
          setQubicMessage(
            `Primary ${shorten(response[0].address)} · ${response.length} account${
              response.length > 1 ? "s" : ""
            }`,
          );
        }
      } catch (error) {
        console.warn("Failed to query Qubic accounts", error);
      }
    },
    [],
  );

  useEffect(() => {
    if (!walletConnectProjectId) {
      setQubicStatus("error");
      setQubicMessage(
        "Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to enable Qubic wallet pairing.",
      );
      return;
    }

    let isMounted = true;
    let detach: (() => void) | undefined;

    (async () => {
      try {
        const client = await getQubicSignClient(walletConnectProjectId);
        if (!isMounted) return;
        signClientRef.current = client;
        setQubicReady(true);

        const existingSessions = client.session.getAll();
        const activeQubicSession = [...existingSessions]
          .reverse()
          .find((session) => Boolean(session.namespaces?.qubic));

        if (activeQubicSession) {
          hydrateQubicSession(activeQubicSession);
          await fetchAccountsSnapshot(client, activeQubicSession);
        }

        const handleSessionDelete = ({
          topic,
        }: SignClientTypes.EventArguments["session_delete"]) => {
          if (
            qubicSessionRef.current?.topic === topic &&
            qubicSessionRef.current.transport === "walletconnect"
          ) {
            setQubicSession(null);
            setQubicStatus("idle");
            setQubicMessage("Session closed by Qubic Wallet.");
          }
        };

        const handleSessionEvent = ({
          params,
        }: SignClientTypes.EventArguments["session_event"]) => {
          if (params.chainId !== "qubic:mainnet") return;
          const { name, data } = params.event;
          if (
            name === "accountsChanged" ||
            name === "amountChanged" ||
            name === "assetAmountChanged"
          ) {
            if (Array.isArray(data)) {
              setQubicSession((prev) =>
                prev
                  ? {
                      ...prev,
                      accounts: data as QubicAccount[],
                    }
                  : prev,
              );
            }
            setQubicMessage(`Wallet reported ${name.replace("Changed", " update")}.`);
          }
        };

        const handleSessionUpdate = ({
          topic,
        }: SignClientTypes.EventArguments["session_update"]) => {
          const session = client.session.get(topic);
          if (session) {
            hydrateQubicSession(session);
          }
        };

        client.on("session_delete", handleSessionDelete);
        client.on("session_event", handleSessionEvent);
        client.on("session_update", handleSessionUpdate);

        detach = () => {
          client.off("session_delete", handleSessionDelete);
          client.off("session_event", handleSessionEvent);
          client.off("session_update", handleSessionUpdate);
        };
      } catch (error) {
        if (!isMounted) return;
        setQubicStatus("error");
        setQubicMessage(
          error instanceof Error
            ? error.message
            : "Unable to initialize Qubic Wallet client.",
        );
      }
    })();

    return () => {
      isMounted = false;
      detach?.();
    };
  }, [
    fetchAccountsSnapshot,
    hydrateQubicSession,
    walletConnectProjectId,
    usingFallbackProjectId,
  ]);

  const seedConnectionState: ConnectionState =
    seedState.state === "ready"
      ? "connected"
      : seedState.state === "processing"
        ? "connecting"
        : seedState.state === "invalid"
          ? "error"
          : "idle";

  const vaultConnectionState: ConnectionState =
    vaultState.state === "ready"
      ? "connected"
      : vaultState.state === "processing"
        ? "connecting"
        : vaultState.state === "error"
          ? "error"
          : "idle";

  const statusDescriptors = useMemo(
    () => [
      buildStatusDescriptor("Qubic Wallet", qubicStatus, qubicMessage),
      buildStatusDescriptor("MetaMask", metaStatus, metaMessage),
      buildStatusDescriptor("Seed Import", seedConnectionState, seedState.message),
      buildStatusDescriptor("Vault File", vaultConnectionState, vaultState.message),
    ],
    [
      metaMessage,
      metaStatus,
      qubicMessage,
      qubicStatus,
      seedConnectionState,
      seedState,
      vaultConnectionState,
      vaultState,
    ],
  );

  const connectQubic = useCallback(async () => {
    const nativeProvider = typeof window !== "undefined" ? window.qubic : undefined;

    if (nativeProvider) {
      setQubicStatus("connecting");
      setQubicMessage("Requesting approval from installed Qubic Wallet…");
      try {
        const response = await nativeProvider.request({
          method: "qubic_requestAccounts",
        });

        const accountCandidate = Array.isArray(response)
          ? (response[0] as NativeQubicAccount | string | undefined)
          : (response as NativeQubicAccount | string | undefined);

        const structuredAccount =
          typeof accountCandidate === "object" && accountCandidate
            ? accountCandidate
            : undefined;

        const address =
          typeof accountCandidate === "string"
            ? accountCandidate
            : structuredAccount?.address;

        if (!address) {
          throw new Error("Unable to read account from native Qubic Wallet.");
        }

        setQubicSession({
          topic: "qubic-native-wallet",
          transport: "native",
          address,
          chainId: "qubic:mainnet",
          walletName: "Qubic Wallet",
          walletUrl: QUBIC_WALLET_URL,
          accounts: structuredAccount
            ? [
                {
                  address,
                  name: structuredAccount.name ?? "Primary",
                  amount:
                    typeof structuredAccount.amount === "number"
                      ? structuredAccount.amount
                      : undefined,
                },
              ]
            : undefined,
        });
        setQubicStatus("connected");
        setQubicMessage(`Linked ${shorten(address)} via native provider.`);
        return;
      } catch (error) {
        setQubicStatus("error");
        setQubicMessage(
          error instanceof Error
            ? error.message
            : "Native Qubic Wallet rejected the connection.",
        );
        return;
      }
    }

    if (!walletConnectProjectId) {
      setQubicStatus("error");
      setQubicMessage(
        "WalletConnect project ID missing. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.",
      );
      return;
    }

    setQubicStatus("connecting");
    setQubicMessage("Generating WalletConnect URI…");

    try {
      const client =
        signClientRef.current ?? (await getQubicSignClient(walletConnectProjectId));
      signClientRef.current = client;

      if (qubicSessionRef.current?.topic && qubicSessionRef.current.transport === "walletconnect") {
        await client.disconnect({
          topic: qubicSessionRef.current.topic,
          reason: getSdkError("USER_DISCONNECTED"),
        });
      }

      const { uri, approval } = await client.connect({
        optionalNamespaces: QUBIC_OPTIONAL_NAMESPACES,
      });

      if (uri) {
        setWalletConnectUri(uri);
        setQubicMessage("Scan the QR code in Qubic Wallet to approve.");
      }

      const session = await approval();
      setWalletConnectUri(null);
      hydrateQubicSession(session);
      await fetchAccountsSnapshot(client, session);
    } catch (error) {
      setWalletConnectUri(null);
      setQubicStatus("error");
      const message =
        error instanceof Error ? error.message : "WalletConnect pairing failed.";
      if (
        message.toLowerCase().includes("origin not allowed") ||
        message.includes("code: 3000")
      ) {
        const guidance = usingFallbackProjectId
          ? "The demo WalletConnect project ID doesn't allow this domain. Create your own project at https://cloud.walletconnect.com, whitelist this domain, and set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID."
          : "WalletConnect rejected this origin. Add this domain to your project at https://cloud.walletconnect.com and verify NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is set correctly.";
        setQubicMessage(guidance);
      } else {
        setQubicMessage(message);
      }
    }
  }, [
    fetchAccountsSnapshot,
    hydrateQubicSession,
    walletConnectProjectId,
    usingFallbackProjectId,
  ]);

  const disconnectQubic = useCallback(async () => {
    const session = qubicSessionRef.current;
    if (!session) return;

    if (session.transport === "walletconnect" && walletConnectProjectId) {
      try {
        const client =
          signClientRef.current ?? (await getQubicSignClient(walletConnectProjectId));
        await client.disconnect({
          topic: session.topic,
          reason: getSdkError("USER_DISCONNECTED"),
        });
      } catch (error) {
        console.warn("Failed to disconnect Qubic session", error);
      }
    }

    setQubicSession(null);
    setQubicStatus("idle");
    setQubicMessage("Disconnected from Qubic Wallet.");
  }, [walletConnectProjectId]);

  const cancelPairing = useCallback(() => {
    setWalletConnectUri(null);
    setQubicStatus(qubicSessionRef.current ? "connected" : "idle");
    setQubicMessage("Pairing request cancelled.");
  }, []);

  const walletConnectDeepLink = useMemo(
    () => (walletConnectUri ? buildQubicDeepLink(walletConnectUri) : undefined),
    [walletConnectUri],
  );

  const walletConnectWarning = useMemo(() => {
    if (hasNativeQubic) {
      return undefined;
    }
    if (!walletConnectProjectId) {
      return "Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to request WalletConnect sessions.";
    }
    if (usingFallbackProjectId) {
      return "Using demo WalletConnect project ID. For production, create your own at https://cloud.walletconnect.com, whitelist this domain, and set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID. QR codes will generate, but connections may fail if domain isn't whitelisted.";
    }
    if (!qubicReady) {
      return "Preparing WalletConnect core…";
    }
    return undefined;
  }, [hasNativeQubic, walletConnectProjectId, usingFallbackProjectId, qubicReady]);

  const qubicButtonLabel = qubicSession
    ? qubicSession.transport === "native"
      ? "Refresh native session"
      : "Refresh WalletConnect session"
    : hasNativeQubic
      ? "Connect installed Qubic Wallet"
      : "Pair Qubic Wallet via WalletConnect";

  const sessionExpiryRelative = useMemo(
    () => formatExpiryRelative(qubicSession?.expiry),
    [qubicSession?.expiry],
  );

  const sessionExpiryAbsolute = useMemo(
    () => formatAbsoluteDate(qubicSession?.expiry),
    [qubicSession?.expiry],
  );

  const visibleAccounts = useMemo(
    () => qubicSession?.accounts?.slice(0, 3) ?? [],
    [qubicSession?.accounts],
  );

  const additionalAccounts =
    (qubicSession?.accounts?.length ?? 0) - visibleAccounts.length;

  const metamaskWarning = useMemo(
    () =>
      metamaskAvailable
        ? undefined
        : "MetaMask Flask with Snaps support is required. Install MetaMask Flask and enable Snaps beta to continue.",
    [metamaskAvailable],
  );

  const connectMetaMask = useCallback(async () => {
    setMetaStatus("connecting");
    setMetaMessage("Requesting Qubic Snap access…");

    const provider = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!provider?.request) {
      setMetaStatus("error");
      setMetaMessage("MetaMask Flask with Snaps support is required.");
      return;
    }

    try {
      const installSnap = async (snapId: string) => {
        await provider.request({
          method: "wallet_requestSnaps",
          params: {
            [snapId]: { version: QUBIC_SNAP_VERSION },
          },
        });
        return snapId;
      };

      const ensureSnapInstalled = async (): Promise<string> => {
        try {
          return await installSnap(QUBIC_SNAP_ID);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error ?? "");
          const snapUnavailable =
            message.includes("was not found in the NPM registry") ||
            message.includes("Failed to fetch snap");

          if (snapUnavailable && QUBIC_SNAP_ID !== DEFAULT_QUBIC_SNAP_ID) {
            console.warn(
              "[Qubic] Custom snap id failed; falling back to the official Qubic Snap.",
              error,
            );
            setMetaMessage(
              "Custom snap id unavailable; installing the official Qubic Snap instead…",
            );
            return installSnap(DEFAULT_QUBIC_SNAP_ID);
          }

          throw error;
        }
      };

      const targetSnapId = await ensureSnapInstalled();

      const snaps = (await provider.request({
        method: "wallet_getSnaps",
      })) as Record<string, { id: string }>;

      const installedSnap =
        Object.values(snaps ?? {}).find((snap) => snap.id === targetSnapId) ??
        Object.values(snaps ?? {}).find(
          (snap) =>
            snap.id?.startsWith("local:") &&
            snap.id.endsWith(targetSnapId.replace("npm:", "")),
        );

      const resolvedSnapId = installedSnap?.id ?? targetSnapId;

      let accounts: QubicAccount[] | undefined;
      try {
        accounts = (await provider.request({
          method: "wallet_invokeSnap",
          params: {
            snapId: resolvedSnapId,
            request: {
              method: "qubic_requestAccounts",
              params: {},
            },
          },
        })) as QubicAccount[];
      } catch (error) {
        const code = (error as { code?: number }).code;
        if (code !== -32601 && code !== -32603) {
          throw error;
        }
      }

      if (!accounts || !accounts.length) {
        const publicId = (await provider.request({
          method: "wallet_invokeSnap",
          params: {
            snapId: resolvedSnapId,
            request: {
              method: "getPublicId",
              params: { accountIdx: 0, confirm: false },
            },
          },
        })) as string;

        if (typeof publicId === "string" && publicId.length) {
          accounts = [
            {
              address: publicId,
              name: "Qubic Snap",
              amount: undefined,
            },
          ];
        }
      }

      if (!accounts || !accounts.length) {
        throw new Error("Qubic Snap is installed but returned no accounts.");
      }

      setSnapAccounts(accounts);
      setMetaStatus("connected");
      setMetaMessage(
        accounts.length > 1
          ? `Loaded ${accounts.length} accounts via Qubic Snap.`
          : `Linked ${shorten(accounts[0].address)} via Qubic Snap.`,
      );
    } catch (error) {
      setSnapAccounts([]);
      setMetaStatus("error");
      setMetaMessage(
        error instanceof Error
          ? error.message
          : "MetaMask Snap request failed.",
      );
    }
  }, []);

  const handleSeedSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const normalized = seedInput.trim();

      if (!normalized) {
        setSeedState({ state: "invalid", message: "Seed cannot be empty." });
        return;
      }

      const qubicSeedCandidate = normalized.toLowerCase();

      if (isQubicSeed(qubicSeedCandidate) || isHexPrivateKey(normalized)) {
        setSeedState({
          state: "processing",
          message: "Deriving Qubic identity…",
        });

        try {
          const normalizedKey = normalizePrivateKeyInput(normalized);
          const details = isQubicSeed(qubicSeedCandidate)
            ? await deriveIdentityFromSeed(qubicSeedCandidate)
            : await deriveIdentityFromPrivateKey(normalizedKey);
          const snapshot = await fetchIdentitySnapshot(details.publicId);
          setSeedState({
            state: "ready",
            message: "Qubic identity derived successfully.",
            fingerprint: details.publicId.slice(-24),
            descriptor: isQubicSeed(qubicSeedCandidate)
              ? "Qubic deterministic seed"
              : "Raw Schnorr private key",
            identity: buildSeedIdentityDetails(details, snapshot),
          });
        } catch (error) {
          setSeedState({
            state: "invalid",
            message:
              error instanceof Error
                ? error.message
                : "Unable to derive identity from the provided material.",
          });
        }
        return;
      }

      const classification = classifySeed(normalized);

      if (!classification.valid) {
        setSeedState({
          state: "invalid",
          message: "Enter 12-24 words or a 64-character private key.",
        });
        return;
      }

      setSeedState({
        state: "processing",
        message: "Deriving fingerprint…",
      });

      try {
        const fingerprint = await digestHex(normalized);
        setSeedState({
          state: "ready",
          message: "Seed imported securely.",
          fingerprint: fingerprint.slice(0, 24),
          descriptor: classification.descriptor,
        });
      } catch (error) {
        setSeedState({
          state: "invalid",
          message:
            error instanceof Error
              ? error.message
              : "Secure hashing failed. Try a different browser.",
        });
      }
    },
    [seedInput],
  );

  const handleFileSelection = useCallback(
    async (file: File) => {
      setVaultState({
        state: "processing",
        message: `Preparing ${file.name}…`,
      });

      try {
        const buffer = await file.arrayBuffer();
        const checksum = await digestHex(buffer);
        const text = await extractVaultText(buffer);
        const normalizedBuffer = textToArrayBuffer(text);
        const stagedFile = new File([normalizedBuffer], file.name, {
          type: file.type || "application/json",
        });

        setVaultUpload({
          file: stagedFile,
          buffer: normalizedBuffer,
          name: file.name,
          size: file.size,
          checksum: checksum.slice(0, 32),
        });
        setVaultPassword("");

        if (isEncryptedVaultText(text)) {
          setVaultState({
            state: "idle",
            message: "Encrypted vault detected. Enter password to unlock.",
          });
          return;
        }

        const accounts = await parsePlainVaultFile(text);
        const summary =
          parseVaultSummary(text) ?? {
            accounts: accounts.length,
            lastUpdated: undefined,
          };

        setVaultUpload(null);
        setVaultState({
          state: "ready",
          message: "Vault ready to unlock.",
          fileName: file.name,
          size: file.size,
          checksum: checksum.slice(0, 32),
          summary,
          accounts,
        });
      } catch (error) {
        setVaultUpload(null);
        setVaultState({
          state: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to read vault file.",
        });
      }
    },
    [],
  );

  const handleFileInputChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        await handleFileSelection(file);
      }
      event.target.value = "";
    },
    [handleFileSelection],
  );

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const file = event.dataTransfer.files?.[0];
      if (file) {
        await handleFileSelection(file);
      }
    },
    [handleFileSelection],
  );

  const resetVault = () => {
    setVaultState({ state: "idle" });
    setVaultUpload(null);
    setVaultPassword("");
  };

  return {
    statusDescriptors,
    qubic: {
      status: qubicStatus,
      message: qubicMessage,
      connect: connectQubic,
      disconnect: disconnectQubic,
      cancelPairing,
      buttonLabel: qubicButtonLabel,
      warning: walletConnectWarning,
      walletConnectUri,
      walletConnectDeepLink,
      session: qubicSession,
      visibleAccounts,
      additionalAccounts,
      sessionExpiryRelative,
      sessionExpiryAbsolute,
      hasNative: hasNativeQubic,
      isConnecting: qubicStatus === "connecting",
    },
    metamask: {
      status: metaStatus,
      message: metaMessage,
      connect: connectMetaMask,
      available: metamaskAvailable,
      warning: metamaskWarning,
      snapAccounts,
      openDownload: openMetamaskDownload,
    },
    seed: {
      connectionState: seedConnectionState,
      state: seedState,
      input: seedInput,
      setInput: setSeedInput,
      visible: seedVisible,
      toggleVisibility: () => setSeedVisible((prev) => !prev),
      handleSubmit: handleSeedSubmit,
    },
    vault: {
      connectionState: vaultConnectionState,
      state: vaultState,
      upload: vaultUpload,
      fileInputRef,
      handleFileInputChange,
      handleVaultUnlock,
      password: vaultPassword,
      setPassword: setVaultPassword,
      handleDrop,
      reset: resetVault,
    },
  };
};

