import { formatUnits, parseUnits } from "viem";
import { publicClient } from "@/lib/chain";
import { env, refuelAddress } from "@/lib/env";
import { ApiError, ELIGIBILITY_CODES } from "@/lib/errors";
import { formatBtc, formatMusd, formatUsd, priceDecimal } from "@/lib/format";
import { handler, json, options } from "@/lib/http";
import { buildPermit, musdNonce } from "@/lib/permit";
import { clientIp, readLimiter } from "@/lib/ratelimit";
import { musdBalance, readEligibility, readLimits, readQuote } from "@/lib/reads";
import { quoteQuery, type QuoteResponse } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = options;

export const GET = handler(async (req: Request) => {
  if (!readLimiter.take(clientIp(req))) throw new ApiError("RATE_LIMITED");
  const url = new URL(req.url);
  const { owner, amount } = quoteQuery.parse(Object.fromEntries(url.searchParams));
  const amountIn = parseUnits(amount, 18);

  const limits = await readLimits();
  if (amountIn < limits.minAmountIn || amountIn > limits.maxAmountIn) {
    throw new ApiError("AMOUNT_OUT_OF_RANGE", {
      min: formatUnits(limits.minAmountIn, 18),
      max: formatUnits(limits.maxAmountIn, 18),
    });
  }

  const client = publicClient();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + env().PERMIT_TTL_SECONDS);
  const [q, elig, musdBal, btcBal, nonce, gasPrice] = await Promise.all([
    readQuote(amountIn),
    readEligibility(owner),
    musdBalance(owner),
    client.getBalance({ address: owner }),
    musdNonce(owner),
    client.getGasPrice(),
  ]);

  const permit = await buildPermit({ owner, spender: refuelAddress(), value: amountIn, nonce, deadline });

  const body: QuoteResponse = {
    amountIn: amountIn.toString(),
    fee: q.fee.toString(),
    btcOut: q.btcOut.toString(),
    priceUsd: priceDecimal(q.price),
    gasPrice: gasPrice.toString(),
    formatted: {
      amountIn: formatMusd(amountIn),
      fee: formatMusd(q.fee),
      feeUsd: formatUsd(q.fee),
      btcOut: formatBtc(q.btcOut),
      priceUsd: formatUsd(q.price),
    },
    eligibility: { ok: elig.ok, reason: elig.reason, code: ELIGIBILITY_CODES[elig.reason] ?? null, nextAt: elig.nextAt },
    musdBalance: musdBal.toString(),
    btcBalance: btcBal.toString(),
    permit,
  };
  return json(body);
});
