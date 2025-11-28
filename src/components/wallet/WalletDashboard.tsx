"use client";

import {
  ArrowRightLeft,
  CheckCircle2,
  KeyRound,
  Loader2,
  ShieldCheck,
  UploadCloud,
  Wallet2,
} from "lucide-react";
import JSZip from "jszip";
import { QRCodeSVG } from "qrcode.react";
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type SignClient from "@walletconnect/sign-client";
import type { SessionTypes, SignClientTypes } from "@walletconnect/types";
import { getSdkError } from "@walletconnect/utils";
import { QubicVault } from "@qubic-lib/qubic-ts-vault-library";

import {
  buildQubicDeepLink,
  getQubicSignClient,
  QUBIC_REQUIRED_NAMESPACES,
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
const WALLETCONNECT_FALLBACK_PROJECT_ID =
  "2d3b11ae82b87043a64c8abd87f865c8";
const QUBIC_SNAP_ID =
  process.env.NEXT_PUBLIC_QUBIC_SNAP_ID ?? "npm:@ardata-tech/qubic-wallet";
const QUBIC_SNAP_VERSION =
  process.env.NEXT_PUBLIC_QUBIC_SNAP_VERSION ?? "1.0.7";
const QUBIC_WALLET_URL = "https://wallet.qubic.org/";

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

const STATUS_COLORS: Record<ConnectionState, string> = {
  idle: "bg-slate-600/60 text-slate-200",
  connecting: "bg-amber-500/20 text-amber-200",
  connected: "bg-emerald-500/20 text-emerald-200",
  error: "bg-rose-500/20 text-rose-200",
};

const STATUS_DOT: Record<ConnectionState, string> = {
  idle: "bg-slate-400",
  connecting: "bg-amber-400 animate-pulse",
  connected: "bg-emerald-400",
  error: "bg-rose-400",
};

const formatBytes = (size: number) => {
  if (size === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.floor(Math.log(size) / Math.log(1024));
  return `${(size / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
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

const shorten = (value?: string | null, size = 4) => {
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

const buildWatchOnlyAccount = async (publicId: string, name?: string) => {
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

const renderStateCopy = (state: ConnectionState) => {
  switch (state) {
    case "connected":
      return "Ready";
    case "connecting":
      return "Authorizing…";
    case "error":
      return "Action needed";
    default:
      return "Idle";
  }
};

type WalletCardProps = {
  title: string;
  icon: ReactNode;
  description: string;
  status: ConnectionState;
  statusMessage?: string;
  children: ReactNode;
};

const Card = ({
  title,
  icon,
  description,
  status,
  statusMessage,
  children,
}: WalletCardProps) => (
  <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-950/40 backdrop-blur">
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-3 text-xl font-semibold text-white">
          <span className="rounded-2xl bg-white/10 p-3 text-sky-300">
            {icon}
          </span>
          {title}
        </div>
        <p className="mt-3 text-sm text-slate-300">{description}</p>
      </div>
      <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1 text-xs font-medium uppercase tracking-wide text-slate-200">
        <span
          className={`h-2 w-2 rounded-full ${
            STATUS_DOT[(status as ConnectionState) ?? "idle"]
          }`}
        />
        {renderStateCopy(status as ConnectionState)}
      </span>
    </div>

    {statusMessage && (
      <p className="mb-4 text-sm text-slate-200">{statusMessage}</p>
    )}

    {children}
  </section>
);

const StatusBadge = ({ label, state, description }: StatusDescriptor) => (
  <div
    className={`flex items-center justify-between rounded-2xl px-4 py-3 text-xs font-medium ${STATUS_COLORS[state]}`}
  >
    <div className="flex items-center gap-3">
      <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[state]}`} />
      <span className="tracking-wide">{label}</span>
    </div>
    {description && (
      <span className="text-[11px] font-normal text-white/70">
        {description}
      </span>
    )}
  </div>
);

const ActionButton = ({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-linear-to-r from-sky-400 via-cyan-400 to-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
  >
    {disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
    {children}
  </button>
);

const SecondaryButton = ({
  children,
  type = "button",
  onClick,
}: {
  children: ReactNode;
  type?: "button" | "submit";
  onClick?: () => void;
}) => (
  <button
    type={type}
    onClick={onClick}
    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/15 px-4 py-3 text-sm font-semibold text-white/90 transition hover:border-white/40 hover:text-white"
  >
    {children}
  </button>
);

const InputLabel = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <label className="flex flex-col gap-2 text-sm text-slate-200">
    <span className="font-medium tracking-wide text-white/80">{label}</span>
    {children}
  </label>
);

const TextArea = ({
  value,
  onChange,
  placeholder,
  masked,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  masked?: boolean;
}) => (
  <div className="relative">
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={4}
      spellCheck={false}
      className={`w-full rounded-2xl border border-white/10 bg-slate-900/40 p-3 text-sm outline-none transition focus:border-cyan-400/60 ${
        masked && value ? "text-transparent caret-white selection:bg-white/20" : "text-white"
      }`}
      placeholder={placeholder}
    />
    {masked && value ? (
      <div className="pointer-events-none absolute inset-0 whitespace-pre-wrap wrap-break-word rounded-2xl border border-transparent bg-transparent p-3 text-sm text-white/90">
        {value.replace(/[^\s]/g, "•")}
      </div>
    ) : null}
  </div>
);

const FileDropZone = ({
  onDrop,
  onClick,
  children,
}: {
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onClick: () => void;
  children: ReactNode;
}) => (
  <div
    onDragOver={(event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }}
    onDrop={onDrop}
    onClick={onClick}
    className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-cyan-400/40 bg-slate-900/50 py-10 text-center text-slate-200 transition hover:border-cyan-300 hover:bg-slate-900/70"
  >
    {children}
  </div>
);

export default function WalletDashboard() {
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
  const walletConnectProjectId =
    WALLETCONNECT_PROJECT_ID ?? WALLETCONNECT_FALLBACK_PROJECT_ID;
  const walletConnectConfigured = Boolean(walletConnectProjectId);
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
        seeds.map(async (seed) => {
          try {
            const revealedSeed = await vault.revealSeed(seed.publicId);
            const details = await deriveIdentityFromSeed(revealedSeed);
            const snapshot = await fetchIdentitySnapshot(details.publicId);
            return {
              name: seed.alias ?? seed.publicId,
              source: "seed",
              publicId: details.publicId,
              balance: snapshot.balance?.balance,
            };
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

        const account = Array.isArray(response)
          ? (response[0] as { address?: string; name?: string; amount?: number } | string | undefined)
          : response;

        const address =
          typeof account === "string"
            ? account
            : typeof account === "object" && account
              ? (account.address as string | undefined)
              : undefined;

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
          accounts:
            typeof account === "object" && account
              ? [
                  {
                    address,
                    name: account.name ?? "Primary",
                    amount: typeof account.amount === "number" ? account.amount : undefined,
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
        requiredNamespaces: QUBIC_REQUIRED_NAMESPACES,
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
      setQubicMessage(
        error instanceof Error ? error.message : "WalletConnect pairing failed.",
      );
    }
  }, [
    fetchAccountsSnapshot,
    hydrateQubicSession,
    walletConnectProjectId,
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
    if (!walletConnectConfigured) {
      return "Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to request WalletConnect sessions.";
    }
    if (!qubicReady) {
      return "Preparing WalletConnect core…";
    }
    return undefined;
  }, [hasNativeQubic, walletConnectConfigured, qubicReady]);

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
        : "MetaMask Flask with Snaps support is required for this integration.",
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
      await provider.request({
        method: "wallet_requestSnaps",
        params: {
          [QUBIC_SNAP_ID]: { version: QUBIC_SNAP_VERSION },
        },
      });

      const snaps = (await provider.request({
        method: "wallet_getSnaps",
      })) as Record<string, { id: string }>;

      const installedSnap =
        Object.values(snaps ?? {}).find((snap) => snap.id === QUBIC_SNAP_ID) ??
        Object.values(snaps ?? {}).find(
          (snap) =>
            snap.id?.startsWith("local:") &&
            snap.id.endsWith(QUBIC_SNAP_ID.replace("npm:", "")),
        );

      const resolvedSnapId = installedSnap?.id ?? QUBIC_SNAP_ID;

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

  return (
    <div className="space-y-10">
      <header className="rounded-3xl border border-white/10 bg-linear-to-br from-slate-900 via-slate-900/90 to-black p-8 text-white shadow-2xl shadow-black/50">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-4">
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-300">
              <ArrowRightLeft className="h-4 w-4 text-cyan-300" />
              MULTI-SOURCE ONBOARDING
            </p>
            <h1 className="text-4xl font-semibold leading-tight text-white sm:text-5xl">
              Qubic Wallet Connect
            </h1>
            <p className="max-w-2xl text-base text-slate-300">
              Orchestrate onboarding for Qubic accounts, MetaMask users, private
              seeds, and legacy vault exports inside a single, auditable flow.
              Every action runs locally inside the browser for maximum privacy.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-slate-200">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Session Integrity
            </p>
            <p className="mt-2 text-2xl font-semibold text-white">
              Real-time telemetry
            </p>
            <p className="mt-3 text-sm text-slate-300">
              Tokens, signatures, and seed data never leave this device.
            </p>
          </div>
        </div>
        <div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {statusDescriptors.map((status) => (
            <StatusBadge
              key={status.label}
              label={status.label}
              state={status.state}
              description={status.description}
            />
          ))}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Qubic Wallet"
          icon={<ShieldCheck className="h-5 w-5" />}
          description="Link the native Qubic desktop or browser extension to bootstrap session keys."
          status={qubicStatus}
          statusMessage={qubicMessage}
        >
          <div className="flex flex-col gap-3">
            <ActionButton onClick={connectQubic} disabled={qubicStatus === "connecting"}>
              {qubicStatus === "connecting" ? null : <Wallet2 className="h-4 w-4" />}
              {qubicButtonLabel}
            </ActionButton>
            {walletConnectWarning ? (
              <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-100">
                {walletConnectWarning}
              </p>
            ) : (
              <p className="text-xs text-slate-400">
                Tip: Keep the Qubic Wallet unlocked before pairing. Existing sessions
                auto-load from WalletConnect storage.
              </p>
            )}
            {!qubicSession && !hasNativeQubic ? (
              <a
                href={QUBIC_WALLET_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-full items-center justify-center rounded-2xl border border-cyan-400/50 px-4 py-2 text-xs font-semibold text-cyan-200 transition hover:border-cyan-200"
              >
                Don’t have Qubic Wallet? Create one
              </a>
            ) : null}
          </div>

          {walletConnectUri ? (
            <div className="mt-5 rounded-2xl border border-cyan-400/40 bg-slate-900/40 p-4 text-sm text-slate-200">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200">
                WalletConnect URI
              </p>
              <p className="mt-2 text-slate-300">
                Scan the QR code using the Qubic Wallet mobile app or open the deep
                link below.
              </p>
              <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="self-center rounded-2xl bg-white p-4">
                  <QRCodeSVG
                    value={walletConnectUri}
                    size={164}
                    bgColor="#ffffff"
                    fgColor="#020617"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-3 text-xs text-slate-300">
                  <div className="rounded-xl bg-slate-900/70 p-3 font-mono text-[11px] text-slate-200">
                    <div className="max-h-24 overflow-y-auto break-all">{walletConnectUri}</div>
                  </div>
                  {walletConnectDeepLink ? (
                    <a
                      href={walletConnectDeepLink}
                      className="rounded-2xl border border-cyan-300/40 px-4 py-2 text-center text-xs font-semibold text-cyan-200 transition hover:border-cyan-200"
                    >
                      Open in Qubic Wallet
                    </a>
                  ) : null}
                  <SecondaryButton onClick={cancelPairing}>
                    Cancel pairing
                  </SecondaryButton>
                </div>
              </div>
            </div>
          ) : null}

          {qubicSession ? (
            <div className="mt-5 space-y-4 rounded-2xl border border-white/10 bg-slate-900/40 p-4 text-sm text-slate-200">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                    Primary account
                  </p>
                  <p className="font-mono text-white">
                    {shorten(qubicSession.address, 6)}
                  </p>
                  <p className="text-xs text-slate-400">
                    {qubicSession.walletName ?? "Qubic Wallet"} ·{" "}
                    {qubicSession.chainId ?? "mainnet"}
                  </p>
                </div>
                <SecondaryButton onClick={disconnectQubic}>
                  Disconnect
                </SecondaryButton>
              </div>
              <div className="grid gap-3 text-xs text-slate-300 sm:grid-cols-2">
                <div>
                  <p className="text-slate-400">Session expiry</p>
                  <p className="text-white">{sessionExpiryRelative}</p>
                  <p className="text-[11px] text-slate-500">{sessionExpiryAbsolute}</p>
                </div>
                <div>
                  <p className="text-slate-400">Wallet app</p>
                  {qubicSession.walletUrl ? (
                    <a
                      href={qubicSession.walletUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-200 underline decoration-dotted underline-offset-4"
                    >
                      {qubicSession.walletName ?? qubicSession.walletUrl}
                    </a>
                  ) : (
                    <p className="text-white">
                      {qubicSession.walletName ?? "Qubic Wallet"}
                    </p>
                  )}
                </div>
              </div>
              {visibleAccounts.length > 0 ? (
                <div className="rounded-xl bg-slate-900/60 p-3 text-xs text-slate-200">
                  <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">
                    Accounts snapshot
                  </p>
                  <div className="mt-2 space-y-2">
                    {visibleAccounts.map((account) => (
                      <div
                        key={account.address}
                        className="flex items-center justify-between font-mono text-[11px]"
                      >
                        <span>{shorten(account.address, 4)}</span>
                        {typeof account.amount === "number" ? (
                          <span className="text-slate-400">{account.amount} QU</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {additionalAccounts > 0 ? (
                    <p className="mt-2 text-[11px] text-slate-500">
                      +{additionalAccounts} more account
                      {additionalAccounts > 1 ? "s" : ""}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>

        <Card
          title="MetaMask (Qubic Snap)"
          icon={<Wallet2 className="h-5 w-5" />}
          description="Install the official Qubic Wallet Snap inside MetaMask Flask to bridge browser wallets with the Qubic network."
          status={metaStatus}
          statusMessage={metaMessage}
        >
          <div className="flex flex-col gap-3">
            <ActionButton
              onClick={connectMetaMask}
              disabled={metaStatus === "connecting" || !metamaskAvailable}
            >
              <CheckCircle2 className="h-4 w-4" />
              {metaStatus === "connected" ? "Refresh Snap session" : "Connect MetaMask"}
            </ActionButton>
            {metamaskWarning ? (
              <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-100">
                {metamaskWarning}
              </p>
            ) : (
              <p className="text-xs text-slate-400">
                Use MetaMask Flask → Settings → Snaps to review or revoke permissions.
              </p>
            )}
          </div>
          {snapAccounts.length ? (
            <div className="mt-5 space-y-3 rounded-2xl border border-white/10 bg-slate-900/40 p-4 text-xs text-slate-200">
              <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">
                Linked accounts
              </p>
              <div className="space-y-2">
                {snapAccounts.slice(0, 3).map((account) => (
                  <div
                    key={account.address}
                    className="flex items-center justify-between rounded-xl bg-slate-900/60 p-3 font-mono text-[11px]"
                  >
                    <div>
                      <p className="text-white">{shorten(account.address, 6)}</p>
                      {account.name ? (
                        <p className="text-[10px] text-slate-400">{account.name}</p>
                      ) : null}
                    </div>
                    {typeof account.amount === "number" ? (
                      <p className="text-slate-400">{account.amount} QU</p>
                    ) : (
                      <p className="text-slate-500">—</p>
                    )}
                  </div>
                ))}
              </div>
              {snapAccounts.length > 3 ? (
                <p className="text-[11px] text-slate-500">
                  +{snapAccounts.length - 3} more hidden
                </p>
              ) : null}
            </div>
          ) : null}
        </Card>

        <Card
          title="Private Seed"
          icon={<KeyRound className="h-5 w-5" />}
          description="Validate mnemonic phrases or import raw private keys in an offline-safe enclave."
          status={seedConnectionState}
          statusMessage={seedState.message}
        >
          <form className="space-y-4" onSubmit={handleSeedSubmit}>
            <InputLabel label="Seed / private key">
              <TextArea
                value={seedInput}
                onChange={setSeedInput}
                placeholder="ex: obey turtle manual diesel ..."
                masked={!seedVisible}
              />
            </InputLabel>
            <div className="flex flex-col gap-3 sm:flex-row">
              <SecondaryButton onClick={() => setSeedVisible(!seedVisible)}>
                {seedVisible ? "Hide" : "Show"} words
              </SecondaryButton>
              <SecondaryButton type="submit">
                {seedState.state === "processing" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Validating…
                  </>
                ) : (
                  "Validate & import"
                )}
              </SecondaryButton>
            </div>
            {seedState.state === "ready" && (
              <div className="rounded-2xl border border-emerald-400/40 bg-emerald-400/10 p-4 text-sm text-emerald-100">
                <p className="font-semibold text-emerald-200">
                  {seedState.descriptor}
                </p>
                <p className="mt-1 font-mono text-xs text-emerald-100/90">
                  Fingerprint · {seedState.fingerprint}
                </p>
              </div>
            )}
            {seedState.state === "ready" && seedState.identity ? (
              <div className="grid gap-4 rounded-2xl border border-white/10 bg-slate-900/40 p-4 text-xs text-slate-200 sm:grid-cols-2">
                <div>
                  <p className="text-slate-400">Public identity</p>
                  <p className="font-mono text-sm text-white">
                    {seedState.identity.publicId}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400">Balance snapshot</p>
                  <p className="text-white">
                    {seedState.identity.balance ?? "Unknown"}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    Assets tracked · {seedState.identity.ownedAssetCount ?? 0}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-slate-400">Public key (hex)</p>
                  <p className="font-mono text-[11px] text-white break-all">
                    {seedState.identity.publicKeyHex}
                  </p>
                </div>
              </div>
            ) : null}
          </form>
        </Card>

        <Card
          title="Vault File"
          icon={<UploadCloud className="h-5 w-5" />}
          description="Drop encrypted Qubic `.qubic-vault` exports to hydrate the workspace."
          status={vaultConnectionState}
          statusMessage={vaultState.message}
        >
          <input
            id="vault-file"
            type="file"
            ref={fileInputRef}
            className="sr-only"
            accept=".qubic-vault"
            onChange={handleFileInputChange}
          />
          {vaultState.state === "ready" ? (
            <div className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/40 p-4 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-white">
                    {vaultState.fileName}
                  </p>
                  <p className="text-xs text-slate-400">
                    {formatBytes(vaultState.size)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetVault}
                  className="text-xs font-semibold uppercase tracking-wide text-cyan-300"
                >
                  Reset
                </button>
              </div>
              <p className="font-mono text-[11px] text-slate-300">
                SHA-256 · {vaultState.checksum}
              </p>
              {vaultState.summary && (
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <p className="text-slate-400">Accounts detected</p>
                    <p className="text-lg font-semibold text-white">
                      {vaultState.summary.accounts ?? "–"}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">Last updated</p>
                    <p className="text-lg font-semibold text-white">
                      {vaultState.summary.lastUpdated ?? "Unknown"}
                    </p>
                  </div>
                </div>
              )}
              {vaultState.accounts?.length ? (
                <div className="rounded-xl bg-slate-900/60 p-3 text-xs text-slate-200">
                  <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">
                    Derived accounts
                  </p>
                  <div className="mt-2 space-y-2">
                    {vaultState.accounts.map((account) => (
                      <div
                        key={`${account.publicId}-${account.name ?? "vault"}`}
                        className="rounded-lg border border-white/5 p-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[11px] text-white">
                            {shorten(account.publicId, 5)}
                          </span>
                          <span className="text-[10px] uppercase tracking-widest text-slate-500">
                            {account.source}
                          </span>
                        </div>
                        {account.name ? (
                          <p className="text-[11px] text-slate-400">{account.name}</p>
                        ) : null}
                        <p className="text-[11px] text-slate-400">
                          Balance: {account.balance ?? "Unknown"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : vaultUpload ? (
            <div className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/40 p-4 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-white">{vaultUpload.name}</p>
                  <p className="text-xs text-slate-400">
                    {formatBytes(vaultUpload.size)}
                  </p>
                  <p className="font-mono text-[11px] text-slate-300">
                    SHA-256 · {vaultUpload.checksum}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetVault}
                  className="text-xs font-semibold uppercase tracking-wide text-cyan-300"
                >
                  Remove
                </button>
              </div>
              <p className="text-xs text-slate-400">
                Encrypted vault detected. Provide the password you used when exporting the file.
              </p>
              <InputLabel label="Vault password">
                <input
                  type="password"
                  value={vaultPassword}
                  onChange={(event) => setVaultPassword(event.target.value)}
                  className="rounded-2xl border border-white/10 bg-slate-900/60 p-3 text-sm text-white outline-none transition focus:border-cyan-400/60"
                  placeholder="Password"
                />
              </InputLabel>
              <ActionButton
                onClick={handleVaultUnlock}
                disabled={!vaultPassword || vaultState.state === "processing"}
              >
                {vaultState.state === "processing" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Unlocking…
                  </>
                ) : (
                  "Unlock vault"
                )}
              </ActionButton>
            </div>
          ) : (
            <FileDropZone
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadCloud className="h-6 w-6 text-cyan-200" />
              <div>
                <p className="text-sm font-semibold">
                  Drag & drop to import vault
                </p>
                <p className="text-xs text-slate-400">
                  .qubic-vault JSON or ZIP files stay on this device.
                </p>
              </div>
            </FileDropZone>
          )}
        </Card>
      </div>

      <footer className="rounded-3xl border border-white/10 bg-slate-900/60 p-6 text-sm text-slate-300">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-white">Operational safeguards</p>
            <p className="text-slate-400">
              We never transmit seeds, vault files, or signatures to remote
              infrastructure. Verify the hash before exporting anything off-box.
            </p>
          </div>
          <SecondaryButton onClick={() => window.location.reload()}>
            Refresh session
          </SecondaryButton>
        </div>
      </footer>
    </div>
  );
}

