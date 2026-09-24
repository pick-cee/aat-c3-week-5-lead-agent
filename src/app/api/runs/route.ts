import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { RunStore } from "@/lib/runs/run-store";

const schema = z.object({
  objective: z.string().trim().min(20).max(2_000),
  submitToken: z.string().min(8).max(200).optional(),
  // Omitted: the workspace default. Empty: no email. Otherwise this run's own recipient.
  notificationEmail: z.string().trim().toLowerCase().email().max(320).or(z.literal("")).optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const badEmail = parsed.error.issues.some((issue) => issue.path[0] === "notificationEmail");
    return NextResponse.json({ error: badEmail ? "That email address does not look right. Fix it or leave it empty." : "Describe the companies you want in at least 20 characters." }, { status: 400 });
  }
  try {
    const email = parsed.data.notificationEmail;
    const id = await new RunStore().createRun(parsed.data.objective, parsed.data.submitToken ?? randomUUID(), {
      email: email === undefined ? undefined : email || null,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "The run could not be created. Nothing was spent." }, { status: 500 });
  }
}
