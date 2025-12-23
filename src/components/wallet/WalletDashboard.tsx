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
import { QRCodeSVG } from "qrcode.react";
import { type DragEvent, type ReactNode } from "react";

import {
  QUBIC_WALLET_URL,
  shorten,
  useWalletDashboard,
  type ConnectionState,
  type StatusDescriptor,
} from "./hooks/useWalletDashboard";

type DashboardSnapshot = ReturnType<typeof useWalletDashboard>;
type CalloutTone = "info" | "warning" | "danger" | "success";

const STATUS_BADGE_STYLES: Record<
  ConnectionState,
  { badge: string; dot: string }
> = {
  idle: {
    badge: "border-slate-200 bg-slate-50 text-slate-600",
    dot: "bg-slate-400",
  },
  connecting: {
    badge: "border-amber-200 bg-amber-50 text-amber-700",
    dot: "bg-amber-400 animate-pulse",
  },
  connected: {
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-500",
  },
  error: {
    badge: "border-rose-200 bg-rose-50 text-rose-700",
    dot: "bg-rose-500",
  },
};

const formatBytes = (size: number) => {
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.floor(Math.log(size) / Math.log(1024));
  return `${(size / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const renderStateCopy = (state: ConnectionState) => {
  switch (state) {
    case "connected":
      return "Ready";
    case "connecting":
      return "Authorizing";
    case "error":
      return "Action needed";
    default:
      return "Idle";
  }
};

type CardProps = {
  title: string;
  description: string;
  icon: ReactNode;
  status: ConnectionState;
  message?: string;
  children: ReactNode;
};

const Card = ({
  title,
  description,
  icon,
  status,
  message,
  children,
}: CardProps) => (
  <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/70">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-3 text-lg font-semibold text-slate-900">
          <span className="rounded-2xl bg-slate-100 p-3 text-slate-600">
            {icon}
          </span>
          {title}
        </div>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
      </div>
      <span
        className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${STATUS_BADGE_STYLES[status].badge}`}
      >
        <span
          className={`h-2 w-2 rounded-full ${STATUS_BADGE_STYLES[status].dot}`}
        />
        {renderStateCopy(status)}
      </span>
    </div>
    {message ? <p className="text-sm text-slate-500">{message}</p> : null}
    {children}
  </section>
);

const StatusBadge = ({ descriptor }: { descriptor: StatusDescriptor }) => (
  <div
    className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-xs font-medium ${STATUS_BADGE_STYLES[descriptor.state].badge}`}
  >
    <div className="flex items-center gap-3">
      <span
        className={`h-2.5 w-2.5 rounded-full ${STATUS_BADGE_STYLES[descriptor.state].dot}`}
      />
      <span className="uppercase tracking-wide">{descriptor.label}</span>
    </div>
    {descriptor.description ? (
      <span className="text-[11px] text-slate-500">
        {descriptor.description}
      </span>
    ) : null}
  </div>
);

type ActionButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  loading?: boolean;
};

const ActionButton = ({
  children,
  onClick,
  type = "button",
  disabled,
  loading,
}: ActionButtonProps) => {
  const isDisabled = disabled || loading;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
};

type SecondaryButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
};

const SecondaryButton = ({
  children,
  onClick,
  type = "button",
}: SecondaryButtonProps) => (
  <button
    type={type}
    onClick={onClick}
    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
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
  <label className="flex flex-col gap-2 text-sm text-slate-600">
    <span className="font-semibold text-slate-700">{label}</span>
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
      className={`w-full rounded-2xl border border-slate-200 bg-slate-50/80 p-3 text-sm text-slate-700 outline-none transition focus:border-slate-400 ${masked ? "caret-slate-400" : ""}`}
      placeholder={placeholder}
    />
    {masked && value ? (
      <div className="pointer-events-none absolute inset-0 whitespace-pre-wrap rounded-2xl p-3 font-mono text-sm text-slate-700/80">
        {value.replace(/[^\s]/g, "•")}
      </div>
    ) : null}
  </div>
);

const FileDropZone = ({
  onClick,
  onDrop,
  children,
}: {
  onClick: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) => (
  <div
    onClick={onClick}
    onDragOver={(event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }}
    onDrop={onDrop}
    className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-12 text-center text-slate-600 transition hover:bg-slate-50"
  >
    {children}
  </div>
);

const Callout = ({
  tone = "info",
  children,
}: {
  tone?: CalloutTone;
  children: ReactNode;
}) => {
  const palette: Record<CalloutTone, { bg: string; border: string; text: string }> = {
    info: {
      bg: "bg-sky-50",
      border: "border-sky-100",
      text: "text-sky-700",
    },
    warning: {
      bg: "bg-amber-50",
      border: "border-amber-100",
      text: "text-amber-800",
    },
    danger: {
      bg: "bg-rose-50",
      border: "border-rose-100",
      text: "text-rose-800",
    },
    success: {
      bg: "bg-emerald-50",
      border: "border-emerald-100",
      text: "text-emerald-800",
    },
  };

  const toneStyles = palette[tone];
  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-sm ${toneStyles.bg} ${toneStyles.border} ${toneStyles.text}`}
    >
      {children}
    </div>
  );
};

const DashboardHero = ({
  statusDescriptors,
}: {
  statusDescriptors: StatusDescriptor[];
}) => (
  <header className="rounded-3xl border border-slate-200 bg-white px-8 py-10 shadow-sm shadow-slate-200/70">
    <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="space-y-4">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">
          <ArrowRightLeft className="h-4 w-4 text-slate-700" />
          MULTI-SOURCE ONBOARDING
        </p>
        <div>
          <h1 className="text-4xl font-semibold text-slate-900">
            Qubic Wallet Connect
          </h1>
          <p className="mt-3 max-w-2xl text-base text-slate-600">
            Coordinate native Qubic sessions, MetaMask Snaps, direct seed imports,
            and legacy vault unlocks from a single control surface. Every step runs
            locally for auditability.
          </p>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5 text-sm text-slate-600">
        <p className="text-[11px] uppercase tracking-[0.4em] text-slate-500">
          Session Integrity
        </p>
        <p className="mt-2 text-2xl font-semibold text-slate-900">
          Local-first security
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          Vaults, seeds, and signatures never leave the browser. Verify artifacts
          before exporting them anywhere else.
        </p>
      </div>
    </div>
    <div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {statusDescriptors.map((descriptor) => (
        <StatusBadge key={descriptor.label} descriptor={descriptor} />
      ))}
    </div>
  </header>
);

const DashboardFooter = () => (
  <footer className="rounded-3xl border border-slate-200 bg-white px-6 py-6 text-sm text-slate-600 shadow-sm shadow-slate-200/70">
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-base font-semibold text-slate-900">
          Operational safeguards
        </p>
        <p className="text-sm text-slate-600">
          Keep this page open when you need to validate accounts. Refresh to discard
          any derived data or session state.
        </p>
      </div>
      <SecondaryButton onClick={() => window.location.reload()}>
        Refresh workspace
      </SecondaryButton>
    </div>
  </footer>
);

const QubicWalletCard = ({ qubic }: { qubic: DashboardSnapshot["qubic"] }) => {
  const {
    status,
    message,
    connect,
    disconnect,
    cancelPairing,
    buttonLabel,
    warning,
    walletConnectUri,
    walletConnectDeepLink,
    session,
    visibleAccounts,
    additionalAccounts,
    sessionExpiryRelative,
    sessionExpiryAbsolute,
    hasNative,
    isConnecting,
  } = qubic;

  return (
    <Card
      title="Qubic Wallet"
      description="Link the native desktop wallet or pair via WalletConnect to hydrate Qubic accounts."
      icon={<ShieldCheck className="h-5 w-5" />}
      status={status}
      message={message}
    >
      <div className="space-y-4">
        <ActionButton onClick={connect} loading={isConnecting}>
          <Wallet2 className="h-4 w-4" />
          {buttonLabel}
        </ActionButton>
        {warning ? (
          <Callout tone="warning">{warning}</Callout>
        ) : (
          <p className="text-xs text-slate-500">
            Tip: keep the wallet unlocked before requesting a new pairing to reuse
            cached approvals.
          </p>
        )}
        {!session && !hasNative ? (
          <a
            href={QUBIC_WALLET_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-full items-center justify-center rounded-2xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:text-slate-900"
          >
            Download Qubic Wallet
          </a>
        ) : null}
      </div>

      {walletConnectUri ? (
        <div className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
            WalletConnect pairing
          </p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="self-center rounded-2xl border border-slate-200 bg-white p-4">
              <QRCodeSVG value={walletConnectUri} size={148} />
            </div>
            <div className="flex flex-1 flex-col gap-2 text-xs">
              <div className="rounded-xl border border-slate-200 bg-white p-3 font-mono text-[11px] text-slate-600">
                <div className="max-h-24 overflow-y-auto break-all">
                  {walletConnectUri}
                </div>
              </div>
              {walletConnectDeepLink ? (
                <a
                  href={walletConnectDeepLink}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-center text-xs font-semibold text-slate-700 transition hover:text-slate-900"
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

      {session ? (
        <div className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-600">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">
                Primary account
              </p>
              <p className="font-mono text-[13px] text-slate-900">
                {shorten(session.address, 6)}
              </p>
              <p className="text-xs text-slate-500">
                {session.walletName ?? "Qubic Wallet"} · {session.chainId ?? "mainnet"}
              </p>
            </div>
            <SecondaryButton onClick={disconnect}>Disconnect</SecondaryButton>
          </div>
          <div className="grid gap-4 text-xs text-slate-600 sm:grid-cols-2">
            <div>
              <p className="text-slate-500">Session expiry</p>
              <p className="text-slate-900">{sessionExpiryRelative}</p>
              <p className="text-[11px] text-slate-500">{sessionExpiryAbsolute}</p>
            </div>
            <div>
              <p className="text-slate-500">Wallet app</p>
              {session.walletUrl ? (
                <a
                  href={session.walletUrl}
                  className="text-slate-900 underline decoration-dotted underline-offset-4"
                  target="_blank"
                  rel="noreferrer"
                >
                  {session.walletName ?? session.walletUrl}
                </a>
              ) : (
                <p className="text-slate-900">
                  {session.walletName ?? "Qubic Wallet"}
                </p>
              )}
            </div>
          </div>
          {visibleAccounts.length ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">
                Accounts snapshot
              </p>
              <div className="mt-2 space-y-2 font-mono text-[11px] text-slate-700">
                {visibleAccounts.map((account) => (
                  <div
                    key={account.address}
                    className="flex items-center justify-between"
                  >
                    <span>{shorten(account.address, 4)}</span>
                    {typeof account.amount === "number" ? (
                      <span>{account.amount} QU</span>
                    ) : null}
                  </div>
                ))}
                {additionalAccounts > 0 ? (
                  <p className="text-slate-500">
                    +{additionalAccounts} more account
                    {additionalAccounts > 1 ? "s" : ""}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
};

const MetaMaskCard = ({
  metamask,
}: {
  metamask: DashboardSnapshot["metamask"];
}) => {
  const {
    status,
    message,
    connect,
    available,
    warning,
    snapAccounts,
    openDownload,
  } = metamask;
  const isConnecting = status === "connecting";

  return (
    <Card
      title="MetaMask (Qubic Snap)"
      description="Request Qubic Snap permissions from MetaMask Flask to expose managed accounts."
      icon={<Wallet2 className="h-5 w-5" />}
      status={status}
      message={message}
    >
      <div className="space-y-3">
        <ActionButton onClick={connect} loading={isConnecting} disabled={!available}>
          <CheckCircle2 className="h-4 w-4" />
          {status === "connected" ? "Refresh Qubic Snap" : "Connect MetaMask"}
        </ActionButton>
        {!available ? (
          <SecondaryButton onClick={openDownload}>
            Install MetaMask Flask
          </SecondaryButton>
        ) : null}
        {warning ? (
          <Callout tone="warning">{warning}</Callout>
        ) : (
          <p className="text-xs text-slate-500">
            Manage Snaps from MetaMask → Settings → Snaps to review permissions.
          </p>
        )}
      </div>
      {snapAccounts.length ? (
        <div className="mt-5 space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-xs text-slate-600">
          <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">
            Linked accounts
          </p>
          <div className="space-y-2">
            {snapAccounts.slice(0, 3).map((account) => (
              <div
                key={account.address}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 font-mono text-[11px]"
              >
                <div>
                  <p className="text-slate-900">{shorten(account.address, 6)}</p>
                  {account.name ? (
                    <p className="text-[10px] text-slate-500">{account.name}</p>
                  ) : null}
                </div>
                {typeof account.amount === "number" ? (
                  <p className="text-slate-500">{account.amount} QU</p>
                ) : (
                  <p className="text-slate-400">—</p>
                )}
              </div>
            ))}
            {snapAccounts.length > 3 ? (
              <p className="text-[11px] text-slate-500">
                +{snapAccounts.length - 3} more hidden
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
};

const SeedCard = ({ seed }: { seed: DashboardSnapshot["seed"] }) => {
  const seedState = seed.state;
  const showSuccess = seedState.state === "ready";
  const showError = seedState.state === "invalid";

  return (
    <Card
      title="Private Seed"
      description="Validate mnemonic phrases or raw private keys in a sealed browser enclave."
      icon={<KeyRound className="h-5 w-5" />}
      status={seed.connectionState}
      message={seedState.message}
    >
      <form className="space-y-4" onSubmit={seed.handleSubmit}>
        <InputLabel label="Seed / private key">
          <TextArea
            value={seed.input}
            onChange={seed.setInput}
            placeholder="example: obey turtle manual diesel ..."
            masked={!seed.visible}
          />
        </InputLabel>
        <div className="flex flex-col gap-3 sm:flex-row">
          <SecondaryButton type="button" onClick={seed.toggleVisibility}>
            {seed.visible ? "Hide words" : "Show words"}
          </SecondaryButton>
          <ActionButton
            type="submit"
            loading={seedState.state === "processing"}
          >
            {seedState.state === "processing" ? "Validating…" : "Validate & import"}
          </ActionButton>
        </div>
        {showError ? (
          <Callout tone="danger">{seedState.message}</Callout>
        ) : null}
        {showSuccess ? (
          <div className="space-y-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
            <p className="font-semibold">{seedState.descriptor}</p>
            <p className="font-mono text-xs text-emerald-700">
              Fingerprint · {seedState.fingerprint}
            </p>
          </div>
        ) : null}
        {showSuccess && seedState.identity ? (
          <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-xs text-slate-600 sm:grid-cols-2">
            <div>
              <p className="text-slate-500">Public identity</p>
              <p className="font-mono text-[11px] text-slate-900 break-all">
                {seedState.identity.publicId}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Balance snapshot</p>
              <p className="text-slate-900">
                {seedState.identity.balance ?? "Unknown"}
              </p>
              <p className="text-[10px] text-slate-500">
                Assets tracked · {seedState.identity.ownedAssetCount ?? 0}
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-slate-500">Public key (hex)</p>
              <p className="font-mono text-[11px] text-slate-900 break-all">
                {seedState.identity.publicKeyHex}
              </p>
            </div>
          </div>
        ) : null}
      </form>
    </Card>
  );
};

const VaultCard = ({ vault }: { vault: DashboardSnapshot["vault"] }) => {
  const {
    connectionState,
    state,
    upload,
    fileInputRef,
    handleFileInputChange,
    handleVaultUnlock,
    password,
    setPassword,
    handleDrop,
    reset,
  } = vault;

  const isProcessing = state.state === "processing";
  const showReady = state.state === "ready";
  const encryptedUpload = upload ?? null;

  return (
    <Card
      title="Vault File"
      description="Import `.qubic-vault` exports or JSON archives to bootstrap workspaces."
      icon={<UploadCloud className="h-5 w-5" />}
      status={connectionState}
      message={state.message}
    >
      <input
        id="vault-file"
        type="file"
        ref={fileInputRef}
        className="sr-only"
        accept=".qubic-vault,.json,.zip"
        onChange={handleFileInputChange}
      />
      {showReady ? (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-600">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-slate-900">{state.fileName}</p>
              <p className="text-xs text-slate-500">{formatBytes(state.size)}</p>
            </div>
            <button
              type="button"
              onClick={reset}
              className="text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-900"
            >
              Reset
            </button>
          </div>
          <p className="font-mono text-[11px] text-slate-500">
            SHA-256 · {state.checksum}
          </p>
          {state.summary ? (
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <p className="text-slate-500">Accounts detected</p>
                <p className="text-lg font-semibold text-slate-900">
                  {state.summary.accounts ?? "–"}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Last updated</p>
                <p className="text-lg font-semibold text-slate-900">
                  {state.summary.lastUpdated ?? "Unknown"}
                </p>
              </div>
            </div>
          ) : null}
          {state.accounts?.length ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
              <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">
                Derived accounts
              </p>
              <div className="mt-2 space-y-2">
                {state.accounts.map((account) => (
                  <div
                    key={`${account.publicId}-${account.name ?? "vault"}`}
                    className="rounded-lg border border-slate-200 p-3"
                  >
                    <div className="flex items-center justify-between font-mono text-[11px] text-slate-900">
                      <span>{shorten(account.publicId, 5)}</span>
                      <span className="uppercase tracking-widest text-slate-500">
                        {account.source}
                      </span>
                    </div>
                    {account.name ? (
                      <p className="text-[11px] text-slate-500">{account.name}</p>
                    ) : null}
                    <p className="text-[11px] text-slate-500">
                      Balance: {account.balance ?? "Unknown"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : encryptedUpload ? (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-600">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-slate-900">{encryptedUpload.name}</p>
              <p className="text-xs text-slate-500">
                {formatBytes(encryptedUpload.size)}
              </p>
              <p className="font-mono text-[11px] text-slate-500">
                SHA-256 · {encryptedUpload.checksum}
              </p>
            </div>
            <button
              type="button"
              onClick={reset}
              className="text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-900"
            >
              Remove
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Encrypted vault detected. Enter the password that was used when exporting
            the file.
          </p>
          <InputLabel label="Vault password">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-700 outline-none transition focus:border-slate-400"
              placeholder="Password"
            />
          </InputLabel>
          <ActionButton
            onClick={handleVaultUnlock}
            loading={isProcessing}
            disabled={!password}
          >
            Unlock vault
          </ActionButton>
        </div>
      ) : (
        <FileDropZone
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadCloud className="h-6 w-6 text-slate-500" />
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Drag & drop to import vault
            </p>
            <p className="text-xs text-slate-500">
              .qubic-vault JSON or ZIP files stay on this device.
            </p>
          </div>
        </FileDropZone>
      )}
    </Card>
  );
};

export default function WalletDashboard() {
  const dashboard = useWalletDashboard();
  const { statusDescriptors, qubic, metamask, seed, vault } = dashboard;

  return (
    <div className="space-y-8">
      <DashboardHero statusDescriptors={statusDescriptors} />
      <div className="grid gap-6 lg:grid-cols-2">
        <QubicWalletCard qubic={qubic} />
        <MetaMaskCard metamask={metamask} />
        <SeedCard seed={seed} />
        <VaultCard vault={vault} />
      </div>
      <DashboardFooter />
    </div>
  );
}

