import "server-only";
import { hashDomain, verifyTypedData, type Address, type Hex } from "viem";
import { publicClient } from "./chain";
import { erc20PermitAbi } from "./contracts";
import { env } from "./env";
import type { PermitTypedData } from "./schemas";

export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export type PermitDomain = PermitTypedData["domain"];

let domainPromise: Promise<PermitDomain> | undefined;

/**
 * MUSD's EIP-712 domain. Prefers EIP-5267 `eip712Domain()`, falls back to `name()` + version "1".
 * On first use asserts the computed hash equals the token's `DOMAIN_SEPARATOR()`, then caches.
 */
export function permitDomain(): Promise<PermitDomain> {
  domainPromise ??= loadDomain().catch((e) => {
    domainPromise = undefined;
    throw e;
  });
  return domainPromise;
}

async function loadDomain(): Promise<PermitDomain> {
  const client = publicClient();
  const musd = env().MUSD_ADDRESS;
  let domain: PermitDomain;
  try {
    const [, name, version, chainId, verifyingContract] = await client.readContract({
      address: musd,
      abi: erc20PermitAbi,
      functionName: "eip712Domain",
    });
    domain = { name, version, chainId: Number(chainId), verifyingContract };
  } catch {
    const name = await client.readContract({ address: musd, abi: erc20PermitAbi, functionName: "name" });
    domain = { name, version: "1", chainId: env().CHAIN_ID, verifyingContract: musd };
  }
  const onChain = await client.readContract({ address: musd, abi: erc20PermitAbi, functionName: "DOMAIN_SEPARATOR" });
  const computed = hashDomain({
    domain: { ...domain, chainId: BigInt(domain.chainId) },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
    },
  });
  if (computed.toLowerCase() !== onChain.toLowerCase()) {
    throw new Error(`MUSD domain mismatch: computed ${computed}, on-chain ${onChain}`);
  }
  return domain;
}

export async function buildPermit(args: {
  owner: Address;
  spender: Address;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
}): Promise<PermitTypedData> {
  return {
    domain: await permitDomain(),
    types: { Permit: PERMIT_TYPES.Permit.map((f) => ({ ...f })) },
    primaryType: "Permit",
    message: {
      owner: args.owner,
      spender: args.spender,
      value: args.value.toString(),
      nonce: args.nonce.toString(),
      deadline: args.deadline.toString(),
    },
  };
}

export async function verifyPermit(args: {
  owner: Address;
  spender: Address;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
  signature: Hex;
}): Promise<boolean> {
  try {
    return await verifyTypedData({
      address: args.owner,
      domain: await permitDomain(),
      types: PERMIT_TYPES,
      primaryType: "Permit",
      message: {
        owner: args.owner,
        spender: args.spender,
        value: args.value,
        nonce: args.nonce,
        deadline: args.deadline,
      },
      signature: args.signature,
    });
  } catch {
    return false;
  }
}

export async function musdNonce(owner: Address): Promise<bigint> {
  return publicClient().readContract({
    address: env().MUSD_ADDRESS,
    abi: erc20PermitAbi,
    functionName: "nonces",
    args: [owner],
  });
}
