import { HEADCOUNT_SET_ASIDE_FACTOR, LINKEDIN_COMPANY_SIZES } from "@/lib/constants";

import { LINKEDIN_INDUSTRIES } from "./linkedin-industries";

// Hard filters also carry size, place and ownership words. Left in, "Employee
// headcount" suggested "Insurance and Employee Benefit Funds" and "Software
// Development" suggested "Housing and Community Development" for a SaaS brief.
const INDUSTRY_STOPWORDS = new Set([
  "that", "this", "with", "have", "from", "their", "they", "which", "entities", "industry", "includes", "include", "such", "other",
  "services", "service", "company", "companies", "business", "businesses", "must", "based", "core", "type", "provide", "provides", "primarily",
  "employee", "headcount", "between", "staff", "people", "person", "size", "fewer", "less", "more", "than", "least", "over", "under",
  "united", "state", "kingdom", "located", "headquartered", "headquarter", "country", "region",
  "independent", "subsidiary", "parent", "owned", "classified", "development", "product",
]);

// How founders describe a company versus how LinkedIn names its industry.
const INDUSTRY_SYNONYMS: Record<string, string[]> = {
  agency: ["advertising", "marketing"],
  saa: ["software"],
  cleaning: ["janitorial", "facility"],
  cleaner: ["janitorial"],
  recruitment: ["staffing"],
  recruiting: ["staffing"],
  ecommerce: ["retail", "marketplace"],
  fintech: ["financial", "software"],
  accounting: ["accounting"],
  logistics: ["freight", "transportation"],
};

function singular(word: string): string {
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ss")) return word;
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

function industryStems(text: string): Set<string> {
  const words = (text.toLowerCase().replace(/e-commerce/g, "ecommerce").match(/[a-z]+/g) ?? [])
    .map(singular)
    .filter((word) => (word.length >= 4 || word === "saa") && !INDUSTRY_STOPWORDS.has(word));
  return new Set(words.flatMap((word) => [word, ...(INDUSTRY_SYNONYMS[word] ?? [])]));
}

export const LINKEDIN_INDUSTRY_NAMES = LINKEDIN_INDUSTRIES.map(([, label]) => label);

/**
 * LinkedIn industries most likely to hold the ICP's companies, for the agent
 * to choose from. Searching by industry returned 59,592 US agencies where the
 * keyword phrase "marketing agency services" returned 8, because LinkedIn
 * keywords mostly match company names.
 */
export function suggestIndustries(input: { target_company_type?: string; industries?: string[]; hard_filters?: string[] }, limit = 20): string[] {
  const wanted = industryStems([input.target_company_type ?? "", ...(input.industries ?? []), ...(input.hard_filters ?? [])].join(" "));
  const named = new Set((input.industries ?? []).map((name) => name.trim().toLowerCase()));
  return LINKEDIN_INDUSTRIES
    .map(([, label, hierarchy, description]) => {
      const overlap = (text: string) => [...industryStems(text)].filter((stem) => wanted.has(stem)).length;
      const exact = named.has(label.toLowerCase()) ? 10 : 0;
      return { label, score: exact + overlap(label) * 4 + overlap(hierarchy) + overlap(description) * 0.5 };
    })
    .filter((item) => item.score >= 2)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.label);
}

/**
 * How well a company's own LinkedIn industry matches the criteria, for
 * research order only. A run can afford to research a fraction of what a
 * search returns, so the likeliest fits go first; nothing is skipped by it.
 */
export function industryAffinity(companyIndustry: unknown, icp: { target_company_type?: unknown; industries?: unknown; hard_filters?: unknown }): number {
  if (typeof companyIndustry !== "string" || !companyIndustry.trim()) return 0;
  const strings = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
  const criteria = { target_company_type: String(icp.target_company_type ?? ""), industries: strings(icp.industries), hard_filters: strings(icp.hard_filters) };
  const wanted = industryStems([criteria.target_company_type, ...criteria.industries, ...suggestIndustries(criteria, 8)].join(" "));
  return [...industryStems(companyIndustry)].filter((stem) => wanted.has(stem)).length * 10;
}

/** Resolves industry names to LinkedIn ids; unknown names are returned so the agent can be told. */
export function industryIds(names: string[]): { ids: string[]; labels: string[]; unknown: string[] } {
  const byLabel = new Map(LINKEDIN_INDUSTRIES.map(([id, label]) => [label.toLowerCase(), { id, label }]));
  const ids: string[] = [];
  const labels: string[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const hit = byLabel.get(name.trim().toLowerCase());
    if (hit && !ids.includes(hit.id)) { ids.push(hit.id); labels.push(hit.label); }
    else if (!hit) unknown.push(name);
  }
  return { ids, labels, unknown };
}

/**
 * LinkedIn's location filter matches any office, so a US company with a
 * London office comes back for "United Kingdom". When the headquarters is
 * known and sits in none of the requested places, researching it would cost a
 * full AI step to reject what the discovery record already shows.
 */
export function headquartersOutside(location: string | undefined, locations: string[]): boolean {
  if (!location || locations.length === 0) return false;
  const hq = location.toLowerCase();
  return !locations.some((wanted) => {
    const parts = wanted.toLowerCase().split(",").map((part) => part.trim()).filter(Boolean);
    return parts.some((part) => hq.includes(part));
  });
}

// Pure helpers, shared by the discovery handler and the approval screen so the
// founder sees exactly the filters the paid search will use.

const LOCATION_ALIASES: Array<[RegExp, string]> = [
  // LinkedIn resolves the bare text "UK" to Ukraine.
  [/\b(?:U\.?K\.?|Great Britain|Britain)(?=$|[\s,;)])/gi, "United Kingdom"],
  [/\b(?:U\.?S\.?A?\.?|United States of America|America)(?=$|[\s,;)])/gi, "United States"],
  [/\bUAE\b/gi, "United Arab Emirates"],
];

const VAGUE_LOCATION = /^(?:global|worldwide|anywhere|any|international|remote|n\/?a|none|not specified|unspecified)$/i;

export function linkedInLocations(geography: string[]): string[] {
  const cleaned = geography
    .map((value) => value.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim())
    .filter((value) => value && !VAGUE_LOCATION.test(value))
    .map((value) => LOCATION_ALIASES.reduce((text, [pattern, name]) => text.replace(pattern, name), value));
  return [...new Set(cleaned)].slice(0, 10);
}

/** Reads a free-text headcount range ("10 to 100", "under 50", "1,000+"). */
export function headcountBounds(range: string): { min: number; max: number } | null {
  const text = range
    .toLowerCase()
    .replace(/(\d),(\d{3})/g, "$1$2")
    .replace(/(\d+(?:\.\d+)?)\s*k\b/g, (_, value: string) => String(Math.round(Number(value) * 1_000)));
  const numbers = [...text.matchAll(/\d+/g)].map((match) => Number(match[0]));
  if (numbers.length >= 2) return { min: Math.min(numbers[0], numbers[1]), max: Math.max(numbers[0], numbers[1]) };
  if (numbers.length === 1 && /(?:under|below|fewer|less|up to|at most|maximum|<)/.test(text)) return { min: 1, max: numbers[0] };
  if (numbers.length === 1 && /(?:over|above|more than|at least|minimum|\+|>)/.test(text)) return { min: numbers[0], max: Number.POSITIVE_INFINITY };
  return null;
}

/** Maps a free-text headcount range onto the LinkedIn size bands it overlaps. */
export function linkedInCompanySizes(range: string): string[] {
  const bounds = headcountBounds(range);
  if (!bounds) return [];
  const { min, max } = bounds;
  // A band that only touches the range at one edge (11-50 for "50-500") mostly
  // holds companies outside it, and every returned company is charged.
  return LINKEDIN_COMPANY_SIZES
    .filter((band) => Math.max(min, band.min) < Math.min(max, band.max) || (min === max && band.min <= min && min <= band.max))
    .map((band) => band.label);
}

/**
 * The size reason for setting a company aside before research, or null. Only
 * the ceiling is used: LinkedIn undercounts small companies, so a low count is
 * no evidence of being too small, but thousands of people listing a company as
 * their employer is strong evidence against "10 to 100 employees".
 */
export function clearlyAboveHeadcount(members: unknown, range: string): string | null {
  const bounds = headcountBounds(range);
  if (typeof members !== "number" || !Number.isFinite(members) || !bounds || !Number.isFinite(bounds.max)) return null;
  if (members <= bounds.max * HEADCOUNT_SET_ASIDE_FACTOR) return null;
  return `${members.toLocaleString("en-US")} people on LinkedIn list this company as their employer, more than ${HEADCOUNT_SET_ASIDE_FACTOR} times your limit of ${bounds.max.toLocaleString("en-US")}. Set aside without spending research on it.`;
}

/**
 * Search words as the agent should have written them. An agent once passed
 * the two characters `""` as keywords: it read as a new search, restarted at
 * page one, and bought the same 50 companies again.
 */
export function normalizeKeywords(value: string): string {
  return value
    .replace(/["'`“”‘’]/g, "")
    .replace(/[^\p{L}\p{N}\s&+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
