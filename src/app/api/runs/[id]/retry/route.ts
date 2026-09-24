import { NextResponse } from "next/server";

import { RunStore } from "@/lib/runs/run-store";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const retried = await new RunStore().retry(id);
  return retried
    ? NextResponse.json({ retried: true })
    : NextResponse.json({ error: "Only a stopped run can be retried." }, { status: 409 });
}
