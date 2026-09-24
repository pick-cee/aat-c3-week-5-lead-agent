"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const STEP_DELAY_MS = 1_500;

/**
 * Keeps an open run moving by asking the server for one bounded step at a
 * time, from whichever browser or device has the run open. Two open tabs are
 * safe: the lease lets one step run and the other request no-ops.
 *
 * The loop schedules itself. An earlier version relied on the effect re-running
 * after router.refresh(), but refresh does not change these props, so it
 * advanced exactly one step per page load and then went quiet.
 */
export function AutoRefresh({ active, runId }: { active: boolean; runId: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      if (cancelled) return;
      try {
        await fetch(`/api/runs/${runId}/advance`, { method: "POST" });
      } catch {
        // A dropped request is retried on the next tick; the server keeps state.
      }
      if (cancelled) return;
      router.refresh();
      timer = window.setTimeout(tick, STEP_DELAY_MS);
    };
    timer = window.setTimeout(tick, STEP_DELAY_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [active, runId, router]);
  return null;
}
