import "server-only";

/**
 * In-memory token bucket. Serverless instances are ephemeral and not shared, so this is a
 * best-effort speed bump; the on-chain cooldown and caps are the real limits.
 */
export class TokenBucket {
  private buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
  ) {}

  take(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.capacity, updated: now };
    b.tokens = Math.min(this.capacity, b.tokens + (now - b.updated) * this.refillPerMs);
    b.updated = now;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.sweep(now);
    return ok;
  }

  private sweep(now: number) {
    for (const [k, b] of this.buckets) {
      if (b.tokens + (now - b.updated) * this.refillPerMs >= this.capacity) this.buckets.delete(k);
    }
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** 5 requests / minute per IP. */
export const ipLimiter = new TokenBucket(5, 5 / MINUTE);
/** 3 requests / hour per owner. */
export const ownerLimiter = new TokenBucket(3, 3 / HOUR);
/** Looser limit for read endpoints (quote). */
export const readLimiter = new TokenBucket(60, 60 / MINUTE);

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
