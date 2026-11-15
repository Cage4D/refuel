import { explorerAddress } from "@/lib/chain";
import { env, refuelAddress } from "@/lib/env";
import { handler, json, options } from "@/lib/http";
import { permitDomain } from "@/lib/permit";
import { readFees, readLimits, readMusdMeta } from "@/lib/reads";
import type { ConfigResponse } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = options;

export const GET = handler(async () => {
  const e = env();
  const [limits, fees, meta, domain] = await Promise.all([readLimits(), readFees(), readMusdMeta(), permitDomain()]);
  const body: ConfigResponse = {
    chainId: e.CHAIN_ID,
    rpcUrl: e.MEZO_RPC,
    explorerUrl: e.EXPLORER_URL,
    refuel: refuelAddress(),
    refuelUrl: explorerAddress(refuelAddress()),
    musd: { address: e.MUSD_ADDRESS, name: meta.name, version: domain.version, decimals: meta.decimals },
    limits: {
      minAmountIn: limits.minAmountIn.toString(),
      maxAmountIn: limits.maxAmountIn.toString(),
      cooldown: Number(limits.cooldown),
      maxRefuelsPerAddress: Number(limits.maxRefuelsPerAddress),
      dailyBtcCap: limits.dailyBtcCap.toString(),
    },
    fees: { feeBps: fees.feeBps, flatFee: fees.flatFee.toString() },
    permitTtlSeconds: e.PERMIT_TTL_SECONDS,
  };
  return json(body);
});
