import { NextResponse } from "next/server";

import { advanceRun } from "@/lib/runner/advance-run";

export const maxDuration = 300;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(await advanceRun({ runId: id }));
  } catch {
    return NextResponse.json({ error: "The runner could not advance this step. The activity log keeps the failure." }, { status: 500 });
  }
}
