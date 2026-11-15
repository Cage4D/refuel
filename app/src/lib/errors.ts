import { BaseError, ContractFunctionRevertedError } from "viem";

/** User-facing error catalog (§8.3). Messages are safe to show as-is. */
export const ERRORS = {
  INVALID_INPUT: { status: 400, message: "Something's off with that request." },
  INVALID_SIGNATURE: { status: 401, message: "That signature doesn't match your wallet. Please sign again." },
  PERMIT_EXPIRED: { status: 410, message: "Your signature expired. Get a fresh quote." },
  INSUFFICIENT_MUSD: { status: 422, message: "You need at least {min} MUSD to refuel." },
  AMOUNT_OUT_OF_RANGE: { status: 422, message: "Refuel between {min} and {max} MUSD." },
  COOLDOWN: { status: 429, message: "You refueled recently. Try again {relativeTime}." },
  MAX_REFUELS: { status: 429, message: "This wallet has used all its refuels." },
  DAILY_CAP: { status: 503, message: "Today's refuel budget is used up. Try again tomorrow (UTC)." },
  FLOAT_EMPTY: { status: 503, message: "The refuel tank is empty right now." },
  ORACLE_UNAVAILABLE: { status: 503, message: "BTC price is unavailable right now. Try again shortly." },
  RELAYER_LOW: { status: 503, message: "The relayer is low on gas. Try again shortly." },
  PAUSED: { status: 503, message: "Refuel is paused." },
  RATE_LIMITED: { status: 429, message: "Slow down a little and try again in a minute." },
  CHAIN_ERROR: {
    status: 502,
    message: "The network didn't accept the transaction. Nothing was taken from your wallet.",
  },
} as const;

export type ErrorCode = keyof typeof ERRORS;

export type ErrorBody = { error: { code: ErrorCode; message: string; details?: Record<string, unknown> } };

export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    readonly vars: Record<string, string> = {},
    readonly details?: Record<string, unknown>,
  ) {
    super(fill(ERRORS[code].message, vars));
    this.status = ERRORS[code].status;
  }
  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
  }
}

function fill(template: string, vars: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}

/** Map an `eligibility()` reason code to the error catalog. */
export const ELIGIBILITY_CODES: Record<number, ErrorCode | undefined> = {
  1: "PAUSED",
  2: "COOLDOWN",
  3: "MAX_REFUELS",
  4: "FLOAT_EMPTY",
  5: "DAILY_CAP",
};

/** Contract custom error name → catalog code. */
const REVERT_CODES: Record<string, ErrorCode> = {
  AmountOutOfRange: "AMOUNT_OUT_OF_RANGE",
  TooManyRefuels: "MAX_REFUELS",
  CooldownActive: "COOLDOWN",
  PermitFailed: "INVALID_SIGNATURE",
  OracleOutOfBounds: "ORACLE_UNAVAILABLE",
  FeeTooHigh: "AMOUNT_OUT_OF_RANGE",
  ZeroOut: "AMOUNT_OUT_OF_RANGE",
  DailyCapReached: "DAILY_CAP",
  InsufficientFloat: "FLOAT_EMPTY",
  BtcTransferFailed: "CHAIN_ERROR",
  EnforcedPause: "PAUSED",
};

/** Extract the revert name and args from a viem error, if it is a decoded custom error. */
export function revertInfo(err: unknown): { name?: string; args?: readonly unknown[] } {
  if (err instanceof BaseError) {
    const r = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return { name: r.data?.errorName, args: r.data?.args };
  }
  return {};
}

export function codeForRevert(name: string | undefined): ErrorCode {
  return (name && REVERT_CODES[name]) || "CHAIN_ERROR";
}
