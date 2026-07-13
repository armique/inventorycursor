import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: ".next-dev",
  outputFileTracingRoot: rootDir,
};

export default nextConfig;
