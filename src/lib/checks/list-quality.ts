export type ListQualityInput = {
  targetLeads: number;
  qualifiedCount: number;
  totalCandidates: number;
  uniqueDomains: number;
  qualifiedWithCompleteEvidence: number;
  qualifiedWithDrafts: number;
  needsReviewCountedAsQualified: number;
};

export function computeListQuality(input: ListQualityInput) {
  const duplicateRate =
    input.totalCandidates === 0
      ? 0
      : (input.totalCandidates - input.uniqueDomains) / input.totalCandidates;
  const evidenceCompleteness =
    input.qualifiedCount === 0
      ? 0
      : input.qualifiedWithCompleteEvidence / input.qualifiedCount;
  const draftCompleteness =
    input.qualifiedCount === 0 ? 0 : input.qualifiedWithDrafts / input.qualifiedCount;

  return {
    qualified_count: input.qualifiedCount,
    target_leads: input.targetLeads,
    target_met: input.qualifiedCount >= input.targetLeads,
    duplicate_rate: duplicateRate,
    evidence_completeness: evidenceCompleteness,
    draft_completeness: draftCompleteness,
    needs_review_counted_as_qualified: input.needsReviewCountedAsQualified,
    passed:
      input.qualifiedCount >= input.targetLeads &&
      duplicateRate === 0 &&
      evidenceCompleteness === 1 &&
      draftCompleteness === 1 &&
      input.needsReviewCountedAsQualified === 0,
  };
}
