export type CitedClaim = {
  text: string;
  excerpt_labels: string[];
};

export type HardFilterResult = {
  criterion: string;
  verdict: "pass" | "fail" | "unknown";
  excerpt_labels: string[];
};

export type QualificationInput = {
  status: "qualified" | "not_qualified" | "needs_review";
  confidence: number;
  fit_reasons: CitedClaim[];
  concerns: CitedClaim[];
  hard_filter_results: HardFilterResult[];
};

export type EvidenceExcerpt = { id: string; label: string; text: string };

export type QualificationCheckResult = {
  accepted: boolean;
  status: QualificationInput["status"];
  errors: string[];
  /** Why the stored status differs from the one the agent asked for. */
  downgrades: string[];
  excerptIdsByLabel: Record<string, string>;
};

const FIGURE = /\b\d+(?:[.,]\d+)?%?\b/g;

export function checkQualification(
  input: QualificationInput,
  hardFilters: string[],
  excerpts: EvidenceExcerpt[],
  hasOkSource: boolean,
  // The founder's own criteria. "Fits the 10-50 employee range" quotes the
  // criterion, not a company fact; run 6cd3a95a rejected 14 of 30 decisions
  // for echoing "10" from "10-50" while the evidence said "11-50".
  criteriaText = "",
): QualificationCheckResult {
  const errors: string[] = [];
  const excerptByLabel = new Map(excerpts.map((excerpt) => [excerpt.label, excerpt]));
  const excerptIdsByLabel = Object.fromEntries(
    excerpts.map((excerpt) => [excerpt.label, excerpt.id]),
  );

  for (const claim of [...input.fit_reasons, ...input.concerns]) {
    if (claim.excerpt_labels.length === 0) {
      errors.push(`Claim has no citation: ${claim.text}`);
      continue;
    }

    const cited = claim.excerpt_labels.map((label) => excerptByLabel.get(label));
    for (const [index, excerpt] of cited.entries()) {
      if (!excerpt) errors.push(`Citation ${claim.excerpt_labels[index]} does not resolve`);
    }

    const citedText = cited.flatMap((excerpt) => (excerpt ? [excerpt.text] : [])).join(" ");
    const criteriaFigures = new Set(criteriaText.match(FIGURE) ?? []);
    for (const figure of claim.text.match(FIGURE) ?? []) {
      if (!citedText.includes(figure) && !criteriaFigures.has(figure)) {
        errors.push(`Figure ${figure} is absent from the cited evidence`);
      }
    }
  }

  const resultsByCriterion = new Map(
    input.hard_filter_results.map((result) => [result.criterion.trim().toLowerCase(), result]),
  );
  for (const hardFilter of hardFilters) {
    if (!resultsByCriterion.has(hardFilter.trim().toLowerCase())) {
      errors.push(`Missing hard-filter verdict: ${hardFilter}`);
    }
  }

  const unproven: string[] = [];
  for (const result of input.hard_filter_results) {
    for (const label of result.excerpt_labels) {
      if (!excerptByLabel.has(label)) errors.push(`Hard-filter citation ${label} does not resolve`);
    }
    // A verdict with nothing behind it is a guess, and a guess is unknown.
    if (result.verdict !== "unknown" && result.excerpt_labels.length === 0) {
      unproven.push(`Hard filter "${result.criterion}" had a ${result.verdict} verdict with no cited evidence`);
    }
    if (result.verdict === "unknown") {
      unproven.push(`Hard filter "${result.criterion}" could not be confirmed from evidence`);
    }
  }

  const downgrades: string[] = [];
  let status = input.status;
  if (status === "qualified") {
    downgrades.push(...unproven);
    if (input.hard_filter_results.some((result) => result.verdict === "fail")) downgrades.push("A hard filter failed");
    if (input.confidence > 0.8 && input.concerns.length > 0) downgrades.push("High confidence was recorded alongside open concerns");
    if (input.confidence < 0.4) downgrades.push("Confidence is too low to count as qualified");
  } else if (status === "not_qualified") {
    // A cited failure is a definitive rejection. Without one, an unknown
    // filter means the rejection itself is unproven.
    const citedFail = input.hard_filter_results.some((result) => result.verdict === "fail" && result.excerpt_labels.length > 0);
    if (!citedFail) downgrades.push(...unproven);
  }
  if (downgrades.length) status = "needs_review";

  if (input.status === "qualified") {
    if (input.fit_reasons.length < 2) {
      errors.push("Qualified leads require at least two cited fit reasons");
    }
    if (!hasOkSource) errors.push("Qualified leads require at least one successfully read page from the company's own website");
  }

  return { accepted: errors.length === 0, status, errors, downgrades, excerptIdsByLabel };
}
