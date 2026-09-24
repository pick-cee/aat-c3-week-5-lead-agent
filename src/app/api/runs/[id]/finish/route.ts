import { NextResponse } from "next/server";

import { RunStore } from "@/lib/runs/run-store";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const finished = await new RunStore().finishRun(id);
  return finished
    ? NextResponse.json({ finished: true })
    : NextResponse.json({ error: "This run is not waiting for a budget decision. Refresh to see where it is." }, { status: 409 });
}
