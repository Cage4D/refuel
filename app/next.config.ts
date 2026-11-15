import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Load the repo-root .env so contracts/, scripts/ and app/ share one env file.
loadEnvConfig(path.resolve(__dirname, ".."));

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, ".."),
};

export default nextConfig;
