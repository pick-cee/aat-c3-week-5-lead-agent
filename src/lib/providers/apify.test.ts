import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  affordableCompanyCount,
  affordableJobAdCount,
  companyDomain,
  discoverySignature,
  jobAdsSignature,
  linkedInCompanySizes,
  linkedInLocations,
  normalizeKeywords,
  normalizeLinkedInCompanies,
  normalizeLinkedInJobs,
  overlapsEarlierSearch,
} from "./apify";
import { clearlyAboveHeadcount, headcountBounds, headquartersOutside, industryAffinity, industryIds, suggestIndustries } from "./linkedin-filters";

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

  it("keeps the count of people listing the company, its specialities and type, which make size and category provable", () => {
    const { records } = normalizeLinkedInCompanies([
      { name: "CloudEagle.ai", website: "https://cloudeagle.ai", employeeCount: 87, employeeCountRange: { start: 51, end: 200 }, specialities: ["SaaS Management", " ", 7], companyType: "Privately Held", locations: [{ country: "US", headquarter: true }] },
      { name: "Odd", website: "https://odd.example", employeeCount: "lots" },
    ], ["United States"]);
    assert.equal(records[0].linkedin_members, 87);
    assert.equal(records[0].specialities, "SaaS Management");
    assert.equal(records[0].company_type, "Privately Held");
    assert.equal("linkedin_members" in records[1], false, "a count that is not a number is not evidence");
  });
});

describe("never buying the same results twice", () => {
  it("reads quote marks and punctuation as no keywords at all", () => {
    assert.equal(normalizeKeywords('""'), "");
    assert.equal(normalizeKeywords(' "customer  service" '), "customer service");
    assert.equal(
      discoverySignature({ keywords: '""', industryIds: ["27", "1445"], locations: ["United Kingdom"], companySizes: ["11-50"] }),
      discoverySignature({ keywords: "", industryIds: ["1445", "27"], locations: ["United Kingdom"], companySizes: ["11-50"] }),
    );
  });

  it("pages past a search that shared an industry with this one", () => {
    const first = discoverySignature({ keywords: "", industryIds: ["1445", "27"], locations: ["United Kingdom"], companySizes: ["11-50", "51-200"] });
    const widened = discoverySignature({ keywords: "", industryIds: ["19", "27", "5"], locations: ["United Kingdom"], companySizes: ["11-50", "51-200"] });
    const unrelated = discoverySignature({ keywords: "", industryIds: ["4"], locations: ["United Kingdom"], companySizes: ["11-50", "51-200"] });
    assert.equal(overlapsEarlierSearch(first, widened), true, "run 7716f37f bought the same 50 companies this way");
    assert.equal(overlapsEarlierSearch(first, unrelated), false);
    assert.equal(overlapsEarlierSearch(jobAdsSignature("customer service", "United Kingdom"), first), false);
  });

  it("caps job ads at what the remaining budget pays for", () => {
    assert.equal(affordableJobAdCount(0.6, 100), 100);
    assert.equal(affordableJobAdCount(0.03, 100), 29);
  });
});

describe("hiring-led discovery from job ads", () => {
  const ads = [
    { id: "4463024223", title: "Customer Care Assistant", companyName: "Jaded London", companyWebsite: "http://www.jadedldn.com", companyEmployeesCount: 100, companyAddress: { addressLocality: "London", addressCountry: "GB" }, industries: "Retail Apparel and Fashion", location: "London, England, United Kingdom", postedAt: "2026-09-12", companyDescription: "Fashion brand", descriptionText: "Email jane@jadedldn.com to apply", jobPosterName: "Jane Doe" },
    { id: "4463024999", title: "Customer Service Advisor", companyName: "Jaded London", companyWebsite: "https://jadedldn.com", location: "Remote, United Kingdom", postedAt: "2026-09-15" },
    { id: "1", title: "Customer Service Advisor", companyName: "Next", companyWebsite: "https://careers.next.co.uk/", companyEmployeesCount: 26701, companyAddress: { addressLocality: "Enderby", addressCountry: "GB" } },
    { id: "2", title: "Customer Experience Specialist", companyName: "Quince", companyWebsite: "https://www.quince.com", companyAddress: { addressLocality: "San Francisco", addressCountry: "US" } },
    { id: "3", title: "Support", companyName: "No Site Ltd" },
  ];

  it("keeps one company per website, its ads as evidence, and nothing from the ad text or poster", () => {
    const { records, skippedNoWebsite } = normalizeLinkedInJobs(ads, ["United Kingdom"]);
    assert.equal(skippedNoWebsite, 1);
    assert.deepEqual(records.map((record) => record.domain), ["jadedldn.com", "next.co.uk", "quince.com"], "UK headquarters first; careers subdomain resolved");
    const jaded = records[0];
    assert.equal(jaded.linkedin_members, 100);
    assert.equal(jaded.location, "London, United Kingdom");
    assert.equal(jaded.discovery_source, "linkedin_job_ads");
    assert.match(String(jaded.hiring), /Customer Care Assistant, London, England, United Kingdom, posted 2026-09-12, https:\/\/www\.linkedin\.com\/jobs\/view\/4463024223; Customer Service Advisor/);
    assert.doesNotMatch(JSON.stringify(records), /jane|Jane Doe/i);
  });

  it("researches the companies whose own industry matches the brief first", () => {
    const icp = { target_company_type: "E-commerce brands and direct-to-consumer retailers", industries: ["E-commerce", "Online retail"], hard_filters: ["Headquartered in the United Kingdom", "Hiring for customer support roles"] };
    const fashion = industryAffinity("Retail Apparel and Fashion", icp);
    assert.ok(fashion > 0);
    assert.ok(industryAffinity("Retail", icp) > 0);
    assert.equal(industryAffinity("Warehousing", icp), 0, "a 3PL from the replay");
    assert.equal(industryAffinity("Gambling Facilities and Casinos", icp), 0, "a job board from the replay");
    assert.equal(industryAffinity(undefined, icp), 0);
  });

  it("resolves a careers subdomain to the company, but not a two-part country suffix", () => {
    assert.equal(companyDomain("https://careers.next.co.uk/"), "next.co.uk");
    assert.equal(companyDomain("https://jobs.example.com/roles"), "example.com");
    assert.equal(companyDomain("https://jobs.co.uk"), "jobs.co.uk");
  });
});

describe("setting aside what the record already rules out", () => {
  it("reads the founder's headcount range", () => {
    assert.deepEqual(headcountBounds("10 to 100 employees"), { min: 10, max: 100 });
    assert.deepEqual(headcountBounds("under 50"), { min: 1, max: 50 });
    assert.equal(headcountBounds("1,000+")?.max, Number.POSITIVE_INFINITY);
    assert.equal(headcountBounds("small"), null);
  });

  it("sets aside only companies far above the ceiling, never on a low or missing count", () => {
    assert.match(String(clearlyAboveHeadcount(6083, "10 to 100")), /6,083 people on LinkedIn list this company as their employer, more than 2 times your limit of 100/);
    assert.equal(clearlyAboveHeadcount(190, "10 to 100"), null, "within twice the ceiling is researched");
    assert.equal(clearlyAboveHeadcount(3, "10 to 100"), null, "LinkedIn undercounts small companies");
    assert.equal(clearlyAboveHeadcount(undefined, "10 to 100"), null);
    assert.equal(clearlyAboveHeadcount(50_000, "1,000+"), null, "no ceiling, no size set-aside");
  });
});

describe("industry-first discovery", () => {
  it("offers the industries an agency ICP lives in", () => {
    const suggested = suggestIndustries({ target_company_type: "Digital marketing agency", industries: ["Marketing services"], hard_filters: ["Digital or marketing agency as core business type"] }, 8);
    assert.ok(suggested.includes("Marketing Services"));
    assert.ok(suggested.includes("Advertising Services"));
  });

  it("does not suggest industries from the size, place or ownership words in a SaaS brief", () => {
    const suggested = suggestIndustries({
      target_company_type: "B2B SaaS",
      industries: ["Software Development"],
      hard_filters: ["Company must be based in United States", "Employee headcount must be between 10 and 100", "Must be an independent company (not a subsidiary of a 100+ person parent company)"],
    }, 12);
    assert.equal(suggested[0], "Software Development");
    assert.equal(suggested.includes("Insurance and Employee Benefit Funds"), false);
    assert.equal(suggested.includes("Housing and Community Development"), false);
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
