import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // Read from disk at run time (agent-runtime.ts), so nothing imports them and
  // the build would otherwise leave them out. The skills are small and go
  // everywhere. The Claude Code program is about 237 MB against Vercel's
  // 250 MB function limit, so it goes only into the two routes that run the
  // agent (about 7 MB without it); the first deployment had it nowhere.
  outputFileTracingIncludes: {
    "/**": ["./.claude/skills/**/*"],
    "/api/runner": ["./node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**/*"],
    "/api/runs/\\[id\\]/advance": ["./node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**/*"],
  },
};

export default nextConfig;
