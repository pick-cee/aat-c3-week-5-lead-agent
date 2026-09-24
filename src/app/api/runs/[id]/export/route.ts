import { getDashboard, type DashboardCandidate } from "@/lib/runs/dashboard";
import { isDiscoverySource } from "@/lib/ui/labels";

function csv(value: unknown): string {
  // A leading = + - @ turns a cell into a formula in spreadsheet apps.
  const text = String(value ?? "");
  return `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
}

function payload(candidate: DashboardCandidate, key: string): string {
  const value = candidate.discovery_payload?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function sourceUrls(candidate: DashboardCandidate): string {
  return candidate.sources.map((source) => (isDiscoverySource(source.url) ? "LinkedIn company record (Apify)" : source.url)).join(" | ");
}

function draft(candidate: DashboardCandidate, channel: string, step: number) {
  return candidate.drafts.find((item) => item.channel === channel && item.step === step);
}

function reason(candidate: DashboardCandidate): string {
  const q = candidate.qualification;
  if (!q) return candidate.skip_reason ?? "";
  const failed = q.hard_filter_results.filter((result) => result.verdict === "fail").map((result) => `Did not meet: ${result.criterion}`);
  const downgrades = q.checks?.downgrades ?? [];
  return [...failed, ...downgrades, ...q.concerns.map((concern) => concern.text)].join(" | ") || q.source_summary;
}

function claimLines(claims: Array<{ text: string; excerpt_labels?: string[] }>): string[] {
  return claims.map((claim) => `- ${claim.text} (${(claim.excerpt_labels ?? []).join(", ")})`);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getDashboard(id);
  if (!data) return new Response("Run not found", { status: 404 });
  const kind = new URL(request.url).searchParams.get("kind") ?? "qualified";
  const qualified = data.candidates.filter((candidate) => candidate.status === "qualified");

  if (kind === "sample") {
    const icp = data.run.refined_icp ?? {};
    const list = (key: string) => (Array.isArray(icp[key]) ? (icp[key] as unknown[]).map(String) : []);
    const body = [
      "# Koya Talent outreach sample pack",
      "",
      `**Qualification objective:** ${data.run.objective}`,
      "",
      `**Outcome:** ${qualified.length} qualified of ${data.run.target_leads} targeted (${data.run.status.replaceAll("_", " ")}). Drafts are for human review; nothing was sent.`,
      "",
      "## Confirmed criteria",
      "",
      "Must have:",
      ...list("hard_filters").map((item) => `- ${item}`),
      "",
      "Nice to have:",
      ...list("soft_preferences").map((item) => `- ${item}`),
      ...qualified.flatMap((lead) => {
        const q = lead.qualification;
        const excerptsById = new Map(lead.excerpts.map((excerpt) => [excerpt.id, excerpt]));
        const cited = new Set([...(q?.fit_reasons ?? []), ...(q?.concerns ?? [])].flatMap((claim) => claim.excerpt_ids ?? []));
        return [
          "",
          `## ${lead.company_name} (${lead.domain})`,
          "",
          [payload(lead, "location"), payload(lead, "headcount"), payload(lead, "industry")].filter(Boolean).join(" · "),
          "",
          `**Confidence:** ${q ? Math.round(Number(q.confidence) * 100) : "-"} / 100`,
          q?.why_now ? `**Why now:** ${q.why_now}` : "",
          "",
          "### Source context",
          "",
          q?.source_summary ?? "",
          "",
          ...[...cited].map((excerptId) => excerptsById.get(excerptId)).filter(Boolean).map((excerpt) => `> [E${excerpt!.ordinal}] ${excerpt!.text.replace(/\n+/g, " ")}`),
          "",
          `Sources: ${sourceUrls(lead)}`,
          "",
          "### Qualification reasoning",
          "",
          ...(q ? q.hard_filter_results.map((result) => `- ${result.verdict === "pass" ? "Met" : result.verdict === "fail" ? "Not met" : "Unproven"}: ${result.criterion} (${(result.excerpt_labels ?? []).join(", ") || "no evidence"})`) : []),
          ...(q ? claimLines(q.fit_reasons) : []),
          ...(q?.concerns.length ? ["", "Concerns:", ...claimLines(q.concerns)] : []),
          "",
          "### Outreach sequence",
          ...[1, 2, 3].flatMap((step) => {
            const item = draft(lead, "email", step);
            return item ? ["", `**Email ${step}: ${item.subject ?? ""}**`, "", item.body, "", `_Personalised from: ${item.personalization_note}_`] : [];
          }),
          ...(draft(lead, "linkedin", 1) ? ["", "**LinkedIn message**", "", draft(lead, "linkedin", 1)!.body] : []),
        ];
      }),
    ].join("\n");
    return new Response(body, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="koya-${id.slice(0, 8)}-outreach-pack.md"` } });
  }

  if (kind === "rejected") {
    const rows = data.candidates.filter((candidate) => ["not_qualified", "needs_review", "failed", "skipped"].includes(candidate.status));
    const body = [
      ["company_name", "domain", "status", "location", "size", "industry", "reason", "source_summary", "source_urls"].join(","),
      ...rows.map((candidate) => [candidate.company_name, candidate.domain, candidate.status, payload(candidate, "location"), payload(candidate, "headcount"), payload(candidate, "industry"), reason(candidate), candidate.qualification?.source_summary ?? "", sourceUrls(candidate)].map(csv).join(",")),
    ].join("\r\n");
    return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="koya-${id.slice(0, 8)}-rejected-and-review.csv"` } });
  }

  const body = [
    ["company_name", "domain", "location", "size", "industry", "confidence", "why_now", "fit_reasons", "concerns", "must_haves", "source_summary", "source_urls",
      "email_1_subject", "email_1_body", "email_2_subject", "email_2_body", "email_3_subject", "email_3_body", "linkedin_message"].join(","),
    ...qualified.map((candidate) => {
      const q = candidate.qualification;
      return [
        candidate.company_name, candidate.domain, payload(candidate, "location"), payload(candidate, "headcount"), payload(candidate, "industry"),
        q?.confidence ?? "", q?.why_now ?? "",
        (q?.fit_reasons ?? []).map((claim) => claim.text).join(" | "),
        (q?.concerns ?? []).map((claim) => claim.text).join(" | "),
        (q?.hard_filter_results ?? []).map((result) => `${result.verdict}: ${result.criterion}`).join(" | "),
        q?.source_summary ?? "", sourceUrls(candidate),
        draft(candidate, "email", 1)?.subject ?? "", draft(candidate, "email", 1)?.body ?? "",
        draft(candidate, "email", 2)?.subject ?? "", draft(candidate, "email", 2)?.body ?? "",
        draft(candidate, "email", 3)?.subject ?? "", draft(candidate, "email", 3)?.body ?? "",
        draft(candidate, "linkedin", 1)?.body ?? "",
      ].map(csv).join(",");
    }),
  ].join("\r\n");
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="koya-${id.slice(0, 8)}-qualified.csv"` } });
}
