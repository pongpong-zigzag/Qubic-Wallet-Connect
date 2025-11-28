import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      pino: "pino/browser",
    };

    return config;
  },
  turbopack: {
    resolveAlias: {
      pino: "pino/browser",
    },
  },
};

export default nextConfig;
