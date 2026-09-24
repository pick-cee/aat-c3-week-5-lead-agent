import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchesFilter, needsYou } from "./run-filters";
import type { RunSummary } from "@/lib/runs/dashboard";

const run = (status: string, needs_review_count = 0) => ({ status, needs_review_count }) as RunSummary;

describe("Needs you", () => {
  it("lists what is waiting on the founder", () => {
    for (const status of ["awaiting_icp_confirmation", "awaiting_budget", "failed", "budget_exceeded"]) {
      assert.equal(needsYou(run(status)), true, status);
    }
    assert.equal(needsYou(run("short_of_target", 2)), true);
    assert.equal(needsYou(run("complete", 1)), true);
  });

  it("never lists a run the founder stopped, even with leads left to review", () => {
    assert.equal(needsYou(run("cancelled", 6)), false);
    assert.equal(matchesFilter(run("cancelled", 6), "stopped"), true, "it stays findable under Stopped");
  });

  it("does not interrupt a run that is still working", () => {
    assert.equal(needsYou(run("researching", 3)), false);
    assert.equal(needsYou(run("complete", 0)), false);
  });
});
