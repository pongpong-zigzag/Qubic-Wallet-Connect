declare module "@qubic-lib/qubic-ts-vault-library" {
  export interface QubicVaultAsset {
    publicId: string;
    contractIndex: number;
    assetName: string;
    contractName: string;
    ownedAmount: number;
    possessedAmount: number;
    tick: number;
    reportingNodes: string[];
    issuerIdentity: string;
  }

  export interface QubicVaultSeed {
    alias: string;
    publicId: string;
    encryptedSeed: string;
    balance: number;
    balanceTick: number;
    lastUpdate?: Date;
    assets?: QubicVaultAsset[];
    isExported?: boolean;
    isOnlyWatch?: boolean;
  }

  export interface QubicVaultConfig {
    name?: string;
    seeds: QubicVaultSeed[];
    publicKey?: JsonWebKey;
  }

  export class QubicVault {
    runningConfiguration: QubicVaultConfig;
    privateKey: CryptoKey | null;
    publicKey: CryptoKey | null;
    isWalletReady: boolean;

    importAndUnlock(
      selectedFileIsVaultFile: boolean,
      password: string,
      selectedConfigFile?: File | null,
      file?: File | null,
      unlock?: boolean,
    ): Promise<boolean>;

    getSeeds(): QubicVaultSeed[];
    getSeed(publicId: string): QubicVaultSeed | undefined;
    revealSeed(publicId: string): Promise<string>;
  }
}

