import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DISCOVERY_ALLOWLIST, stripDiscoveryRecord } from "./tool-server";

describe("discovery ingest allowlist", () => {
  it("keeps only approved company fields and strips contact-shaped fields", () => {
    const result = stripDiscoveryRecord({
      company_name: "Example",
      domain: "example.com",
      headcount: 20,
      linkedin_members: 18,
      industry: "SaaS",
      specialities: "Workflow automation",
      company_type: "Privately Held",
      hiring: "Customer Care Assistant, London, posted 2026-09-12",
      discovery_source: "linkedin_job_ads",
      location: "US",
      description: "Example company",
      funding: "Seed",
      personal_email: "founder@example.com",
      phone: "+1 555 010 1234",
      linkedin_profile: "https://linkedin.com/in/person",
    });

    assert.deepEqual(Object.keys(result), [...DISCOVERY_ALLOWLIST]);
    assert.equal("personal_email" in result, false);
    assert.equal("phone" in result, false);
    assert.equal("linkedin_profile" in result, false);
  });
});
