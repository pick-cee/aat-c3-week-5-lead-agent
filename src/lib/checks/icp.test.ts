import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assumptionTargets, checkRefinedIcp, guessAssumptionTargets, sanitizeAssumptionLinks, type RefinedIcp } from "./icp";

const base = { target_company_type: "B2B SaaS", industries: ["Software"], geography: ["UK"], headcount_range: "50-500", buyer_persona: "Founder", business_problem: "Hiring", hard_filters: ["UK"], soft_preferences: [], disqualifiers: [], assumptions: [] };

describe("ICP structural checks", () => {
  it("requires a visible assumption when geography is absent", () => assert.match(checkRefinedIcp({ ...base, geography: [] }).join(" "), /geography/));
  it("blocks personal-data hard filters that discovery cannot safely express", () => assert.match(checkRefinedIcp({ ...base, hard_filters: ["founder's personal email is known"] }).join(" "), /cannot be discovered safely/));
});

// The criteria and assumptions from a real refined run (US marketing agencies).
const agencies: RefinedIcp = {
  target_company_type: "Digital marketing agency", industries: ["Marketing services"], geography: ["United States"],
  headcount_range: "10-50 employees", buyer_persona: "Agency owner", business_problem: "Manual campaign execution",
  hard_filters: ["United States-based (company headquarters or primary operations)", "Digital or marketing agency as core business type (not in-house marketing department of another industry)", "10-50 full-time employees", "Manages active client campaigns (campaign execution is part of core service offering)"],
  soft_preferences: ["Explicitly mentions manual processes, workflow inefficiencies, or scaling challenges in public materials"],
  disqualifiers: ["Located outside United States", "General management or strategy consulting (not campaign execution)"],
  assumptions: [
    "The US market has sufficient density of qualifying 10-50 person marketing agencies",
    "These agencies do hands-on campaign execution and management (not pure strategy consulting)",
    "Target agencies have budget allocated for new tools or SaaS solutions",
  ],
};

describe("assumption links", () => {
  it("guesses the criteria an assumption is about for runs refined before links existed", () => {
    const size = guessAssumptionTargets(agencies, agencies.assumptions[0]);
    assert.ok(size.some((target) => target.kind === "criterion" && target.text === "10-50 full-time employees"));
    const execution = guessAssumptionTargets(agencies, agencies.assumptions[1]);
    assert.ok(execution.some((target) => target.kind === "criterion" && target.list === "disqualifiers" && target.text.startsWith("General management")));
  });

  it("does not invent a link for an assumption no criterion covers", () => {
    assert.deepEqual(guessAssumptionTargets(agencies, agencies.assumptions[2]), []);
  });

  it("prefers recorded links and drops any that do not resolve", () => {
    const icp: RefinedIcp = { ...agencies, assumption_links: [
      { assumption: agencies.assumptions[2], related: ["headcount_range", "A criterion that does not exist"] },
      { assumption: "An assumption that was removed", related: ["geography"] },
    ] };
    assert.deepEqual(sanitizeAssumptionLinks(icp), [{ assumption: agencies.assumptions[2], related: ["headcount_range"] }]);
    assert.deepEqual(assumptionTargets(icp, agencies.assumptions[2]), [{ kind: "field", field: "headcount_range" }]);
  });

  it("follows a criterion into another list by its text", () => {
    const moved: RefinedIcp = { ...agencies, hard_filters: agencies.hard_filters.slice(1), soft_preferences: [...agencies.soft_preferences, agencies.hard_filters[0]], assumption_links: [{ assumption: agencies.assumptions[0], related: [agencies.hard_filters[0]] }] };
    assert.deepEqual(assumptionTargets(moved, agencies.assumptions[0]), [{ kind: "criterion", list: "soft_preferences", text: agencies.hard_filters[0] }]);
  });
});
