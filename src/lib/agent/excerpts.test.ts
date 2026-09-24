import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chunkMarkdown, discoveryEvidenceText, MAX_EXCERPTS_PER_SOURCE } from "./excerpts";

describe("deterministic excerpt chunking", () => {
  it("drops navigation, lone links and images, and keeps readable link text", () => {
    const chunks = chunkMarkdown([
      "[Home](/) | [About](/about)",
      "![logo](/logo.png)",
      "We build [workflow software](https://acme.example/product) for operations teams at mid-sized UK companies.",
      "Careers",
    ].join("\n\n"));
    assert.deepEqual(chunks, ["We build workflow software for operations teams at mid-sized UK companies."]);
  });

  it("is deterministic and bounded", () => {
    const page = Array.from({ length: 80 }, (_, index) => `Paragraph ${index} describes one part of what the company does for its customers.`).join("\n\n");
    const first = chunkMarkdown(page);
    assert.deepEqual(first, chunkMarkdown(page));
    assert.ok(first.length <= MAX_EXCERPTS_PER_SOURCE);
    assert.ok(first.every((chunk) => chunk.length <= 1_200));
  });

  it("splits one very long block at sentence boundaries", () => {
    const long = Array.from({ length: 40 }, (_, index) => `Sentence number ${index} is about the product.`).join(" ");
    const chunks = chunkMarkdown(long);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk) => /\.$/.test(chunk)));
  });
});

describe("discovery evidence", () => {
  it("is built only from allowlisted fields, so contact data cannot reach it", () => {
    const text = discoveryEvidenceText({ company_name: "Acme", domain: "acme.example", headcount: "51-200 employees", location: "London, United Kingdom", phone: "+44 20 7946 0000", personal_email: "ceo@acme.example" });
    assert.match(text, /Size band the company chose for its LinkedIn page: 51-200 employees\./);
    assert.match(text, /Headquarters: London, United Kingdom\./);
    assert.doesNotMatch(text, /7946|ceo@/);
  });

  it("states the member count as a citable number, so a size filter can be proven", () => {
    const text = discoveryEvidenceText({ company_name: "Acme", domain: "acme.example", linkedin_members: 87, specialities: "SaaS, Workflow automation", company_type: "Privately Held" });
    assert.match(text, /People on LinkedIn who list this company as their employer: 87\./);
    assert.match(text, /Specialities the company lists: SaaS, Workflow automation\./);
    assert.match(text, /Company type: Privately Held\./);
  });

  it("names job ads as the source and lists the open ads as citable evidence", () => {
    const text = discoveryEvidenceText({ company_name: "Jaded London", domain: "jadedldn.com", discovery_source: "linkedin_job_ads", hiring: "Customer Care Assistant, London, England, United Kingdom, posted 2026-09-12, https://www.linkedin.com/jobs/view/4463024223" });
    assert.match(text, /^Company record from LinkedIn job ads \(via Apify\) for Jaded London/);
    assert.match(text, /Open job ads on LinkedIn, posted in the last month: Customer Care Assistant, London/);
  });
});
