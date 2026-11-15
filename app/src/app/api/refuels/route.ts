import { explorerTx } from "@/lib/chain";
import { formatBtc, formatMusd, shortAddr } from "@/lib/format";
import { handler, json, options } from "@/lib/http";
import { refueledLogs } from "@/lib/reads";
import { refuelsQuery, type RefuelEvent } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = options;

export const GET = handler(async (req: Request) => {
  const { limit } = refuelsQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  const logs = await refueledLogs();
  const events: RefuelEvent[] = logs
    .slice(-limit)
    .reverse()
    .map((l) => ({
      owner: shortAddr(l.owner),
      btcOut: l.btcOut.toString(),
      amountIn: l.amountIn.toString(),
      formatted: { btcOut: formatBtc(l.btcOut), amountIn: formatMusd(l.amountIn) },
      txHash: l.txHash,
      explorerTxUrl: explorerTx(l.txHash),
      timestamp: l.timestamp,
    }));
  return json(events);
});
