import { NextResponse } from "next/server";
import { z } from "zod";

import { RunStore } from "@/lib/runs/run-store";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(320).or(z.literal("")) });

// One run's recipient only; the workspace default in Notifications is untouched.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That email address does not look right. Fix it or leave it empty to turn emails off." }, { status: 400 });
  const updated = await new RunStore().setRunRecipient(id, parsed.data.email || null);
  return updated
    ? NextResponse.json({ saved: true, email: parsed.data.email || null })
    : NextResponse.json({ error: "This run is in the recycle bin or does not exist." }, { status: 404 });
}
