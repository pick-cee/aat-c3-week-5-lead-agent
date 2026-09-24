import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { draftingCost, draftingTopUp, leadsAwaitingDrafts } from "./drafting-budget";

describe("drafting is always paid for", () => {
  it("adds only the shortfall, rounded up to the cent", () => {
    assert.equal(draftingCost(6), 0.72);
    assert.equal(draftingTopUp(5, 5.003345, 6), 0.73, "the run that finished with six leads and no drafts");
    assert.equal(draftingTopUp(3, 2.5, 2), 0, "enough left: nothing is added");
    assert.equal(draftingTopUp(3, 3, 0), 0);
  });

  it("counts qualified leads still missing drafts, not ones that used up their attempts", () => {
    const qualified = { qualification: { status: "qualified" } };
    assert.equal(leadsAwaitingDrafts([
      { ...qualified, draft_attempts: 0, drafts: [] },
      { ...qualified, draft_attempts: 3, drafts: [] },
      { ...qualified, draft_attempts: 1, drafts: [1, 2, 3, 4] },
      { qualification: { status: "needs_review" }, draft_attempts: 0, drafts: [] },
    ]), 1);
  });
});
