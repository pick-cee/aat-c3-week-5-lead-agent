import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { requireServerEnv } from "@/lib/server/env";

export type AgentRuntime = { cwd: string; configDir: string };

let prepared: AgentRuntime | undefined;

/**
 * The lead agent runs in a folder that holds only its five skills, with an
 * empty Claude config of its own. Run from the repository with the host's
 * config, every stage received AGENTS.md (the coding agent's instructions),
 * the developer's session memory and email address, their claude.ai
 * connectors and unrelated skills (measured 2026-09-24). None of that is the
 * lead agent's business, and all of it was paid for as context on every call.
 *
 * .claude/skills in the repository stays the only source: the folder is
 * rebuilt from it once per process.
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
  // Per process, so two servers never rebuild the same folder under each other.
  const root = path.join(os.tmpdir(), `koya-lead-agent-${process.pid}`);
  const cwd = path.join(root, "workspace");
  const configDir = path.join(root, "config");
  rmSync(root, { recursive: true, force: true });
  mkdirSync(path.join(cwd, ".claude"), { recursive: true });
  mkdirSync(configDir, { recursive: true });
  cpSync(path.join(process.cwd(), ".claude", "skills"), path.join(cwd, ".claude", "skills"), { recursive: true });
  writeFileSync(path.join(configDir, ".claude.json"), JSON.stringify({
    hasCompletedOnboarding: true,
    customApiKeyResponses: { approved: [apiKey.slice(-20)], rejected: [] },
  }), { mode: 0o600 });
  prepared = { cwd, configDir };
  return prepared;
}
