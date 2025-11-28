import type {
  IGetBalanceByIdentity,
  IGetOwnedAssets,
} from "@ardata-tech/qubic-js/dist/types";

import { getQubicClient } from "./qubicClient";

export const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const hexToBytes = (hex: string) => {
  const value = hex.replace(/^0x/, "");
  if (value.length % 2 !== 0) {
    throw new Error("Private key hex length must be even.");
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    const chunk = value.slice(index, index + 2);
    bytes[index / 2] = parseInt(chunk, 16);
  }
  return bytes;
};

export type DerivedIdentity = {
  publicId: string;
  publicKeyHex: string;
  privateKeyHex: string;
};

export type IdentitySnapshot = {
  balance?: IGetBalanceByIdentity["balance"];
  ownedAssets?: IGetOwnedAssets["ownedAssets"];
};

const identitySnapshotCache = new Map<string, IdentitySnapshot>();

export const deriveIdentityFromSeed = async (
  seed: string,
): Promise<DerivedIdentity> => {
  const qubic = getQubicClient();
  const identity = await qubic.identity.createIdentity(seed);

  return {
    publicId: identity.publicId,
    publicKeyHex: bytesToHex(identity.publicKey),
    privateKeyHex: bytesToHex(identity.privateKey),
  };
};

export const deriveIdentityFromPrivateKey = async (
  privateKeyHex: string,
): Promise<DerivedIdentity> => {
  const qubic = getQubicClient();
  const identity = await qubic.identity.loadIdentityFromPrivateKey(
    hexToBytes(privateKeyHex),
  );

  return {
    publicId: identity.publicId,
    publicKeyHex: bytesToHex(identity.publicKey),
    privateKeyHex: bytesToHex(identity.privateKey),
  };
};

export const fetchIdentitySnapshot = async (
  publicId: string,
): Promise<IdentitySnapshot> => {
  if (identitySnapshotCache.has(publicId)) {
    return identitySnapshotCache.get(publicId)!;
  }

  const qubic = getQubicClient();
  const [balance, ownedAssets] = await Promise.all([
    qubic.identity.getBalanceByIdentity(publicId).catch(() => undefined),
    qubic.identity.getOwnedAssets(publicId).catch(() => undefined),
  ]);

  const snapshot: IdentitySnapshot = {
    balance: balance?.balance,
    ownedAssets: ownedAssets?.ownedAssets,
  };

  identitySnapshotCache.set(publicId, snapshot);
  return snapshot;
};

