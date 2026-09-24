import { NextResponse } from "next/server";
import { z } from "zod";

import { checkRefinedIcp, sanitizeAssumptionLinks } from "@/lib/checks/icp";
import { getDashboard } from "@/lib/runs/dashboard";
import { RunStore } from "@/lib/runs/run-store";

const icpSchema = z.object({
  target_company_type: z.string().trim().min(1), industries: z.array(z.string().trim().min(1)), geography: z.array(z.string().trim().min(1)),
  headcount_range: z.string().trim().min(1), buyer_persona: z.string().trim().min(1), business_problem: z.string().trim().min(1),
  hard_filters: z.array(z.string().trim().min(1)).min(1), soft_preferences: z.array(z.string().trim().min(1)),
  disqualifiers: z.array(z.string().trim().min(1)), assumptions: z.array(z.string().trim().min(1)),
  assumption_links: z.array(z.object({ assumption: z.string(), related: z.array(z.string()).max(20) })).max(50).optional(),
});

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dashboard = await getDashboard(id);
  return dashboard ? NextResponse.json(dashboard) : NextResponse.json({ error: "Run not found" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = icpSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Every section needs an answer and at least one must-have criterion is required." }, { status: 400 });
  const icp = { ...parsed.data, ...(parsed.data.assumption_links ? { assumption_links: sanitizeAssumptionLinks(parsed.data) } : {}) };
  const icpErrors = checkRefinedIcp(icp);
  if (icpErrors.length) return NextResponse.json({ error: icpErrors.join(". ") }, { status: 400 });
  try { await new RunStore().updateIcp(id, icp); return NextResponse.json({ saved: true }); }
  catch { return NextResponse.json({ error: "Criteria can only be edited before research starts." }, { status: 409 }); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deleted = await new RunStore().softDelete(id);
  return deleted
    ? NextResponse.json({ deleted: true })
    : NextResponse.json({ error: "This run was already moved to the recycle bin." }, { status: 404 });
}
