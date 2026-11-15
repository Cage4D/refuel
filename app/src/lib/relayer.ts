import "server-only";
import { keccak256, parseEventLogs, parseSignature, type Address, type Hex } from "viem";
import { publicClient, relayerWallet } from "./chain";
import { refuelAbi } from "./contracts";
import { env, refuelAddress } from "./env";
import { ApiError, codeForRevert, revertInfo } from "./errors";

/** Minimal async mutex: one relayer key, so every send is serialised to avoid nonce clashes. */
class Mutex {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.tail;
    this.tail = prev.then(() => next);
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
const sendLock = new Mutex();

// ---------------------------------------------------------------- idempotency

const IDEMPOTENCY_MS = 10 * 60_000;
const recent = new Map<Hex, { txHash: Hex; at: number }>();
const inflight = new Map<Hex, Promise<RelayResult>>();

function remember(key: Hex, txHash: Hex) {
  const now = Date.now();
  recent.set(key, { txHash, at: now });
  for (const [k, v] of recent) if (now - v.at > IDEMPOTENCY_MS) recent.delete(k);
}

export function signatureKey(signature: Hex): Hex {
  return keccak256(signature);
}

export function knownTx(signature: Hex): Hex | undefined {
  const hit = recent.get(signatureKey(signature));
  return hit && Date.now() - hit.at <= IDEMPOTENCY_MS ? hit.txHash : undefined;
}

// ---------------------------------------------------------------- relay

export type RelayResult = { txHash: Hex; btcOut: bigint | null; status: "confirmed" | "submitted" };

export async function relayerBalance(): Promise<bigint> {
  return publicClient().getBalance({ address: relayerWallet().account.address });
}

export async function assertRelayerFunded() {
  if ((await relayerBalance()) < env().RELAYER_MIN_BALANCE_WEI) throw new ApiError("RELAYER_LOW");
}

/**
 * Simulate then submit refuelWithPermit. Concurrent calls with the same signature share one
 * submission; repeats within 10 minutes return the original tx hash.
 */
export function relayRefuel(args: { owner: Address; amountIn: bigint; deadline: bigint; signature: Hex }) {
  const key = signatureKey(args.signature);
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = doRelay(args).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function doRelay({
  owner,
  amountIn,
  deadline,
  signature,
}: {
  owner: Address;
  amountIn: bigint;
  deadline: bigint;
  signature: Hex;
}): Promise<RelayResult> {
  const key = signatureKey(signature);
  const prior = knownTx(signature);
  if (prior) return { txHash: prior, btcOut: await btcOutFromTx(prior), status: "confirmed" };

  const { v, r, s, yParity } = parseSignature(signature);
  const vNum = Number(v ?? BigInt(yParity + 27));
  const wallet = relayerWallet();
  const client = publicClient();

  let request;
  try {
    ({ request } = await client.simulateContract({
      account: wallet.account,
      address: refuelAddress(),
      abi: refuelAbi,
      functionName: "refuelWithPermit",
      args: [owner, amountIn, deadline, vNum, r, s],
    }));
  } catch (e) {
    const { name, args } = revertInfo(e);
    const code = codeForRevert(name);
    if (code === "INVALID_SIGNATURE" && deadline <= BigInt(Math.floor(Date.now() / 1000))) {
      throw new ApiError("PERMIT_EXPIRED");
    }
    throw new ApiError(code, {}, name ? { revert: name, ...(args ? { args: args.map(String) } : {}) } : undefined);
  }

  return sendLock.run(async () => {
    let txHash: Hex;
    try {
      txHash = await wallet.writeContract(request);
    } catch (e) {
      const { name } = revertInfo(e);
      throw new ApiError(codeForRevert(name));
    }
    remember(key, txHash);
    try {
      const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 20_000 });
      if (receipt.status !== "success") throw new ApiError("CHAIN_ERROR", {}, { txHash });
      return { txHash, btcOut: decodeBtcOut(receipt.logs), status: "confirmed" as const };
    } catch (e) {
      if (e instanceof ApiError) throw e;
      return { txHash, btcOut: null, status: "submitted" as const };
    }
  });
}

function decodeBtcOut(logs: Parameters<typeof parseEventLogs>[0]["logs"]): bigint | null {
  const parsed = parseEventLogs({ abi: refuelAbi, eventName: "Refueled", logs });
  return parsed[0]?.args.btcOut ?? null;
}

async function btcOutFromTx(hash: Hex): Promise<bigint | null> {
  try {
    const receipt = await publicClient().getTransactionReceipt({ hash });
    return decodeBtcOut(receipt.logs);
  } catch {
    return null;
  }
}
