import Qubic from "@ardata-tech/qubic-js";

type QubicClient = InstanceType<typeof Qubic>;

let qubicInstance: QubicClient | null = null;

const DEFAULT_RPC =
  process.env.NEXT_PUBLIC_QUBIC_RPC_URL?.trim() || "https://rpc.qubic.org";

export const getQubicClient = () => {
  if (!qubicInstance) {
    qubicInstance = new Qubic({
      providerUrl: DEFAULT_RPC,
      version: 1,
    });
  }

  return qubicInstance;
};

