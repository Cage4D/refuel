import { formatUnits } from "viem";

/** Truncate a decimal string to `dp` places (no rounding up), dropping trailing zeros. */
function trim(s: string, dp: number) {
  const [i, f = ""] = s.split(".");
  const frac = f.slice(0, dp).replace(/0+$/, "");
  return frac ? `${i}.${frac}` : i;
}

export const formatBtc = (wei: bigint) => `${trim(formatUnits(wei, 18), 8)} BTC`;
export const formatMusd = (wei: bigint) => `${trim(formatUnits(wei, 18), 4)} MUSD`;
export function formatUsd(wei: bigint) {
  const n = Number(formatUnits(wei, 18));
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export const priceDecimal = (wei: bigint) => trim(formatUnits(wei, 18), 2);
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function relativeTime(unixSeconds: number, now = Date.now() / 1000) {
  const s = Math.max(0, Math.round(unixSeconds - now));
  if (s < 60) return `in ${s}s`;
  const mins = Math.ceil(s / 60);
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

/** Past-tense relative time for feed rows ("4 min ago"). */
export function timeAgo(unixSeconds: number, now = Date.now() / 1000) {
  const s = Math.max(0, Math.round(now - unixSeconds));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Decimal string of a wei amount, truncated to `dp` places, trailing zeros dropped. */
export const weiDecimal = (wei: bigint, dp: number) => trim(formatUnits(wei, 18), dp);

/** "3.3 million" style count for the transactions estimate. */
export const compactCount = (n: bigint) =>
  new Intl.NumberFormat("en-US", { notation: "compact", compactDisplay: "long", maximumFractionDigits: 1 }).format(
    Number(n),
  );
