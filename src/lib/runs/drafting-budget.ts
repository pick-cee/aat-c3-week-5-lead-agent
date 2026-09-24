import { DRAFT_RESERVE_PER_LEAD_USD, MAX_DRAFT_ATTEMPTS } from "@/lib/constants";

/** The most drafting outreach for this many leads can cost. */
export function draftingCost(leads: number): number {
  return Number((leads * DRAFT_RESERVE_PER_LEAD_USD).toFixed(2));
}

/**
 * How much AI budget finishing must add so every qualified lead gets its
 * outreach. Shared by the Finish button, which states it before it is pressed,
 * and the server, which adds exactly this.
 */
export function draftingTopUp(budgetUsd: number, usedUsd: number, leads: number): number {
  const shortfall = draftingCost(leads) - (budgetUsd - usedUsd);
  return shortfall > 0 ? Math.ceil(shortfall * 100) / 100 : 0;
}

/** Qualified leads that still need drafts and have not used up their attempts. */
export function leadsAwaitingDrafts(candidates: Array<{ draft_attempts: number; drafts: unknown[]; qualification?: { status: string } }>): number {
  return candidates.filter((candidate) => candidate.qualification?.status === "qualified"
    && candidate.drafts.length < 4 && candidate.draft_attempts < MAX_DRAFT_ATTEMPTS).length;
}
