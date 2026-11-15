import "server-only";
import { parseAbiItem, type Address, type Hex } from "viem";
import { publicClient } from "./chain";
import { erc20PermitAbi, refuelAbi } from "./contracts";
import { env, refuelAddress } from "./env";
import { ApiError, codeForRevert, revertInfo } from "./errors";

const refuel = () => ({ address: refuelAddress(), abi: refuelAbi }) as const;

export async function readLimits() {
  const [minAmountIn, maxAmountIn, cooldown, maxRefuelsPerAddress, dailyBtcCap] = await publicClient().readContract({
    ...refuel(),
    functionName: "limits",
  });
  return { minAmountIn, maxAmountIn, cooldown, maxRefuelsPerAddress, dailyBtcCap };
}

export async function readFees() {
  const [feeBps, flatFee] = await publicClient().readContract({ ...refuel(), functionName: "fees" });
  return { feeBps, flatFee };
}

export async function readEligibility(owner: Address) {
  const [ok, reason, nextAt] = await publicClient().readContract({
    ...refuel(),
    functionName: "eligibility",
    args: [owner],
  });
  return { ok, reason, nextAt: Number(nextAt) };
}

/** `quote()` is non-view on-chain (fetchPrice may write), so run it through eth_call. */
export async function readQuote(amountIn: bigint) {
  try {
    const { result } = await publicClient().simulateContract({
      ...refuel(),
      functionName: "quote",
      args: [amountIn],
    });
    const [btcOut, fee, price] = result;
    return { btcOut, fee, price };
  } catch (e) {
    const { name } = revertInfo(e);
    throw new ApiError(name ? codeForRevert(name) : "ORACLE_UNAVAILABLE");
  }
}

export async function readPaused() {
  return publicClient().readContract({ ...refuel(), functionName: "paused" });
}

export async function musdBalance(owner: Address) {
  return publicClient().readContract({
    address: env().MUSD_ADDRESS,
    abi: erc20PermitAbi,
    functionName: "balanceOf",
    args: [owner],
  });
}

let musdMeta: Promise<{ name: string; decimals: number }> | undefined;
export function readMusdMeta() {
  musdMeta ??= (async () => {
    const c = publicClient();
    const a = env().MUSD_ADDRESS;
    const [name, decimals] = await Promise.all([
      c.readContract({ address: a, abi: erc20PermitAbi, functionName: "name" }),
      c.readContract({ address: a, abi: erc20PermitAbi, functionName: "decimals" }),
    ]);
    return { name, decimals };
  })().catch((e) => {
    musdMeta = undefined;
    throw e;
  });
  return musdMeta;
}

// ---------------------------------------------------------------- event log scan

export const refueledEvent = parseAbiItem(
  "event Refueled(address indexed owner, address indexed relayer, uint256 amountIn, uint256 fee, uint256 btcOut, uint256 price)",
);

export type RefueledLog = {
  owner: Address;
  relayer: Address;
  amountIn: bigint;
  fee: bigint;
  btcOut: bigint;
  price: bigint;
  txHash: Hex;
  blockNumber: bigint;
  timestamp: number;
};

const MAX_RANGE = 9_999n; // Mezo RPC caps eth_getLogs at 10,000 blocks
const CACHE_MS = 15_000;
let logCache: { at: number; logs: RefueledLog[]; scannedTo: bigint } | undefined;
const blockTimes = new Map<bigint, number>();

/** All Refueled events since REFUEL_DEPLOY_BLOCK, scanned incrementally in 10k-block chunks. */
export async function refueledLogs(): Promise<RefueledLog[]> {
  if (logCache && Date.now() - logCache.at < CACHE_MS) return logCache.logs;
  const client = publicClient();
  const latest = await client.getBlockNumber();
  const deployBlock = env().REFUEL_DEPLOY_BLOCK ?? (latest > 50_000n ? latest - 50_000n : 0n);
  let from = logCache ? logCache.scannedTo + 1n : deployBlock;
  const found = [...(logCache?.logs ?? [])];

  while (from <= latest) {
    const to = from + MAX_RANGE > latest ? latest : from + MAX_RANGE;
    const logs = await client.getLogs({ address: refuelAddress(), event: refueledEvent, fromBlock: from, toBlock: to });
    for (const l of logs) {
      let ts = blockTimes.get(l.blockNumber);
      if (ts === undefined) {
        ts = Number((await client.getBlock({ blockNumber: l.blockNumber })).timestamp);
        blockTimes.set(l.blockNumber, ts);
      }
      found.push({
        owner: l.args.owner!,
        relayer: l.args.relayer!,
        amountIn: l.args.amountIn!,
        fee: l.args.fee!,
        btcOut: l.args.btcOut!,
        price: l.args.price!,
        txHash: l.transactionHash,
        blockNumber: l.blockNumber,
        timestamp: ts,
      });
    }
    from = to + 1n;
  }
  logCache = { at: Date.now(), logs: found, scannedTo: latest };
  return found;
}
