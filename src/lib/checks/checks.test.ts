import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkOutreachCopy } from "./copy";
import { computeListQuality } from "./list-quality";
import { checkQualification } from "./qualification";

const excerpts = [
  { id: "11111111-1111-4111-8111-111111111111", label: "E1", text: "The company serves B2B operations teams." },
  { id: "22222222-2222-4222-8222-222222222222", label: "E2", text: "The team has 42 employees in the United States." },
];

describe("qualification checks", () => {
  it("forces unknown hard filters to needs_review", () => {
    const result = checkQualification(
      {
        status: "qualified",
        confidence: 0.7,
        fit_reasons: [
          { text: "B2B company", excerpt_labels: ["E1"] },
          { text: "42 employees", excerpt_labels: ["E2"] },
        ],
        concerns: [],
        hard_filter_results: [{ criterion: "US", verdict: "unknown", excerpt_labels: [] }],
      },
      ["US"],
      excerpts,
      true,
    );
    assert.equal(result.status, "needs_review");
  });

  it("rejects unresolved citations and invented figures", () => {
    const result = checkQualification(
      {
        status: "qualified",
        confidence: 0.7,
        fit_reasons: [
          { text: "500 employees", excerpt_labels: ["E1"] },
          { text: "B2B company", excerpt_labels: ["E99"] },
        ],
        concerns: [],
        hard_filter_results: [{ criterion: "US", verdict: "pass", excerpt_labels: ["E1"] }],
      },
      ["US"],
      excerpts,
      true,
    );
    assert.equal(result.accepted, false);
    assert.match(result.errors.join(" "), /500/);
    assert.match(result.errors.join(" "), /E99/);
  });

  it("treats a pass verdict with no cited evidence as unproven", () => {
    const result = checkQualification(
      {
        status: "qualified",
        confidence: 0.7,
        fit_reasons: [{ text: "B2B company", excerpt_labels: ["E1"] }, { text: "US team", excerpt_labels: ["E2"] }],
        concerns: [],
        hard_filter_results: [{ criterion: "US", verdict: "pass", excerpt_labels: [] }],
      },
      ["US"],
      excerpts,
      true,
    );
    assert.equal(result.accepted, true);
    assert.equal(result.status, "needs_review");
    assert.match(result.downgrades.join(" "), /no cited evidence/);
  });

  it("keeps a rejection that rests on a cited failure, even with another filter unknown", () => {
    const result = checkQualification(
      {
        status: "not_qualified",
        confidence: 0.9,
        fit_reasons: [],
        concerns: [{ text: "Based in the United States", excerpt_labels: ["E2"] }],
        hard_filter_results: [
          { criterion: "UK headquarters", verdict: "fail", excerpt_labels: ["E2"] },
          { criterion: "B2B", verdict: "unknown", excerpt_labels: [] },
        ],
      },
      ["UK headquarters", "B2B"],
      excerpts,
      true,
    );
    assert.equal(result.status, "not_qualified");
  });

  it("sends an unproven rejection to review instead of silently discarding it", () => {
    const result = checkQualification(
      {
        status: "not_qualified",
        confidence: 0.6,
        fit_reasons: [],
        concerns: [{ text: "Unclear customer base", excerpt_labels: ["E1"] }],
        hard_filter_results: [{ criterion: "B2B", verdict: "unknown", excerpt_labels: [] }],
      },
      ["B2B"],
      excerpts,
      true,
    );
    assert.equal(result.status, "needs_review");
  });

  it("rejects a hard-filter citation that does not resolve", () => {
    const result = checkQualification(
      {
        status: "qualified",
        confidence: 0.7,
        fit_reasons: [{ text: "B2B company", excerpt_labels: ["E1"] }, { text: "US team", excerpt_labels: ["E2"] }],
        concerns: [],
        hard_filter_results: [{ criterion: "US", verdict: "pass", excerpt_labels: ["E42"] }],
      },
      ["US"],
      excerpts,
      true,
    );
    assert.equal(result.accepted, false);
    assert.match(result.errors.join(" "), /E42/);
  });

  it("will not qualify a company whose own website was never read", () => {
    const result = checkQualification(
      {
        status: "qualified",
        confidence: 0.7,
        fit_reasons: [{ text: "B2B company", excerpt_labels: ["E1"] }, { text: "US team", excerpt_labels: ["E2"] }],
        concerns: [],
        hard_filter_results: [{ criterion: "US", verdict: "pass", excerpt_labels: ["E2"] }],
      },
      ["US"],
      excerpts,
      false,
    );
    assert.equal(result.accepted, false);
    assert.match(result.errors.join(" "), /website/);
  });
});

describe("copy checks", () => {
  it("rejects invented headcount and strips em dashes", () => {
    const result = checkOutreachCopy(
      [
        { channel: "email", step: 1, subject: "Operations", body: "Your 500-person team—moves fast.", personalization_note: "Scale", excerpt_labels: ["E1"] },
        { channel: "email", step: 2, subject: "Workflow", body: "A short follow-up.", personalization_note: "Workflow", excerpt_labels: ["E1"] },
        { channel: "email", step: 3, subject: "Close", body: "Worth a reply?", personalization_note: "Close", excerpt_labels: ["E1"] },
        { channel: "linkedin", step: 1, body: "Open to comparing notes?", personalization_note: "B2B", excerpt_labels: ["E1"] },
      ],
      excerpts,
      ["Fixture Automation Co"],
      ["B2B"],
    );
    assert.equal(result.accepted, false);
    assert.equal(result.removedEmDashes, 1);
    assert.match(result.errors.join(" "), /500/);
  });
});

describe("list quality", () => {
  it("never passes when needs_review is counted", () => {
    const score = computeListQuality({
      targetLeads: 10,
      qualifiedCount: 10,
      totalCandidates: 10,
      uniqueDomains: 10,
      qualifiedWithCompleteEvidence: 10,
      qualifiedWithDrafts: 10,
      needsReviewCountedAsQualified: 1,
    });
    assert.equal(score.passed, false);
  });
});

describe("figures from the founder's own criteria", () => {
  it("accepts a reason that quotes the criterion's range while the evidence states the band", () => {
    const evidence = [{ id: "e1", label: "E1", text: "Company size band: 11-50 employees. Headquarters: Orlando, United States." }, { id: "e2", label: "E2", text: "We run paid search campaigns for clients." }];
    const input = {
      status: "qualified" as const,
      confidence: 0.8,
      fit_reasons: [{ text: "11-50 band sits inside the 10-50 employee requirement", excerpt_labels: ["E1"] }, { text: "Runs client campaigns", excerpt_labels: ["E2"] }],
      concerns: [],
      hard_filter_results: [{ criterion: "10-50 full-time employees", verdict: "pass" as const, excerpt_labels: ["E1"] }],
    };
    assert.equal(checkQualification(input, ["10-50 full-time employees"], evidence, true).accepted, false, "without the criteria, 10 looks invented");
    assert.equal(checkQualification(input, ["10-50 full-time employees"], evidence, true, JSON.stringify({ hard_filters: ["10-50 full-time employees"] })).accepted, true);
  });

  it("still rejects a company figure that neither the evidence nor the criteria contain", () => {
    const evidence = [{ id: "e1", label: "E1", text: "Company size band: 11-50 employees." }];
    const result = checkQualification({ status: "not_qualified", confidence: 0.9, fit_reasons: [], concerns: [{ text: "Only 7 staff listed", excerpt_labels: ["E1"] }], hard_filter_results: [{ criterion: "10-50 full-time employees", verdict: "fail", excerpt_labels: ["E1"] }] }, ["10-50 full-time employees"], evidence, true, JSON.stringify({ hard_filters: ["10-50 full-time employees"] }));
    assert.equal(result.accepted, false);
    assert.match(result.errors.join(" "), /Figure 7/);
  });
});
