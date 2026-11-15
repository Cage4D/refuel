"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatUnits,
  http,
  parseAbi,
  parseUnits,
  type Address,
  type EIP1193Provider,
} from "viem";
import { ERRORS, type ErrorBody, type ErrorCode } from "@/lib/errors";
import { formatBtc, formatMusd, relativeTime } from "@/lib/format";
import type { ConfigResponse, QuoteResponse, RefuelEvent, RefuelResponse } from "@/lib/schemas";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

const AMOUNTS = ["1", "2", "5"] as const;
const GAS_PER_TX = 60_000n;
const erc20 = parseAbi(["function transfer(address,uint256) returns (bool)"]);

type Phase =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "relaying" }
  | { kind: "done"; res: RefuelResponse }
  | { kind: "error"; message: string };

type TryPhase = { kind: "idle" } | { kind: "sending" } | { kind: "done"; hash: string } | { kind: "error"; message: string };

class UiError extends Error {}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => null);
  if (!res.ok && res.status !== 202) {
    const err = (body as ErrorBody | null)?.error;
    throw new UiError(err?.message ?? ERRORS.CHAIN_ERROR.message);
  }
  return body as T;
}

function eligibilityMessage(code: ErrorCode | null, nextAt: number) {
  if (!code) return null;
  return ERRORS[code].message.replace("{relativeTime}", relativeTime(nextAt));
}

function isUserRejection(e: unknown) {
  const err = e as { code?: number; cause?: { code?: number }; message?: string };
  return err?.code === 4001 || err?.cause?.code === 4001 || /user (rejected|denied)/i.test(err?.message ?? "");
}

export default function Home() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [hasWallet, setHasWallet] = useState<boolean | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [amount, setAmount] = useState<(typeof AMOUNTS)[number]>("2");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [tryPhase, setTryPhase] = useState<TryPhase>({ kind: "idle" });
  const [feed, setFeed] = useState<RefuelEvent[]>([]);

  const chain = useMemo(
    () =>
      config &&
      defineChain({
        id: config.chainId,
        name: "Mezo Testnet",
        nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
        rpcUrls: { default: { http: [config.rpcUrl] } },
        blockExplorers: { default: { name: "Mezo Explorer", url: config.explorerUrl } },
      }),
    [config],
  );

  // ---------------------------------------------------------------- data

  useEffect(() => {
    setHasWallet(typeof window !== "undefined" && !!window.ethereum);
    api<ConfigResponse>("/api/config")
      .then(setConfig)
      .catch((e) => setConfigError(e.message));
  }, []);

  const loadFeed = useCallback(() => {
    api<RefuelEvent[]>("/api/refuels?limit=8")
      .then(setFeed)
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadFeed();
    const t = setInterval(loadFeed, 20_000);
    return () => clearInterval(t);
  }, [loadFeed]);

  const loadQuote = useCallback(async () => {
    if (!account) return;
    setQuoteError(null);
    try {
      setQuote(await api<QuoteResponse>(`/api/quote?owner=${account}&amount=${amount}`));
    } catch (e) {
      setQuote(null);
      setQuoteError((e as Error).message);
    }
  }, [account, amount]);
  useEffect(() => {
    loadQuote();
  }, [loadQuote]);

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth?.on) return;
    const onAccounts = (accs: string[]) => setAccount((accs[0] as Address) ?? null);
    eth.on("accountsChanged", onAccounts);
    return () => eth.removeListener?.("accountsChanged", onAccounts);
  }, []);

  // ---------------------------------------------------------------- wallet

  async function ensureChain() {
    const eth = window.ethereum!;
    if (!config) return;
    const hexId = `0x${config.chainId.toString(16)}`;
    const current = (await eth.request({ method: "eth_chainId" })) as string;
    if (parseInt(current, 16) === config.chainId) return;
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    } catch {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hexId,
            chainName: "Mezo Testnet",
            nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
            rpcUrls: [config.rpcUrl],
            blockExplorerUrls: [config.explorerUrl],
          },
        ],
      });
    }
  }

  async function connect() {
    setConnectError(null);
    try {
      const accs = (await window.ethereum!.request({ method: "eth_requestAccounts" })) as Address[];
      await ensureChain();
      setAccount(accs[0] ?? null);
    } catch (e) {
      setConnectError(isUserRejection(e) ? "Connection cancelled." : "Couldn't connect to your wallet.");
    }
  }

  // ---------------------------------------------------------------- refuel

  async function refuel() {
    if (!quote || !account) return;
    setTryPhase({ kind: "idle" });
    try {
      await ensureChain();
      setPhase({ kind: "signing" });
      // fresh quote so the nonce and deadline are current
      const q = await api<QuoteResponse>(`/api/quote?owner=${account}&amount=${amount}`);
      setQuote(q);
      const typedData = {
        ...q.permit,
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
          ...q.permit.types,
        },
      };
      const signature = (await window.ethereum!.request({
        method: "eth_signTypedData_v4",
        params: [account, JSON.stringify(typedData)],
      } as never)) as `0x${string}`;

      setPhase({ kind: "relaying" });
      const res = await api<RefuelResponse>("/api/refuel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: account,
          amountIn: q.amountIn,
          deadline: q.permit.message.deadline,
          signature,
        }),
      });
      if (res.status === "submitted" && chain) {
        await createPublicClient({ chain, transport: http() }).waitForTransactionReceipt({ hash: res.txHash });
      }
      setPhase({ kind: "done", res });
      loadFeed();
      await loadQuote();
    } catch (e) {
      if (isUserRejection(e)) setPhase({ kind: "error", message: "Signature cancelled. Nothing happened." });
      else setPhase({ kind: "error", message: e instanceof UiError ? e.message : ERRORS.CHAIN_ERROR.message });
    }
  }

  async function tryIt() {
    if (!account || !config || !chain) return;
    setTryPhase({ kind: "sending" });
    try {
      await ensureChain();
      const wallet = createWalletClient({ account, chain, transport: custom(window.ethereum!) });
      const hash = await wallet.writeContract({
        address: config.musd.address,
        abi: erc20,
        functionName: "transfer",
        args: [account, parseUnits("0.1", 18)],
        // Mezo enforces the EIP-7623 calldata floor; estimates can fall just below it.
        gas: 100_000n,
      });
      await createPublicClient({ chain, transport: http() }).waitForTransactionReceipt({ hash });
      setTryPhase({ kind: "done", hash });
      await loadQuote();
    } catch (e) {
      setTryPhase({
        kind: "error",
        message: isUserRejection(e) ? "Transaction cancelled." : "That transaction didn't go through.",
      });
    }
  }

  // ---------------------------------------------------------------- derived

  const btcBalance = quote ? BigInt(quote.btcBalance) : null;
  const musdBalance = quote ? BigInt(quote.musdBalance) : null;
  const txEstimate = useMemo(() => {
    if (!quote) return null;
    const cost = BigInt(quote.gasPrice) * GAS_PER_TX;
    return cost > 0n ? BigInt(quote.btcOut) / cost : null;
  }, [quote]);
  const eligMsg = quote ? eligibilityMessage(quote.eligibility.code, quote.eligibility.nextAt) : null;
  const lowMusd = quote && musdBalance !== null && musdBalance < BigInt(quote.amountIn);
  const busy = phase.kind === "signing" || phase.kind === "relaying";
  const canRefuel = !!quote && quote.eligibility.ok && !lowMusd && !busy;

  // ---------------------------------------------------------------- render

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-4 py-10 sm:py-16">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-accent" aria-hidden />
          <span className="font-medium text-foreground">Refuel</span>
          <span>on Mezo</span>
          <span className="ml-auto rounded-full border border-line px-2 py-0.5 text-xs">Testnet only</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Got MUSD but no BTC for gas? Refuel.</h1>
        <p className="text-muted">Sign once, with no gas needed, and get enough BTC to use Mezo.</p>
      </header>

      {configError && <Notice tone="danger">{configError}</Notice>}

      {/* wallet */}
      {hasWallet === false ? (
        <Card>
          <p className="font-medium">No wallet found</p>
          <p className="mt-1 text-sm text-muted">
            Install a browser wallet such as{" "}
            <a className="underline" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
              MetaMask
            </a>
            , then reload this page.
          </p>
        </Card>
      ) : !account ? (
        <Card>
          <button
            onClick={connect}
            disabled={!config}
            className="w-full rounded-xl bg-foreground px-4 py-3 font-medium text-background transition hover:opacity-90 disabled:opacity-50"
          >
            Connect wallet
          </button>
          <p className="mt-2 text-center text-xs text-muted">Adds Mezo Testnet to your wallet if needed. No gas.</p>
          {connectError && <p className="mt-2 text-center text-sm text-danger">{connectError}</p>}
        </Card>
      ) : (
        <>
          {/* balances */}
          <Card>
            <div className="flex items-center justify-between text-xs text-muted">
              <span className="font-mono">
                {account.slice(0, 6)}…{account.slice(-4)}
              </span>
              <span>Mezo Testnet</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Balance
                label="BTC (gas)"
                value={btcBalance === null ? "…" : formatBtc(btcBalance)}
                danger={btcBalance === 0n}
                hint={btcBalance === 0n ? "No gas: you're stuck" : undefined}
              />
              <Balance label="MUSD" value={musdBalance === null ? "…" : formatMusd(musdBalance)} />
            </div>
          </Card>

          {/* amount + quote */}
          <Card>
            <p className="text-sm font-medium">How much MUSD to spend?</p>
            <div className="mt-3 flex gap-2">
              {AMOUNTS.map((a) => (
                <button
                  key={a}
                  onClick={() => setAmount(a)}
                  disabled={busy}
                  className={`flex-1 rounded-xl border px-3 py-2 font-medium transition ${
                    amount === a ? "border-accent bg-accent text-accent-ink" : "border-line hover:border-muted"
                  }`}
                >
                  {a} MUSD
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-xl bg-background p-4">
              {quote ? (
                <>
                  <p className="text-lg">
                    You get ≈ <span className="font-semibold">{quote.formatted.btcOut}</span>
                    {txEstimate !== null && (
                      <span className="text-muted"> (≈ {txEstimate.toLocaleString()} transactions*)</span>
                    )}
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm text-muted">
                    <dt>Fee</dt>
                    <dd className="text-right">{quote.formatted.fee}</dd>
                    <dt>BTC price</dt>
                    <dd className="text-right">{quote.formatted.priceUsd} from Mezo PriceFeed</dd>
                  </dl>
                </>
              ) : quoteError ? (
                <p className="text-sm text-danger">{quoteError}</p>
              ) : (
                <p className="text-sm text-muted">Getting a quote…</p>
              )}
            </div>

            {eligMsg && <Notice tone="danger">{eligMsg}</Notice>}
            {lowMusd && (
              <Notice tone="danger">{ERRORS.INSUFFICIENT_MUSD.message.replace("{min}", amount)}</Notice>
            )}

            <button
              onClick={refuel}
              disabled={!canRefuel}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 font-semibold text-accent-ink transition hover:brightness-105 disabled:opacity-50"
            >
              {busy && <Spinner />}
              {phase.kind === "signing" ? "Check your wallet…" : phase.kind === "relaying" ? "Refueling…" : "Refuel"}
            </button>
            <p className="mt-2 text-center text-xs text-muted">
              You sign a permit (free). A relayer pays the gas and you receive BTC.
            </p>

            {phase.kind === "error" && <Notice tone="danger">{phase.message}</Notice>}
            {phase.kind === "done" && (
              <Notice tone="ok">
                Refueled{phase.res.formatted ? ` +${phase.res.formatted.btcOut}` : ""}.{" "}
                <a className="underline" href={phase.res.explorerTxUrl} target="_blank" rel="noreferrer">
                  View transaction
                </a>
              </Notice>
            )}
          </Card>

          {/* prove it */}
          {(phase.kind === "done" || (btcBalance !== null && btcBalance > 0n)) && (
            <Card>
              <p className="text-sm font-medium">Now try it</p>
              <p className="mt-1 text-sm text-muted">
                Send 0.1 MUSD to yourself, paid with your own BTC gas. Proof your wallet isn&apos;t stuck.
              </p>
              <button
                onClick={tryIt}
                disabled={tryPhase.kind === "sending" || !btcBalance}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-foreground px-4 py-2.5 font-medium transition hover:bg-foreground hover:text-background disabled:opacity-50"
              >
                {tryPhase.kind === "sending" && <Spinner />}
                {tryPhase.kind === "sending" ? "Sending…" : "Send 0.1 MUSD to myself"}
              </button>
              {tryPhase.kind === "done" && config && (
                <Notice tone="ok">
                  Sent with your own gas.{" "}
                  <a className="underline" href={`${config.explorerUrl}/tx/${tryPhase.hash}`} target="_blank" rel="noreferrer">
                    View transaction
                  </a>
                </Notice>
              )}
              {tryPhase.kind === "error" && <Notice tone="danger">{tryPhase.message}</Notice>}
            </Card>
          )}
        </>
      )}

      {/* footer */}
      <footer className="mt-auto flex flex-col gap-4 pt-6 text-sm">
        <div>
          <p className="mb-2 font-medium">Recent refuels</p>
          {feed.length === 0 ? (
            <p className="text-muted">No refuels yet.</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line bg-card">
              {feed.map((e) => (
                <li key={e.txHash} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="font-mono text-xs">{e.owner}</span>
                  <span className="text-muted">{e.formatted.amountIn}</span>
                  <a className="underline" href={e.explorerTxUrl} target="_blank" rel="noreferrer">
                    +{e.formatted.btcOut}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          {config && (
            <a className="underline" href={config.refuelUrl} target="_blank" rel="noreferrer">
              Verified Refuel contract
            </a>
          )}
          <span>* Estimate: BTC received ÷ (gas price × 60,000 gas).</span>
          <span className="rounded-full border border-line px-2 py-0.5">Testnet only · no real funds</span>
        </div>
        {config && (
          <p className="text-xs text-muted">
            Limits: {formatUnits(BigInt(config.limits.minAmountIn), 18)}–{formatUnits(BigInt(config.limits.maxAmountIn), 18)}{" "}
            MUSD per refuel, one per {Math.round(config.limits.cooldown / 3600)}h, {config.limits.maxRefuelsPerAddress} per
            wallet.
          </p>
        )}
      </footer>
    </main>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">{children}</section>;
}

function Balance({ label, value, danger, hint }: { label: string; value: string; danger?: boolean; hint?: string }) {
  return (
    <div className={`rounded-xl border p-3 ${danger ? "border-danger/60 bg-danger/10" : "border-line"}`}>
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 font-mono text-lg font-semibold ${danger ? "text-danger" : ""}`}>{value}</p>
      {hint && <p className="text-xs text-danger">{hint}</p>}
    </div>
  );
}

function Notice({ tone, children }: { tone: "ok" | "danger"; children: React.ReactNode }) {
  return (
    <p className={`mt-3 rounded-xl px-3 py-2 text-sm ${tone === "ok" ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger"}`}>
      {children}
    </p>
  );
}

function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />;
}
