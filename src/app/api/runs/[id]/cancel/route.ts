import { NextResponse } from "next/server";

import { RunStore } from "@/lib/runs/run-store";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cancelled = await new RunStore().cancel(id);
  return cancelled
    ? NextResponse.json({ cancelled: true })
    : NextResponse.json({ error: "This run has already finished, so there is nothing to stop." }, { status: 409 });
}
