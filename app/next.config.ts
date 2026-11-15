import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Load the repo-root .env so contracts/, scripts/ and app/ share one env file.
// forceReload: Next has already loaded (and cached) app/.env by the time this runs.
loadEnvConfig(path.resolve(__dirname, ".."), process.env.NODE_ENV !== "production", undefined, true);

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, ".."),
};

export default nextConfig;
