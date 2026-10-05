import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep evaluation builds from replacing files used by an active desktop server.
  distDir: process.env.SCAN_EVALUATION_BUILD === "1" ? ".next-evaluation" : ".next",
};

export default nextConfig;
