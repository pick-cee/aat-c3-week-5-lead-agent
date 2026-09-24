import { NextResponse } from "next/server";

import { RunStore } from "@/lib/runs/run-store";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const restored = await new RunStore().restore(id);
  return restored
    ? NextResponse.json({ restored: true })
    : NextResponse.json({ error: "This run is not in the recycle bin." }, { status: 404 });
}
