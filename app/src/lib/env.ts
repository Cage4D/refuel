import "server-only";
import { getAddress, type Address, type Hex } from "viem";
import { z } from "zod";

const addr = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((a) => getAddress(a));
const blankToUndef = (v: unknown) => (v === "" ? undefined : v);

const schema = z.object({
  MEZO_RPC: z.string().url().default("https://rpc.test.mezo.org"),
  CHAIN_ID: z.coerce.number().int().default(31611),
  EXPLORER_URL: z.string().url().default("https://explorer.test.mezo.org"),
  MUSD_ADDRESS: addr.default("0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503"),
  REFUEL_ADDRESS: z.preprocess(blankToUndef, addr.optional()),
  REFUEL_DEPLOY_BLOCK: z.preprocess(blankToUndef, z.coerce.bigint().optional()),
  RELAYER_PK: z.preprocess(
    blankToUndef,
    z
      .string()
      .regex(/^(0x)?[0-9a-fA-F]{64}$/)
      .transform((k) => (k.startsWith("0x") ? k : `0x${k}`) as Hex)
      .optional(),
  ),
  ALLOWED_ORIGIN: z.string().default("http://localhost:3000"),
  PERMIT_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  RELAYER_MIN_BALANCE_WEI: z.coerce.bigint().default(200000000000000n),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;
export function env(): Env {
  if (!cached) {
    // strip inline "# comments" left on values in .env files
    const raw = Object.fromEntries(
      Object.keys(schema.shape).map((k) => [k, process.env[k]?.replace(/\s+#.*$/, "").trim()]),
    );
    cached = schema.parse(raw);
  }
  return cached;
}

export function refuelAddress(): Address {
  const a = env().REFUEL_ADDRESS;
  if (!a) throw new Error("REFUEL_ADDRESS is not configured");
  return a;
}
