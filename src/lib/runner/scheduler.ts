import { MAIN_SERVER_SCHEDULER_INTERVAL_SECONDS } from "@/lib/constants";

import { safeErrorMessage } from "../agent/redaction";
import { advanceRun } from "./advance-run";
import { agentExecutable } from "./agent-runtime";

declare global {
  var __koyaMainServerSchedulerStarted: boolean | undefined;
}

export function startMainServerScheduler(): void {
  if (globalThis.__koyaMainServerSchedulerStarted || process.env.NODE_ENV === "test" || process.env.KOYA_DISABLE_MAIN_SERVER_SCHEDULER === "1") return;
  // On Vercel every function starts this, including page functions that do
  // not carry the agent's program; one of them claimed a run and failed it.
  if (!agentExecutable()) return;
  globalThis.__koyaMainServerSchedulerStarted = true;

  const tick = async () => {
    try {
      await advanceRun({});
    } catch (error) {
      console.error("Koya scheduler step failed safely:", safeErrorMessage(error));
    } finally {
      const timer = setTimeout(tick, MAIN_SERVER_SCHEDULER_INTERVAL_SECONDS * 1_000);
      timer.unref();
    }
  };

  const timer = setTimeout(tick, MAIN_SERVER_SCHEDULER_INTERVAL_SECONDS * 1_000);
  timer.unref();
}
