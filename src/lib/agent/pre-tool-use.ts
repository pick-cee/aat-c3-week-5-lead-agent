import type {
  HookCallback,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";

import { redactForLog, safeErrorMessage } from "./redaction";
import type { ToolExecutionContext, UsageGuardRepository } from "./types";

export function createPreToolUseHook(
  context: ToolExecutionContext,
  repository: UsageGuardRepository,
): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") {
      return {};
    }

    const toolInput = input as PreToolUseHookInput;
    const startedAt = Date.now();

    try {
      const decision = await repository.reserveToolUse(context, toolInput.tool_name);

      if (decision.allowed) {
        return {};
      }

      const reason = decision.reason ?? "Run limit reached";
      await repository.logToolCall({
        ...context,
        toolName: toolInput.tool_name,
        purpose: "PreToolUse limit enforcement",
        inputSummary: redactForLog(toolInput.tool_input) as Record<string, unknown>,
        resultSummary: {
          current_value: decision.currentValue,
          limit_value: decision.limitValue,
        },
        status: "refused",
        error: reason,
        durationMs: Date.now() - startedAt,
      });

      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      };
    } catch (error) {
      const reason = "Tool call refused because usage limits could not be verified";

      try {
        await repository.logToolCall({
          ...context,
          toolName: toolInput.tool_name,
          purpose: "PreToolUse limit enforcement",
          inputSummary: redactForLog(toolInput.tool_input) as Record<string, unknown>,
          status: "refused",
          error: `${reason}: ${safeErrorMessage(error)}`,
          durationMs: Date.now() - startedAt,
        });
      } catch {
        // If the audit store is unavailable, the hook still fails closed.
      }

      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      };
    }
  };
}
