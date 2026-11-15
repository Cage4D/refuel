"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  parseAbi,
  parseUnits,
  type Address,
  type EIP1193Provider,
} from "viem";
import { ERRORS, type ErrorBody, type ErrorCode } from "@/lib/errors";
import type { ConfigResponse, QuoteResponse, RefuelEvent, RefuelResponse } from "@/lib/schemas";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export const AMOUNTS = ["1", "2", "5"] as const;
export type Amount = (typeof AMOUNTS)[number];
export const GAS_PER_TX = 60_000n;
/** A full tank: 0.002 BTC. The sphere and gauge are drawn against this. */
export const FLOAT_FULL = 2_000_000_000_000_000n;

const erc20 = parseAbi(["function transfer(address,uint256) returns (bool)"]);

/** Service-level problems shown as a banner (console state 9). */
export const BANNER_CODES: ErrorCode[] = ["FLOAT_EMPTY", "RELAYER_LOW", "PAUSED", "DAILY_CAP", "ORACLE_UNAVAILABLE"];

export type Health = {
  ok: boolean;
  chainId: number;
  relayer: string | null;
  relayerBalance: string;
  refuel: string | null;
  floatBalance: string;
  paused: boolean;
  priceUsd: string | null;
};

export type Stats = {
  totalRefuels: string;
  totalBtcOut: string;
  totalMusdIn: string;
  uniqueOwners: number;
  formatted: { totalBtcOut: string; totalMusdIn: string };
};

export type Phase =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "relaying" }
  | { kind: "done"; res: RefuelResponse; btcOut: string }
  | { kind: "cancelled" }
  | { kind: "error"; code: ErrorCode | null; message: string };

export type TryPhase =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; hash: string }
  | { kind: "error"; message: string };

export class ApiFail extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode | null,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => null);
  if (!res.ok && res.status !== 202) {
    const err = (body as ErrorBody | null)?.error;
    throw new ApiFail(err?.message ?? ERRORS.CHAIN_ERROR.message, err?.code ?? null);
  }
  return body as T;
}

export function isUserRejection(e: unknown) {
  const err = e as { code?: number; cause?: { code?: number }; message?: string };
  return err?.code === 4001 || err?.cause?.code === 4001 || /user (rejected|denied)/i.test(err?.message ?? "");
}

/** Start of the current UTC day, in unix seconds (the contract's daily budget window). */
const utcDayStart = () => Math.floor(Date.now() / 86_400_000) * 86_400;

export function useRefuel() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthFailed, setHealthFailed] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [events, setEvents] = useState<RefuelEvent[]>([]);

  const [hasWallet, setHasWallet] = useState<boolean | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [amount, setAmount] = useState<Amount>("2");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [tryPhase, setTryPhase] = useState<TryPhase>({ kind: "idle" });
  const [successCount, setSuccessCount] = useState(0);
  const runId = useRef(0);

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

  // ---------------------------------------------------------------- public data

  useEffect(() => {
    api<ConfigResponse>("/api/config")
      .then(setConfig)
      .catch((e) => setConfigError(e.message));
  }, []);

  const loadHealth = useCallback(() => {
    api<Health>("/api/health")
      .then((h) => {
        setHealth(h);
        setHealthFailed(false);
      })
      .catch(() => setHealthFailed(true));
  }, []);
  useEffect(() => {
    loadHealth();
    const t = setInterval(loadHealth, 30_000);
    return () => clearInterval(t);
  }, [loadHealth]);

  const loadFeed = useCallback(() => {
    // 50 rows: enough to sum today's payouts for the daily-budget figure.
    api<RefuelEvent[]>("/api/refuels?limit=50")
      .then(setEvents)
      .catch(() => {});
    api<Stats>("/api/stats")
      .then(setStats)
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadFeed();
    const t = setInterval(loadFeed, 20_000);
    return () => clearInterval(t);
  }, [loadFeed]);

  // ---------------------------------------------------------------- wallet

  useEffect(() => {
    const eth = window.ethereum;
    setHasWallet(!!eth);
    if (!eth) return;
    // restore an existing connection silently
    eth
      .request({ method: "eth_accounts" })
      .then((accs) => setAccount(((accs as Address[])[0] as Address) ?? null))
      .catch(() => {});
    eth
      .request({ method: "eth_chainId" })
      .then((id) => setWalletChainId(parseInt(id as string, 16)))
      .catch(() => {});
    if (!eth.on) return;
    const onAccounts = (accs: string[]) => {
      setAccount((accs[0] as Address) ?? null);
      setPhase({ kind: "idle" });
      setTryPhase({ kind: "idle" });
    };
    const onChain = (id: string) => setWalletChainId(parseInt(id, 16));
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const ensureChain = useCallback(async () => {
    const eth = window.ethereum!;
    if (!config) return;
    const hexId = `0x${config.chainId.toString(16)}`;
    const current = parseInt((await eth.request({ method: "eth_chainId" })) as string, 16);
    if (current === config.chainId) {
      setWalletChainId(current);
      return;
    }
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    } catch (e) {
      if (isUserRejection(e)) throw e;
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
    setWalletChainId(config.chainId);
  }, [config]);

  const connect = useCallback(async () => {
    if (!window.ethereum) return;
    setConnectError(null);
    setConnecting(true);
    try {
      const accs = (await window.ethereum.request({ method: "eth_requestAccounts" })) as Address[];
      setAccount(accs[0] ?? null);
      try {
        await ensureChain();
      } catch {
        // stays on the wrong network: the console shows the switch state
      }
    } catch (e) {
      setConnectError(isUserRejection(e) ? "Connection cancelled." : "Couldn't connect to your wallet.");
    } finally {
      setConnecting(false);
    }
  }, [ensureChain]);

  const switchChain = useCallback(async () => {
    setConnectError(null);
    try {
      await ensureChain();
    } catch (e) {
      setConnectError(isUserRejection(e) ? "Switch cancelled." : "Couldn't switch networks. Try from your wallet.");
    }
  }, [ensureChain]);

  // ---------------------------------------------------------------- quote

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
    if (!account) setQuote(null);
    loadQuote();
  }, [account, loadQuote]);

  // ---------------------------------------------------------------- refuel

  const refuel = useCallback(async () => {
    if (!quote || !account) return;
    const id = ++runId.current;
    const live = () => runId.current === id;
    setTryPhase({ kind: "idle" });
    try {
      await ensureChain();
      if (!live()) return;
      setPhase({ kind: "signing" });
      // fresh quote so the nonce and deadline are current
      const q = await api<QuoteResponse>(`/api/quote?owner=${account}&amount=${amount}`);
      if (!live()) return;
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
      if (!live()) return;

      setPhase({ kind: "relaying" });
      const res = await api<RefuelResponse>("/api/refuel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: account, amountIn: q.amountIn, deadline: q.permit.message.deadline, signature }),
      });
      if (res.status === "submitted" && chain) {
        await createPublicClient({ chain, transport: http() }).waitForTransactionReceipt({ hash: res.txHash });
      }
      if (!live()) return;
      setPhase({ kind: "done", res, btcOut: res.formatted?.btcOut ?? q.formatted.btcOut });
      setSuccessCount((n) => n + 1);
      loadFeed();
      loadHealth();
      await loadQuote();
    } catch (e) {
      if (!live()) return;
      if (isUserRejection(e)) {
        setPhase({ kind: "cancelled" });
        return;
      }
      const code = e instanceof ApiFail ? e.code : null;
      const message = e instanceof ApiFail ? e.message : ERRORS.CHAIN_ERROR.message;
      setPhase({ kind: "error", code, message });
      if (code === "INVALID_SIGNATURE" || code === "PERMIT_EXPIRED") loadQuote();
      if (code && BANNER_CODES.includes(code)) loadHealth();
    }
  }, [quote, account, amount, chain, ensureChain, loadFeed, loadHealth, loadQuote]);

  /** Abandon the pending signature request. Whatever the wallet returns later is ignored. */
  const cancel = useCallback(() => {
    runId.current++;
    setPhase({ kind: "idle" });
  }, []);

  const tryIt = useCallback(async () => {
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
  }, [account, config, chain, ensureChain, loadQuote]);

  const chooseAmount = useCallback((a: Amount) => {
    setAmount(a);
    setPhase((p) => (p.kind === "cancelled" || p.kind === "error" ? { kind: "idle" } : p));
  }, []);

  // ---------------------------------------------------------------- derived

  const floatBalance = health ? BigInt(health.floatBalance) : null;
  const tankFill = floatBalance === null ? 0 : Math.min(Math.max(Number(floatBalance) / Number(FLOAT_FULL), 0), 1);

  const dailyCap = config ? BigInt(config.limits.dailyBtcCap) : FLOAT_FULL;
  const dayStart = utcDayStart();
  const spentToday = events.filter((e) => e.timestamp >= dayStart).reduce((s, e) => s + BigInt(e.btcOut), 0n);
  const dailyLeftPct =
    dailyCap > 0n ? Math.max(0, Math.round((Number(dailyCap - (spentToday > dailyCap ? dailyCap : spentToday)) / Number(dailyCap)) * 100)) : null;

  const wrongChain = !!account && !!config && walletChainId !== null && walletChainId !== config.chainId;

  return {
    config,
    configError,
    health,
    healthFailed,
    stats,
    events,
    hasWallet,
    account,
    wrongChain,
    connecting,
    connectError,
    amount,
    quote,
    quoteError,
    phase,
    tryPhase,
    successCount,
    floatBalance,
    tankFill,
    dailyLeftPct,
    connect,
    switchChain,
    chooseAmount,
    refuel,
    cancel,
    tryIt,
  };
}

export type RefuelState = ReturnType<typeof useRefuel>;
