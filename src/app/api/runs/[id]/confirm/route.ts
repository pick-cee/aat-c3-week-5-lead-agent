import { NextResponse } from "next/server";

import { RunStore } from "@/lib/runs/run-store";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await new RunStore().confirmIcp(id);
    return NextResponse.json({ confirmed: true });
  } catch {
    return NextResponse.json({ error: "This run is no longer waiting for approval. Refresh to see where it is." }, { status: 409 });
  }
}
