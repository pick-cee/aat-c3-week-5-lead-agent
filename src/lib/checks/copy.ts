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
  removedEvidenceLabels: number;
};

// "(E2, E3, E4)", "[E1]", "(E6 and E7)". The labels are how the founder traces
// a line to its evidence; to the person receiving the email they are noise.
// 35 of the first 88 saved drafts carried them in the text.
const LABEL_GROUP = /[ \t]*[([]\s*E\d{1,3}(?:\s*(?:,|;|&|and)\s*E\d{1,3})*\s*[)\]]/g;
const BARE_LABEL = /\bE\d{1,3}\b/;

/** Removes bracketed evidence labels from text a recipient reads. */
export function stripEvidenceLabels(text: string): { text: string; removed: number } {
  let removed = 0;
  const stripped = text.replace(LABEL_GROUP, () => {
    removed += 1;
    return "";
  });
  if (!removed) return { text, removed };
  return {
    // A removed label can leave "grows ." or a trailing space behind.
    text: stripped.replace(/[ \t]+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").trim(),
    removed,
  };
}

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
  let removedEvidenceLabels = 0;

  const normalized = drafts.map((draft) => {
    const joined = `${draft.subject ?? ""}\n${draft.body}\n${draft.personalization_note}`;
    const count = (joined.match(/—/g) ?? []).length;
    removedEmDashes += count;
    // The personalisation note is the founder's and keeps its labels.
    const subject = draft.subject === undefined ? undefined : stripEvidenceLabels(draft.subject.replaceAll("—", "-"));
    const body = stripEvidenceLabels(draft.body.replaceAll("—", "-"));
    removedEvidenceLabels += (subject?.removed ?? 0) + body.removed;
    return {
      ...draft,
      subject: subject?.text,
      body: body.text,
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
    if (BARE_LABEL.test(content)) {
      errors.push(`${draft.channel === "email" ? `Email ${draft.step}` : "LinkedIn message"} mentions an evidence label in its text; the recipient cannot read it. Put labels only in excerpt_labels`);
    }
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

  return { accepted: errors.length === 0, drafts: normalized, errors, removedEmDashes, removedEvidenceLabels };
}
