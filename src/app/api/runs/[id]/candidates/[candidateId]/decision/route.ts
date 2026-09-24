import { NextResponse } from "next/server";
import { z } from "zod";

import { RunStore } from "@/lib/runs/run-store";

const schema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(1000).default(""),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string; candidateId: string }> }) {
  const { id, candidateId } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose approve or reject." }, { status: 400 });
  const result = await new RunStore().decideCandidate(id, candidateId, parsed.data.decision, parsed.data.note);
  return result.ok
    ? NextResponse.json({ decided: true })
    : NextResponse.json({ error: "This lead has already been decided. Refresh to see its current status." }, { status: 409 });
}
