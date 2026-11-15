import { formatUnits } from "viem";
import { explorerTx } from "@/lib/chain";
import { env, refuelAddress } from "@/lib/env";
import { ApiError, ELIGIBILITY_CODES } from "@/lib/errors";
import { formatBtc, relativeTime } from "@/lib/format";
import { handler, json, options } from "@/lib/http";
import { musdNonce, verifyPermit } from "@/lib/permit";
import { clientIp, ipLimiter, ownerLimiter } from "@/lib/ratelimit";
import { musdBalance, readEligibility, readLimits } from "@/lib/reads";
import { assertRelayerFunded, knownTx, relayRefuel } from "@/lib/relayer";
import { refuelBody, type RefuelResponse } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const OPTIONS = options;

export const POST = handler(async (req: Request) => {
  const started = Date.now();

  // 1. rate limit (per IP here; per owner after parsing)
  if (!ipLimiter.take(clientIp(req))) throw new ApiError("RATE_LIMITED");

  // 2. parse + normalise
  const raw = await req.json().catch(() => {
    throw new ApiError("INVALID_INPUT");
  });
  const { owner, amountIn: amountStr, deadline, signature } = refuelBody.parse(raw);
  const amountIn = BigInt(amountStr);

  // 10. idempotency: a repeat of an already-relayed signature returns the same tx
  const prior = knownTx(signature);
  if (prior) {
    const r = await relayRefuel({ owner, amountIn, deadline, signature });
    return respond(r.txHash, r.btcOut, r.status);
  }

  if (!ownerLimiter.take(owner)) throw new ApiError("RATE_LIMITED");

  // 3. deadline window
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (deadline <= now + 30n) throw new ApiError("PERMIT_EXPIRED");
  if (deadline > now + BigInt(env().PERMIT_TTL_SECONDS) + 60n) throw new ApiError("INVALID_INPUT", {}, { field: "deadline" });

  const limits = await readLimits();
  const range = { min: formatUnits(limits.minAmountIn, 18), max: formatUnits(limits.maxAmountIn, 18) };
  if (amountIn < limits.minAmountIn || amountIn > limits.maxAmountIn) throw new ApiError("AMOUNT_OUT_OF_RANGE", range);

  // 4-5. typed data + signature check
  const spender = refuelAddress();
  const nonce = await musdNonce(owner);
  const valid = await verifyPermit({ owner, spender, value: amountIn, nonce, deadline, signature });
  if (!valid) throw new ApiError("INVALID_SIGNATURE");

  // 6. off-chain pre-checks
  const [bal, elig] = await Promise.all([musdBalance(owner), readEligibility(owner), assertRelayerFunded()]);
  if (bal < amountIn) throw new ApiError("INSUFFICIENT_MUSD", { min: formatUnits(amountIn, 18) });
  if (!elig.ok) {
    const code = ELIGIBILITY_CODES[elig.reason] ?? "CHAIN_ERROR";
    throw new ApiError(code, { relativeTime: relativeTime(elig.nextAt) }, elig.nextAt ? { nextAt: elig.nextAt } : undefined);
  }

  // 7-9. simulate, submit under the send mutex, wait, decode
  const r = await relayRefuel({ owner, amountIn, deadline, signature });
  console.info("[refuel]", { owner, amountIn: amountIn.toString(), txHash: r.txHash, ms: Date.now() - started });
  return respond(r.txHash, r.btcOut, r.status);
});

function respond(txHash: `0x${string}`, btcOut: bigint | null, status: "confirmed" | "submitted") {
  const body: RefuelResponse = {
    txHash,
    explorerTxUrl: explorerTx(txHash),
    btcOut: btcOut?.toString() ?? null,
    ...(btcOut !== null ? { formatted: { btcOut: formatBtc(btcOut) } } : {}),
    status,
  };
  return json(body, status === "confirmed" ? 200 : 202);
}
