import { NextResponse } from "next/server";
import { z } from "zod";

import { RunStore } from "@/lib/runs/run-store";
import { notificationConfigured } from "@/lib/server/failure-notifier";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(320).or(z.literal("")),
  onSuccess: z.boolean(),
  onFailure: z.boolean(),
});

export async function GET() {
  const settings = await new RunStore().getWorkspaceSettings();
  return NextResponse.json({ ...settings, delivery_configured: notificationConfigured() });
}

export async function PUT(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address, or leave it empty to turn emails off." }, { status: 400 });
  try {
    const applied = await new RunStore().saveWorkspaceSettings({
      email: parsed.data.email || null,
      onSuccess: parsed.data.onSuccess,
      onFailure: parsed.data.onFailure,
    });
    return NextResponse.json({ saved: true, applied_to_active_runs: applied });
  } catch {
    return NextResponse.json({ error: "Your notification settings could not be saved. Try again." }, { status: 500 });
  }
}
