import {
  BANNED_OUTREACH_PHRASES,
  MAX_EMAIL_WORDS,
  MAX_LINKEDIN_CHARACTERS,
} from "@/lib/constants";

import type { EvidenceExcerpt } from "./qualification";

export type OutreachDraftInput = {
  channel: "email" | "linkedin";
  step: number;
  subject?: string;
  body: string;
  personalization_note: string;
  excerpt_labels: string[];
};

export type CopyCheckResult = {
  accepted: boolean;
  drafts: OutreachDraftInput[];
  errors: string[];
  removedEmDashes: number;
};

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE = /(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)/;
const FIGURE = /\b\d+(?:[.,]\d+)?%?\b/g;

export function checkOutreachCopy(
  drafts: OutreachDraftInput[],
  excerpts: EvidenceExcerpt[],
  candidateFacts: string[],
  icpFacts: string[],
): CopyCheckResult {
  const errors: string[] = [];
  const excerptByLabel = new Map(excerpts.map((excerpt) => [excerpt.label, excerpt]));
  let removedEmDashes = 0;

  const normalized = drafts.map((draft) => {
    const joined = `${draft.subject ?? ""}\n${draft.body}\n${draft.personalization_note}`;
    const count = (joined.match(/—/g) ?? []).length;
    removedEmDashes += count;
    return {
      ...draft,
      subject: draft.subject?.replaceAll("—", "-"),
      body: draft.body.replaceAll("—", "-"),
      personalization_note: draft.personalization_note.replaceAll("—", "-"),
    };
  });

  const emails = normalized.filter((draft) => draft.channel === "email");
  const linkedin = normalized.filter((draft) => draft.channel === "linkedin");
  if (emails.length !== 3 || linkedin.length !== 1) {
    errors.push("Outreach requires exactly three emails and one LinkedIn message");
  }
  if (!emails.find((draft) => draft.step === 1)?.excerpt_labels.length) {
    errors.push("Email 1 requires at least one evidence citation");
  }

  for (const draft of normalized) {
    const content = `${draft.subject ?? ""} ${draft.body}`;
    if (EMAIL.test(content) || PHONE.test(content)) errors.push("Draft contains personal contact data");
    if (draft.channel === "email" && draft.body.trim().split(/\s+/).length > MAX_EMAIL_WORDS) {
      errors.push(`Email ${draft.step} exceeds ${MAX_EMAIL_WORDS} words`);
    }
    if (draft.channel === "linkedin" && draft.body.length > MAX_LINKEDIN_CHARACTERS) {
      errors.push(`LinkedIn message exceeds ${MAX_LINKEDIN_CHARACTERS} characters`);
    }

    const lower = content.toLowerCase();
    for (const phrase of BANNED_OUTREACH_PHRASES) {
      if (lower.includes(phrase)) errors.push(`Draft contains banned phrase: ${phrase}`);
    }

    const citedText = draft.excerpt_labels
      .map((label) => excerptByLabel.get(label)?.text ?? "")
      .join(" ");
    for (const label of draft.excerpt_labels) {
      if (!excerptByLabel.has(label)) errors.push(`Citation ${label} does not resolve`);
    }
    const allowedFacts = `${citedText} ${candidateFacts.join(" ")} ${icpFacts.join(" ")}`;
    for (const figure of content.match(FIGURE) ?? []) {
      if (!allowedFacts.includes(figure)) errors.push(`Draft figure ${figure} is unsupported`);
    }
  }

  return { accepted: errors.length === 0, drafts: normalized, errors, removedEmDashes };
}
