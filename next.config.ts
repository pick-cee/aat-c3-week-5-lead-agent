import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // The lead agent's skills are read from disk at run time (agent-runtime.ts),
  // so nothing imports them and the build would otherwise leave them out.
  outputFileTracingIncludes: {
    "/**": ["./.claude/skills/**/*"],
  },
};

export default nextConfig;
