import type { ReactNode } from "react";

import { CANDIDATE_STATUS, FETCH_STATUS, runStatus, type Tone } from "@/lib/ui/labels";

export function Pill({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return <span className={`pill pill-${tone}`} title={title}><span className="pill-dot" />{children}</span>;
}

export function RunStatusPill({ status }: { status: string }) {
  const meta = runStatus(status);
  return <Pill tone={meta.tone} title={meta.hint}>{meta.label}</Pill>;
}

export function CandidateStatusPill({ status }: { status: string }) {
  const meta = CANDIDATE_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Pill tone={meta.tone}>{meta.label}</Pill>;
}

export function FetchStatusPill({ status }: { status: string }) {
  const meta = FETCH_STATUS[status] ?? { label: status, tone: "neutral" as Tone, hint: "" };
  return <Pill tone={meta.tone} title={meta.hint}>{meta.label}</Pill>;
}
