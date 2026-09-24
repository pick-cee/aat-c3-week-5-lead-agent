import { LINKEDIN_COMPANY_SIZES } from "@/lib/constants";

import { LINKEDIN_INDUSTRIES } from "./linkedin-industries";

const INDUSTRY_STOPWORDS = new Set(["that", "this", "with", "have", "from", "their", "they", "which", "entities", "industry", "includes", "include", "such", "other", "services", "service", "company", "companies", "business", "businesses", "must", "based", "core", "type", "provide", "provides", "primarily"]);

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

/** Maps a free-text headcount range onto the LinkedIn size bands it overlaps. */
export function linkedInCompanySizes(range: string): string[] {
  const text = range
    .toLowerCase()
    .replace(/(\d),(\d{3})/g, "$1$2")
    .replace(/(\d+(?:\.\d+)?)\s*k\b/g, (_, value: string) => String(Math.round(Number(value) * 1_000)));
  const numbers = [...text.matchAll(/\d+/g)].map((match) => Number(match[0]));
  let min: number;
  let max: number;
  if (numbers.length >= 2) {
    min = Math.min(numbers[0], numbers[1]);
    max = Math.max(numbers[0], numbers[1]);
  } else if (numbers.length === 1 && /(?:under|below|fewer|less|up to|at most|maximum|<)/.test(text)) {
    min = 1;
    max = numbers[0];
  } else if (numbers.length === 1 && /(?:over|above|more than|at least|minimum|\+|>)/.test(text)) {
    min = numbers[0];
    max = Number.POSITIVE_INFINITY;
  } else {
    return [];
  }
  // A band that only touches the range at one edge (11-50 for "50-500") mostly
  // holds companies outside it, and every returned company is charged.
  return LINKEDIN_COMPANY_SIZES
    .filter((band) => Math.max(min, band.min) < Math.min(max, band.max) || (min === max && band.min <= min && min <= band.max))
    .map((band) => band.label);
}
