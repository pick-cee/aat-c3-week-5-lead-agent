import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPreToolUseHook } from "./pre-tool-use";
import type {
  ReservationDecision,
  ToolCallLog,
  ToolExecutionContext,
  UsageGuardRepository,
} from "./types";

const context: ToolExecutionContext = {
  runId: "00000000-0000-4000-8000-000000000001",
  candidateId: "00000000-0000-4000-8000-000000000002",
  stage: "qualify_one",
};

const input: PreToolUseHookInput = {
  hook_event_name: "PreToolUse",
  session_id: "session-1",
  transcript_path: "transcript.jsonl",
  cwd: ".",
  tool_name: "mcp__lead_agent__scrape_site",
  tool_input: { url: "https://example.com", requested_limit: 500 },
  tool_use_id: "tool-use-1",
};

describe("createPreToolUseHook", () => {
  it("refuses an over-limit call and writes a refused audit row", async () => {
    const calls: ToolCallLog[] = [];
    const repository: UsageGuardRepository = {
      async reserveToolUse(): Promise<ReservationDecision> {
        return {
        allowed: false,
        reason: "Maximum scrape count for candidate reached",
        currentValue: 3,
        limitValue: 3,
        };
      },
      async logToolCall(call): Promise<void> {
        calls.push(call);
      },
    };
    const hook = createPreToolUseHook(context, repository);

    const result = await hook(input, input.tool_use_id, {
      signal: new AbortController().signal,
    });

    assert.deepEqual(result, {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Maximum scrape count for candidate reached",
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.runId, context.runId);
    assert.equal(calls[0]?.candidateId, context.candidateId);
    assert.equal(calls[0]?.toolName, input.tool_name);
    assert.equal(calls[0]?.status, "refused");
    assert.equal(calls[0]?.error, "Maximum scrape count for candidate reached");
  });

  it("allows a reserved call without writing a refusal", async () => {
    const calls: ToolCallLog[] = [];
    const repository: UsageGuardRepository = {
      async reserveToolUse(): Promise<ReservationDecision> {
        return { allowed: true, currentValue: 1, limitValue: 3 };
      },
      async logToolCall(call): Promise<void> {
        calls.push(call);
      },
    };
    const hook = createPreToolUseHook(context, repository);

    const result = await hook(input, input.tool_use_id, {
      signal: new AbortController().signal,
    });

    assert.deepEqual(result, {});
    assert.equal(calls.length, 0);
  });

  it("fails closed when the counter cannot be read", async () => {
    const calls: ToolCallLog[] = [];
    const repository: UsageGuardRepository = {
      async reserveToolUse(): Promise<ReservationDecision> {
        throw new Error("database unavailable");
      },
      async logToolCall(call): Promise<void> {
        calls.push(call);
      },
    };
    const hook = createPreToolUseHook(context, repository);

    const result = await hook(input, input.tool_use_id, {
      signal: new AbortController().signal,
    });

    assert.deepEqual(result, {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "Tool call refused because usage limits could not be verified",
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.status, "refused");
  });
});
