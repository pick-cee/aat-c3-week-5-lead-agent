import { NextResponse } from "next/server";
import { z } from "zod";

import { RunStore } from "@/lib/runs/run-store";

// Bounded per request so a mistyped value cannot authorise a large spend.
const schema = z.object({
  searches: z.number().int().min(0).max(4),
  agentUsd: z.number().min(0).max(5),
}).refine((value) => value.searches > 0 || value.agentUsd > 0, { message: "Add at least one search or some AI budget." });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose how much to add: up to 4 searches and up to $5 of AI research at a time." }, { status: 400 });
  const raised = await new RunStore().raiseBudget(id, parsed.data);
  return raised
    ? NextResponse.json({ raised: true })
    : NextResponse.json({ error: "This run is not waiting for a budget decision. Refresh to see where it is." }, { status: 409 });
}
