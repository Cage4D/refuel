import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { env } from "./env";
import { ApiError } from "./errors";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env().ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

/** JSON response with CORS. BigInts are serialised as decimal strings. */
export function json(data: unknown, status = 200) {
  const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders() },
  });
}

export function options() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export function errorResponse(e: unknown) {
  if (e instanceof ApiError) return json(e.toBody(), e.status);
  if (e instanceof ZodError) {
    const err = new ApiError("INVALID_INPUT", {}, { issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    return json(err.toBody(), err.status);
  }
  console.error("[api] unexpected error:", e instanceof Error ? e.message : e);
  return json(new ApiError("CHAIN_ERROR").toBody(), 502);
}

/** Wrap a route handler with uniform error handling. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
