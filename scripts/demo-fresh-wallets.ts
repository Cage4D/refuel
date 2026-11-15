/**
 * Proves real usage: N fresh wallets with MUSD but zero BTC refuel through the API, then each
 * sends a transaction paid with its own new BTC.
 *
 *   pnpm demo --count 4 --amount 2 [--api http://localhost:3000] [--no-readme]
 *
 * Env (repo-root .env): MEZO_RPC, CHAIN_ID, EXPLORER_URL, MUSD_ADDRESS, DEMO_FUNDER_PK.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  parseAbi,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const root = resolve(import.meta.dirname, "..");
loadDotEnv(resolve(root, ".env"));

const { values } = parseArgs({
  options: {
    count: { type: "string", default: "4" },
    amount: { type: "string", default: "2" },
    api: { type: "string", default: "http://localhost:3000" },
    "no-readme": { type: "boolean", default: false },
  },
});
const COUNT = Number(values.count);
const AMOUNT = values.amount!;
const API = values.api!.replace(/\/$/, "");

const RPC = need("MEZO_RPC");
const EXPLORER = process.env.EXPLORER_URL ?? "https://explorer.test.mezo.org";
const MUSD = need("MUSD_ADDRESS") as Address;
const FUNDER_PK = normPk(need("DEMO_FUNDER_PK"));

const chain = defineChain({
  id: Number(process.env.CHAIN_ID ?? 31611),
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http(RPC) });
const erc20 = parseAbi([
  "function transfer(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

const WALLETS_FILE = resolve(root, "scripts/.demo-wallets.json");

type Row = { wallet: Address; refuelTx: string; btcOut: string; followUpTx: string };

async function main() {
  const funder = createWalletClient({ account: privateKeyToAccount(FUNDER_PK), chain, transport: http(RPC) });
  const amountIn = parseUnits(AMOUNT, 18);
  const topUp = amountIn + parseUnits("0.5", 18);

  const health = await getJson(`${API}/api/health`);
  console.log("health:", health);
  if (!health.ok) throw new Error("API health is not ok; fix before running the demo");

  // 1. fresh keys (appended to the gitignored wallets file)
  const saved: { address: Address; privateKey: Hex; createdAt: string }[] = existsSync(WALLETS_FILE)
    ? JSON.parse(readFileSync(WALLETS_FILE, "utf8"))
    : [];
  const fresh = Array.from({ length: COUNT }, () => {
    const privateKey = generatePrivateKey();
    return { address: privateKeyToAccount(privateKey).address, privateKey, createdAt: new Date().toISOString() };
  });
  writeFileSync(WALLETS_FILE, JSON.stringify([...saved, ...fresh], null, 2));
  console.log(`generated ${COUNT} fresh wallets → ${WALLETS_FILE}`);

  // 2. fund each with MUSD only (no BTC)
  const funderBal = await pub.readContract({ address: MUSD, abi: erc20, functionName: "balanceOf", args: [funder.account.address] });
  if (funderBal < topUp * BigInt(COUNT)) throw new Error(`funder needs ${formatEther(topUp * BigInt(COUNT))} MUSD`);
  for (const w of fresh) {
    const hash = await funder.writeContract({ address: MUSD, abi: erc20, functionName: "transfer", args: [w.address, topUp] });
    await pub.waitForTransactionReceipt({ hash });
    const btc = await pub.getBalance({ address: w.address });
    console.log(`funded ${w.address} with ${formatEther(topUp)} MUSD (BTC balance: ${formatEther(btc)})`);
  }

  // 3. refuel each through the API, then spend the new BTC
  const rows: Row[] = [];
  for (const w of fresh) {
    const account = privateKeyToAccount(w.privateKey);
    const quote = await getJson(`${API}/api/quote?owner=${w.address}&amount=${AMOUNT}`);
    if (!quote.eligibility.ok) throw new Error(`not eligible: ${JSON.stringify(quote.eligibility)}`);
    const { domain, types, message } = quote.permit;
    const signature = await account.signTypedData({
      domain: { ...domain, chainId: BigInt(domain.chainId) },
      types,
      primaryType: "Permit",
      message: {
        owner: message.owner,
        spender: message.spender,
        value: BigInt(message.value),
        nonce: BigInt(message.nonce),
        deadline: BigInt(message.deadline),
      },
    });

    const res = await fetch(`${API}/api/refuel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner: w.address, amountIn: quote.amountIn, deadline: message.deadline, signature }),
    });
    const body = await res.json();
    if (!res.ok && res.status !== 202) throw new Error(`refuel failed: ${JSON.stringify(body)}`);
    if (body.status !== "confirmed") await pub.waitForTransactionReceipt({ hash: body.txHash });
    const btc = await pub.getBalance({ address: w.address });
    console.log(`refueled ${w.address}: +${formatEther(btc)} BTC  ${body.explorerTxUrl}`);

    // follow-up: a small MUSD transfer paid with the wallet's own BTC
    const wallet = createWalletClient({ account, chain, transport: http(RPC) });
    const follow = await wallet.writeContract({
      address: MUSD,
      abi: erc20,
      functionName: "transfer",
      args: [account.address, parseUnits("0.1", 18)],
    });
    const rc = await pub.waitForTransactionReceipt({ hash: follow });
    if (rc.status !== "success") throw new Error(`follow-up tx failed: ${follow}`);
    console.log(`  follow-up tx paid with own gas: ${EXPLORER}/tx/${follow}`);

    rows.push({
      wallet: w.address,
      refuelTx: body.txHash,
      btcOut: formatEther(BigInt(body.btcOut ?? btc)),
      followUpTx: follow,
    });
  }

  // 4. markdown table
  const short = (h: string) => `${h.slice(0, 10)}…`;
  const table = [
    "| Wallet | Refuel tx | BTC received | Follow-up tx (own gas) |",
    "|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| [\`${r.wallet.slice(0, 8)}…${r.wallet.slice(-4)}\`](${EXPLORER}/address/${r.wallet}) | [${short(r.refuelTx)}](${EXPLORER}/tx/${r.refuelTx}) | ${r.btcOut} | [${short(r.followUpTx)}](${EXPLORER}/tx/${r.followUpTx}) |`,
    ),
  ].join("\n");
  console.log(`\n${table}\n`);

  if (!values["no-readme"]) appendToReadme(table);
}

function appendToReadme(table: string) {
  const path = resolve(root, "README.md");
  const readme = existsSync(path) ? readFileSync(path, "utf8") : "";
  const stamp = `_Run ${new Date().toISOString()} via \`pnpm demo --count ${COUNT} --amount ${AMOUNT}\`_`;
  const block = `${stamp}\n\n${table}\n`;
  const marker = "<!-- demo-proof -->";
  const next = readme.includes(marker)
    ? readme.replace(marker, `${marker}\n\n${block}`)
    : `${readme.trimEnd()}\n\n## On-chain proof\n\n${marker}\n\n${block}`;
  writeFileSync(path, next);
  console.log("appended table to README.md under “On-chain proof”");
}

async function getJson(url: string) {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(`${url} → ${res.status} ${JSON.stringify(body)}`);
  return body;
}

function need(k: string): string {
  const v = process.env[k]?.replace(/\s+#.*$/, "").trim();
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

function normPk(k: string): Hex {
  return (k.startsWith("0x") ? k : `0x${k}`) as Hex;
}

function loadDotEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
