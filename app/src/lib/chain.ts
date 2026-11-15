import "server-only";
import { createPublicClient, createWalletClient, defineChain, http, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "./env";

export function mezoTestnet() {
  const e = env();
  return defineChain({
    id: e.CHAIN_ID,
    name: "Mezo Testnet",
    nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
    rpcUrls: { default: { http: [e.MEZO_RPC] } },
    blockExplorers: { default: { name: "Mezo Explorer", url: e.EXPLORER_URL } },
    testnet: true,
  });
}

let pub: PublicClient | undefined;
export function publicClient(): PublicClient {
  pub ??= createPublicClient({ chain: mezoTestnet(), transport: http(env().MEZO_RPC, { retryCount: 2 }) });
  return pub;
}

function makeWallet() {
  const key = env().RELAYER_PK;
  if (!key) throw new Error("RELAYER_PK is not configured");
  return createWalletClient({
    account: privateKeyToAccount(key),
    chain: mezoTestnet(),
    transport: http(env().MEZO_RPC, { retryCount: 0 }),
  });
}
let wallet: ReturnType<typeof makeWallet> | undefined;
export function relayerWallet() {
  wallet ??= makeWallet();
  return wallet;
}

export function relayerAddressOrNull() {
  try {
    return relayerWallet().account.address;
  } catch {
    return null;
  }
}

export const explorerTx = (hash: string) => `${env().EXPLORER_URL}/tx/${hash}`;
export const explorerAddress = (a: string) => `${env().EXPLORER_URL}/address/${a}`;
