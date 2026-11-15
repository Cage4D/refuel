import { publicClient, relayerAddressOrNull } from "@/lib/chain";
import { env, refuelAddress } from "@/lib/env";
import { priceDecimal } from "@/lib/format";
import { handler, json, options } from "@/lib/http";
import { readPaused, readQuote } from "@/lib/reads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = options;

export const GET = handler(async () => {
  const client = publicClient();
  const e = env();
  const relayer = relayerAddressOrNull();
  const refuel = e.REFUEL_ADDRESS ?? null;

  const [chainId, relayerBalance, floatBalance, paused, price] = await Promise.all([
    client.getChainId(),
    relayer ? client.getBalance({ address: relayer }) : Promise.resolve(0n),
    refuel ? client.getBalance({ address: refuelAddress() }) : Promise.resolve(0n),
    refuel ? readPaused() : Promise.resolve(true),
    refuel
      ? readQuote(10n ** 18n)
          .then((q) => q.price)
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  const ok =
    chainId === e.CHAIN_ID &&
    !!relayer &&
    !!refuel &&
    !paused &&
    price !== null &&
    floatBalance > 0n &&
    relayerBalance >= e.RELAYER_MIN_BALANCE_WEI;

  return json({
    ok,
    chainId,
    relayer,
    relayerBalance,
    refuel,
    floatBalance,
    paused,
    priceUsd: price === null ? null : priceDecimal(price),
  });
});
