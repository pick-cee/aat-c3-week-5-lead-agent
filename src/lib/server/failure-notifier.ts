import { safeErrorMessage } from "@/lib/agent/redaction";

type SendResult = { sent: boolean; error?: string };

const STAGE_WORDS: Record<string, string> = {
  refine_icp: "drafting your criteria",
  discover: "finding companies",
  qualify_one: "researching companies",
  draft_one: "writing outreach drafts",
};

export function notificationConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM_EMAIL?.trim());
}

function runLink(runId: string): string | null {
  const base = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");
  return base ? `${base}/runs/${runId}` : null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

async function send(input: { to: string; subject: string; lines: string[]; link?: string | null }): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) return { sent: false, error: "Notification provider configuration is incomplete" };
  const text = [...input.lines, input.link ? `Open it: ${input.link}` : "Open the Koya workspace to review it.", "", "Koya never sends outreach on your behalf. Every draft waits for you."].join("\n\n");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.55;color:#14231e;max-width:520px">
${input.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n")}
${input.link ? `<p><a href="${escapeHtml(input.link)}" style="display:inline-block;background:#132d25;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open the run</a></p>` : "<p>Open the Koya workspace to review it.</p>"}
<p style="color:#66736e;font-size:13px">Koya never sends outreach on your behalf. Every draft waits for you.</p></div>`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, text, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { sent: false, error: `Notification provider returned HTTP ${response.status}` };
    return { sent: true };
  } catch (error) {
    return { sent: false, error: safeErrorMessage(error) };
  }
}

function shortBrief(objective: string): string {
  const oneLine = objective.replace(/\s+/g, " ").trim();
  return oneLine.length > 90 ? `${oneLine.slice(0, 87)}...` : oneLine;
}

export async function notifyRun(input: { to: string; kind: "success" | "failure" | "budget"; runId: string; objective: string; stage: string; reason: string }): Promise<SendResult> {
  const brief = shortBrief(input.objective);
  if (input.kind === "budget") {
    return send({
      to: input.to,
      subject: `Your lead research needs a decision: ${brief}`,
      lines: [
        `Research brief: ${brief}`,
        `Koya paused instead of stopping. ${input.reason}`,
        "Open the run to add budget and keep going, or finish with what it has found. Nothing more is spent until you choose.",
      ],
      link: runLink(input.runId),
    });
  }
  if (input.kind === "success") {
    return send({
      to: input.to,
      subject: `Your lead research is ready: ${brief}`,
      lines: [`Research brief: ${brief}`, input.reason],
      link: runLink(input.runId),
    });
  }
  return send({
    to: input.to,
    subject: `Your lead research stopped: ${brief}`,
    lines: [
      `Research brief: ${brief}`,
      `Koya stopped while ${STAGE_WORDS[input.stage] ?? "working"}. Everything found before that point is saved.`,
      `Reason: ${input.reason}`,
      "Open the run to retry the step or start again with the same criteria.",
    ],
    link: runLink(input.runId),
  });
}

export async function sendTestEmail(to: string): Promise<SendResult> {
  return send({
    to,
    subject: "Koya notifications are working",
    lines: ["This is a test from your Koya workspace. You will get an email like this when a research run finishes or stops."],
    link: process.env.APP_BASE_URL?.trim() ? `${process.env.APP_BASE_URL.trim().replace(/\/+$/, "")}/dashboard` : null,
  });
}
