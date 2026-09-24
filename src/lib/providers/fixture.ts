import type { CompanyDiscoveryProvider, SiteScraper } from "./types";

export const fixtureDiscoveryProvider: CompanyDiscoveryProvider = {
  async search({ limit }) {
    return {
      records: [
        {
          company_name: "Fixture Automation Co",
          company_domain: "fixture.example",
          headcount: "11-50 employees",
          industry: "B2B SaaS",
          location: "Austin, Texas, United States",
          description: "Workflow software for operations teams.",
          funding: "Seed",
          personal_email: "founder@fixture.example",
          phone: "+1 555 010 9999",
        },
      ].slice(0, limit),
      costUsd: 0,
      costComplete: true,
      returnedCount: 1,
      skippedNoWebsite: 0,
      totalAvailable: 1,
      startPage: 1,
    };
  },
};

export const fixtureSiteScraper: SiteScraper = {
  async scrape(url) {
    return {
      url,
      markdown: "# Fixture Automation Co\n\nWe build workflow software for operations teams at a 42-person B2B company in the United States.",
      fetchStatus: "ok",
      httpStatus: 200,
      fromCache: false,
    };
  },
};
