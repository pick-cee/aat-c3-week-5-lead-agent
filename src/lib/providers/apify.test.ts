import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  affordableCompanyCount,
  companyDomain,
  discoverySignature,
  linkedInCompanySizes,
  linkedInLocations,
  normalizeLinkedInCompanies,
} from "./apify";
import { headquartersOutside, industryIds, suggestIndustries } from "./linkedin-filters";

describe("LinkedIn discovery filters", () => {
  it("never sends the bare text UK, which LinkedIn resolves to Ukraine", () => {
    assert.deepEqual(linkedInLocations(["UK", "London, UK", "United Kingdom (HQ)", "Global"]), ["United Kingdom", "London, United Kingdom"]);
    assert.deepEqual(linkedInLocations(["USA", "U.S."]), ["United States"]);
  });

  it("maps a headcount range onto the size bands it genuinely overlaps", () => {
    assert.deepEqual(linkedInCompanySizes("50-500 employees"), ["51-200", "201-500"]);
    assert.deepEqual(linkedInCompanySizes("10 to 100"), ["11-50", "51-200"]);
    assert.deepEqual(linkedInCompanySizes("under 50"), ["1-10", "11-50"]);
    assert.deepEqual(linkedInCompanySizes("1,000+"), ["1001-5000", "5001-10000", "10001+"]);
    assert.deepEqual(linkedInCompanySizes("not specified"), []);
  });

  it("caps the result count at what the remaining real budget can pay for", () => {
    assert.equal(affordableCompanyCount(0.5, 30), 30);
    assert.equal(affordableCompanyCount(0.021, 30), 5);
    assert.equal(affordableCompanyCount(0.004, 30), 0);
  });

  it("treats the same filters with different casing as the same search, for paging", () => {
    assert.equal(
      discoverySignature({ keywords: " SaaS ", locations: ["United Kingdom"], companySizes: ["201-500", "51-200"] }),
      discoverySignature({ keywords: "saas", locations: ["united kingdom"], companySizes: ["51-200", "201-500"] }),
    );
  });
});

describe("LinkedIn company normalisation", () => {
  it("unwraps LinkedIn redirect links and rejects social profiles as websites", () => {
    assert.equal(companyDomain("https://www.linkedin.com/redir/suspicious-page?url=salesgrowthimagination%2ecom"), "salesgrowthimagination.com");
    assert.equal(companyDomain("www.Example.co.uk/about"), "example.co.uk");
    assert.equal(companyDomain("https://facebook.com/acme"), null);
    assert.equal(companyDomain(null), null);
  });

  it("keeps only company fields, ranks headquarters matches first and counts companies with no website", () => {
    const { records, skippedNoWebsite } = normalizeLinkedInCompanies([
      { name: "Increff", website: "https://www.increff.com/", employeeCountRange: { start: 201, end: 500 }, locations: [{ country: "US", city: "Ulster Park", headquarter: true }, { country: "GB", city: "London" }], industries: [{ name: "Software Development" }], description: "Retail SaaS" },
      { name: "GarokAI", website: "https://garokai.com/", employeeCountRange: { start: 51, end: 200 }, locations: [{ country: "GB", city: "London", headquarter: true }], industries: [{ name: "IT Services" }] },
      { name: "Ketalyze", website: null },
    ], ["United Kingdom"]);
    assert.equal(skippedNoWebsite, 1);
    assert.deepEqual(records.map((record) => record.domain), ["garokai.com", "increff.com"]);
    assert.deepEqual(records[0], {
      company_name: "GarokAI",
      domain: "garokai.com",
      headcount: "51-200 employees",
      industry: "IT Services",
      location: "London, United Kingdom",
    });
  });
});

describe("industry-first discovery", () => {
  it("offers the industries an agency ICP lives in", () => {
    const suggested = suggestIndustries({ target_company_type: "Digital marketing agency", industries: ["Marketing services"], hard_filters: ["Digital or marketing agency as core business type"] }, 8);
    assert.ok(suggested.includes("Marketing Services"));
    assert.ok(suggested.includes("Advertising Services"));
  });

  it("resolves exact industry names to LinkedIn ids and reports unknown ones", () => {
    assert.deepEqual(industryIds(["Advertising Services", "marketing services", "Growth Hacking"]), { ids: ["80", "1862"], labels: ["Advertising Services", "Marketing Services"], unknown: ["Growth Hacking"] });
  });

  it("sets aside a company headquartered outside every requested location", () => {
    assert.equal(headquartersOutside("Palo Alto, California, United States", ["United Kingdom"]), true);
    assert.equal(headquartersOutside("London, England, United Kingdom", ["United Kingdom"]), false);
    assert.equal(headquartersOutside(undefined, ["United Kingdom"]), false, "unknown headquarters is researched, not guessed away");
    assert.equal(headquartersOutside("Austin, Texas, United States", []), false);
  });
});
