import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import { z } from "zod";
import type { ErrorCode } from "./errors";

/** Shared by the API (validation) and the UI (types). Amounts are decimal strings in wei. */

export const address = z
  .string()
  .refine((a) => isAddress(a, { strict: false }), "invalid address")
  .transform((a) => getAddress(a) as Address);

export const weiString = z.string().regex(/^\d{1,78}$/, "expected a wei integer string");

/** Human MUSD amount like "2" or "1.5". */
export const musdAmount = z.string().regex(/^\d{1,6}(\.\d{1,18})?$/, "expected a MUSD amount");

export const quoteQuery = z.object({ owner: address, amount: musdAmount });

export const refuelBody = z.object({
  owner: address,
  amountIn: weiString,
  deadline: z.union([weiString, z.number().int().nonnegative()]).transform((d) => BigInt(d)),
  signature: z
    .string()
    .refine((s) => isHex(s) && (s.length === 132 || s.length === 130), "expected a 65-byte signature")
    .transform((s) => s as Hex),
});
export type RefuelBody = z.input<typeof refuelBody>;

export const refuelsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

// ---------------------------------------------------------------- response shapes

export type Eligibility = { ok: boolean; reason: number; code: ErrorCode | null; nextAt: number };

export type PermitTypedData = {
  domain: { name: string; version: string; chainId: number; verifyingContract: Address };
  types: { Permit: { name: string; type: string }[] };
  primaryType: "Permit";
  message: { owner: Address; spender: Address; value: string; nonce: string; deadline: string };
};

export type QuoteResponse = {
  amountIn: string;
  fee: string;
  btcOut: string;
  priceUsd: string;
  gasPrice: string;
  formatted: { amountIn: string; fee: string; btcOut: string; priceUsd: string; feeUsd: string };
  eligibility: Eligibility;
  musdBalance: string;
  btcBalance: string;
  permit: PermitTypedData;
};

export type RefuelResponse = {
  txHash: Hex;
  explorerTxUrl: string;
  btcOut: string | null;
  formatted?: { btcOut: string };
  status: "confirmed" | "submitted";
};

export type ConfigResponse = {
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  refuel: Address;
  refuelUrl: string;
  musd: { address: Address; name: string; version: string; decimals: number };
  limits: { minAmountIn: string; maxAmountIn: string; cooldown: number; maxRefuelsPerAddress: number; dailyBtcCap: string };
  fees: { feeBps: number; flatFee: string };
  permitTtlSeconds: number;
};

export type RefuelEvent = {
  owner: string;
  btcOut: string;
  amountIn: string;
  formatted: { btcOut: string; amountIn: string };
  txHash: Hex;
  explorerTxUrl: string;
  timestamp: number;
};
