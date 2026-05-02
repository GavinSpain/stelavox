import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server components can import from these packages
  serverExternalPackages: ["@anthropic-ai/sdk"],
};

export default nextConfig;
