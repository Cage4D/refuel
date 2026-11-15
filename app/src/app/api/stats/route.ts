import { publicClient } from "@/lib/chain";
import { refuelAbi } from "@/lib/contracts";
import { refuelAddress } from "@/lib/env";
import { formatBtc, formatMusd } from "@/lib/format";
import { handler, json, options } from "@/lib/http";
import { refueledLogs } from "@/lib/reads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = options;

export const GET = handler(async () => {
  const c = publicClient();
  const r = { address: refuelAddress(), abi: refuelAbi } as const;
  const [totalRefuels, totalBtcOut, totalMusdIn, logs] = await Promise.all([
    c.readContract({ ...r, functionName: "totalRefuels" }),
    c.readContract({ ...r, functionName: "totalBtcOut" }),
    c.readContract({ ...r, functionName: "totalMusdIn" }),
    refueledLogs(),
  ]);
  return json({
    totalRefuels,
    totalBtcOut,
    totalMusdIn,
    uniqueOwners: new Set(logs.map((l) => l.owner)).size,
    formatted: { totalBtcOut: formatBtc(totalBtcOut), totalMusdIn: formatMusd(totalMusdIn) },
  });
});
