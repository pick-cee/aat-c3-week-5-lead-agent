import { NextResponse } from "next/server";
import { z } from "zod";

import { advanceRun } from "@/lib/runner/advance-run";
import { sharedSecretMatches } from "@/lib/security/shared-secret";
import { requireServerEnv } from "@/lib/server/env";
import { safeErrorMessage } from "@/lib/agent/redaction";

export const maxDuration = 300;

const bodySchema = z.object({ runId: z.string().uuid().optional() });

async function run(request: Request, body: unknown) {
  const authorization = request.headers.get("authorization");
  const provided = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!sharedSecretMatches(provided, requireServerEnv("RUNNER_SHARED_SECRET"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    return NextResponse.json(await advanceRun(parsed.data));
  } catch (error) {
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return run(request, await request.json().catch(() => ({})));
}

export async function GET(request: Request) {
  return run(request, {});
}
