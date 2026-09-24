export type AssumptionLink = { assumption: string; related: string[] };

export type RefinedIcp = {
  target_company_type: string;
  industries: string[];
  geography: string[];
  headcount_range: string;
  buyer_persona: string;
  business_problem: string;
  hard_filters: string[];
  soft_preferences: string[];
  disqualifiers: string[];
  assumptions: string[];
  assumption_links?: AssumptionLink[];
};

export const ICP_FIELDS = ["target_company_type", "industries", "geography", "headcount_range", "buyer_persona", "business_problem"] as const;
export type IcpField = (typeof ICP_FIELDS)[number];
export const CRITERION_LISTS = ["hard_filters", "soft_preferences", "disqualifiers"] as const;
export type CriterionList = (typeof CRITERION_LISTS)[number];

export type AssumptionTarget =
  | { kind: "criterion"; list: CriterionList; text: string }
  | { kind: "field"; field: IcpField };

const UNDISCOVERABLE_PERSONAL_FILTER = /(?:personal\s+email|phone\s+number|named\s+(?:person|founder)|founder'?s?\s+(?:age|gender|ethnicity|favorite|preference)|private\s+contact)/i;

export function checkRefinedIcp(icp: RefinedIcp): string[] {
  const errors: string[] = [];
  const assumptions = icp.assumptions.join(" ").toLowerCase();
  if (icp.hard_filters.length === 0) errors.push("At least one hard filter is required");
  if (icp.geography.length === 0 && !assumptions.includes("geograph")) errors.push("Missing geography must be stated as an assumption");
  if (!icp.headcount_range.trim() && !/(?:headcount|company size)/i.test(assumptions)) errors.push("Missing company size must be stated as an assumption");
  if (!icp.target_company_type.trim() && !assumptions.includes("company type")) errors.push("Missing company type must be stated as an assumption");
  for (const filter of icp.hard_filters) {
    if (UNDISCOVERABLE_PERSONAL_FILTER.test(filter)) errors.push(`Hard filter cannot be discovered safely: ${filter}`);
  }
  return errors;
}

const squash = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/** A link target is a field name or the text of a criterion in any list. */
export function resolveAssumptionTarget(icp: RefinedIcp, reference: string): AssumptionTarget | null {
  if ((ICP_FIELDS as readonly string[]).includes(reference)) return { kind: "field", field: reference as IcpField };
  const wanted = squash(reference);
  for (const list of CRITERION_LISTS) {
    const text = icp[list].find((item) => squash(item) === wanted);
    if (text) return { kind: "criterion", list, text };
  }
  return null;
}

/**
 * Keeps only links the founder can follow: the assumption must exist and every
 * target must resolve. A link to a criterion that is not there would send the
 * founder hunting, which is the thing links exist to prevent.
 */
export function sanitizeAssumptionLinks(icp: RefinedIcp): AssumptionLink[] {
  const present = new Set(icp.assumptions);
  return (icp.assumption_links ?? [])
    .filter((link) => present.has(link.assumption))
    .map((link) => ({
      assumption: link.assumption,
      related: [...new Set(link.related
        .map((reference) => resolveAssumptionTarget(icp, reference))
        .filter((target): target is AssumptionTarget => target !== null)
        .map((target) => (target.kind === "field" ? target.field : target.text)))],
    }));
}

const STOPWORDS = new Set(["that", "this", "with", "have", "from", "their", "they", "these", "those", "which", "will", "would", "about", "into", "than", "then", "there", "where", "company", "companies", "business", "must", "should", "based", "more", "less", "only", "also", "because", "being", "such", "other"]);

function stems(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z]+|\d+(?:[-–]\d+)?/g) ?? [];
  return new Set(words
    .filter((word) => /\d/.test(word) || (word.length >= 4 && !STOPWORDS.has(word)))
    .map((word) => (/\d/.test(word) ? word.replace("–", "-") : word.replace(/(?:ies|es|s)$/, "").slice(0, 5))));
}

const FIELD_TEXT: Record<IcpField, (icp: RefinedIcp) => string> = {
  target_company_type: (icp) => icp.target_company_type,
  industries: (icp) => icp.industries.join(" "),
  geography: (icp) => icp.geography.join(" "),
  headcount_range: (icp) => `${icp.headcount_range} employees headcount size`,
  buyer_persona: (icp) => icp.buyer_persona,
  business_problem: (icp) => icp.business_problem,
};

// An assumption that names what it is about ("Geography is...", "Headcount
// of...") belongs to that field more surely than to any word overlap.
const FIELD_HINTS: Record<IcpField, RegExp> = {
  geography: /\b(?:geograph\w*|locations?|located|countr(?:y|ies)|regions?|headquarter\w*)\b/i,
  headcount_range: /\b(?:headcount|employees?|staff|team size|company size)\b|\d+\s*\+?\s*(?:people|persons?)\b/i,
  buyer_persona: /\b(?:buyer|persona|decision[- ]?makers?)\b/i,
  business_problem: /\b(?:business problem|pain points?|problem)\b/i,
  target_company_type: /\b(?:company type|business model|kind of company)\b/i,
  industries: /\b(?:industr(?:y|ies)|sectors?|verticals?)\b/i,
};

/** Fallback for runs refined before links existed: named fields, then shared words. */
export function guessAssumptionTargets(icp: RefinedIcp, assumption: string, limit = 2): AssumptionTarget[] {
  const wanted = stems(assumption);
  const candidates: Array<{ target: AssumptionTarget; text: string; hinted: boolean }> = [
    ...CRITERION_LISTS.flatMap((list) => icp[list].map((text) => ({ target: { kind: "criterion" as const, list, text }, text, hinted: false }))),
    ...ICP_FIELDS.map((field) => ({ target: { kind: "field" as const, field }, text: FIELD_TEXT[field](icp), hinted: FIELD_HINTS[field].test(assumption) })),
  ];
  const scored = candidates
    .map((candidate) => {
      const shared = [...stems(candidate.text)].filter((stem) => wanted.has(stem));
      const numeric = shared.some((stem) => /\d/.test(stem));
      // A shared figure ("10-50") is the most specific overlap there is.
      const score = shared.length + (numeric ? 2 : 0) + (candidate.hinted ? 3 : 0);
      return { ...candidate, score, strong: candidate.hinted || numeric || shared.length >= 2 };
    })
    .filter((candidate) => candidate.strong);
  // A field matched only by overlapping words is too broad to be useful when a
  // specific criterion or a named field matched as well.
  const specific = scored.filter((candidate) => candidate.target.kind === "criterion" || candidate.hinted);
  return (specific.length ? specific : scored)
    .sort((left, right) => right.score - left.score || (left.target.kind === "criterion" ? -1 : 1))
    .slice(0, limit)
    .map((candidate) => candidate.target);
}

/** Recorded links when the refinement produced them, otherwise a guess. */
export function assumptionTargets(icp: RefinedIcp, assumption: string): AssumptionTarget[] {
  if (Array.isArray(icp.assumption_links)) {
    const link = icp.assumption_links.find((item) => item.assumption === assumption);
    if (link) {
      return link.related
        .map((reference) => resolveAssumptionTarget(icp, reference))
        .filter((target): target is AssumptionTarget => target !== null);
    }
  }
  return guessAssumptionTargets(icp, assumption);
}

/**
 * The hard filter that requires the company to be hiring, if any. Company
 * websites could not prove it: in run 7716f37f it was unknown or failed for
 * all 29 companies researched, because ads live on LinkedIn and job boards.
 */
export function hiringRequirement(hardFilters: string[]): string | null {
  return hardFilters.find((filter) => /\bhir(?:e|es|ing)\b|\bjob\s+(?:ads?|adverts?|openings?|postings?|listings?|vacanc)|\bopen\s+(?:roles|positions|vacancies)\b|\bvacanc(?:y|ies)\b|\brecruiting\s+for\b/i.test(filter)) ?? null;
}
