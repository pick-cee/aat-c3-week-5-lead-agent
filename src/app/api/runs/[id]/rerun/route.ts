import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { RunStore } from "@/lib/runs/run-store";

const schema = z.object({ submitToken: z.string().min(8).max(200).optional() });

// The copy starts at the approval gate, so it cannot spend anything until
// someone confirms it, exactly like a brand-new run.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const created = await new RunStore().createRerun(id, parsed.data.submitToken ?? randomUUID());
    return NextResponse.json(created, { status: 201 });
  } catch {
    return NextResponse.json({ error: "This run has no confirmed criteria to reuse yet." }, { status: 409 });
  }
}
