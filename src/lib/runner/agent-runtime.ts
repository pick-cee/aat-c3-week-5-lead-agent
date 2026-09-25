import { accessSync, chmodSync, constants as fsConstants, copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { requireServerEnv } from "@/lib/server/env";

export type AgentRuntime = { cwd: string; configDir: string; home: string; executable: string };

let prepared: AgentRuntime | undefined;

/**
 * The Claude Code program the Agent SDK runs, for this machine. It ships as a
 * platform package of about 237 MB, found by name at run time, so the build
 * cannot see it being used: the first Vercel deployment left it out and every
 * stage failed with "Native CLI binary for linux-x64 not found". next.config.ts
 * includes it in the routes that run the agent, and this resolves it there.
 * Null where it is absent, so a server without it never claims a run.
 */
export function agentExecutable(): string | null {
  const binary = process.platform === "win32" ? "claude.exe" : "claude";
  // Joined at run time so the build's file tracer cannot follow it. When it
  // could, it copied the program into instrumentation, which Vercel bundles
  // into every function; only the two include rules in next.config.ts decide.
  const packages = [process.cwd(), "node_modules", SDK_SCOPE].join(path.sep);
  const candidates = [`${process.platform}-${process.arch}`, `${process.platform}-${process.arch}-musl`]
    .map((target) => [packages, `${PLATFORM_PACKAGE}${target}`, binary].join(path.sep));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const SDK_SCOPE = ["@anthropic", "ai"].join("-");
const PLATFORM_PACKAGE = ["claude", "agent", "sdk", ""].join("-");

/**
 * A deployment may not keep the program's executable bit. Vercel's disk is
 * read-only outside /tmp, so a copy there is made executable instead.
 */
function runnable(executable: string, root: string): string {
  if (process.platform === "win32") return executable;
  try {
    accessSync(executable, fsConstants.X_OK);
    return executable;
  } catch {
    const copy = path.join(root, "claude");
    copyFileSync(executable, copy);
    chmodSync(copy, 0o755);
    return copy;
  }
}

/**
 * The lead agent runs in a folder that holds only its five skills, with an
 * empty Claude config of its own. Run from the repository with the host's
 * config, every stage received AGENTS.md (the coding agent's instructions),
 * the developer's session memory and email address, their claude.ai
 * connectors and unrelated skills (measured 2026-09-24). None of that is the
 * lead agent's business, and all of it was paid for as context on every call.
 *
 * .claude/skills in the repository stays the only source: the folder is
 * rebuilt from it once per process. Everything lives under the temp folder,
 * the only writable place on Vercel, including the program's home.
 *
 * Claude Code does not use ANTHROPIC_API_KEY from the environment until the
 * key is approved in its config; without the host's login it reported "Not
 * logged in". Locally, stages had been running on the developer's personal
 * Claude login instead of the project key. The approval stores the key's last
 * 20 characters, which is what Claude Code itself records.
 */
export function agentRuntime(): AgentRuntime {
  if (prepared) return prepared;
  const apiKey = requireServerEnv("ANTHROPIC_API_KEY");
  const found = agentExecutable();
  if (!found) {
    throw new Error(`This server has no Claude Code program for ${process.platform}-${process.arch}; the routes that run the agent must include it (next.config.ts)`);
  }
  // Per process, so two servers never rebuild the same folder under each other.
  const root = path.join(os.tmpdir(), `koya-lead-agent-${process.pid}`);
  const cwd = path.join(root, "workspace");
  const configDir = path.join(root, "config");
  const home = path.join(root, "home");
  rmSync(root, { recursive: true, force: true });
  mkdirSync(path.join(cwd, ".claude"), { recursive: true });
  mkdirSync(configDir, { recursive: true });
  mkdirSync(home, { recursive: true });
  cpSync(path.join(process.cwd(), ".claude", "skills"), path.join(cwd, ".claude", "skills"), { recursive: true });
  writeFileSync(path.join(configDir, ".claude.json"), JSON.stringify({
    hasCompletedOnboarding: true,
    customApiKeyResponses: { approved: [apiKey.slice(-20)], rejected: [] },
  }), { mode: 0o600 });
  prepared = { cwd, configDir, home, executable: runnable(found, root) };
  return prepared;
}
