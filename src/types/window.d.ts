type ProviderRequestArguments = {
  readonly method: string;
  readonly params?: unknown[] | Record<string, unknown>;
};

type ProviderEventHandler = (...args: unknown[]) => void;

interface Eip1193Provider {
  readonly isMetaMask?: boolean;
  readonly request: (args: ProviderRequestArguments) => Promise<unknown>;
  on?: (event: string, handler: ProviderEventHandler) => void;
  removeListener?: (event: string, handler: ProviderEventHandler) => void;
}

interface QubicProvider extends Eip1193Provider {
  readonly isQubic?: boolean;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
    qubic?: QubicProvider;
  }
}

export {};

