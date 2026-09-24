import { NextResponse } from "next/server";

import { TEST_EMAIL_COOLDOWN_SECONDS } from "@/lib/constants";
import { RunStore } from "@/lib/runs/run-store";
import { notificationConfigured, sendTestEmail } from "@/lib/server/failure-notifier";

// Sends only to the saved address, at most once per cooldown, so an open
// endpoint cannot be used to mail arbitrary people from our domain.
export async function POST() {
  if (!notificationConfigured()) {
    return NextResponse.json({ error: "Email delivery is not set up on the server yet (RESEND_API_KEY and RESEND_FROM_EMAIL)." }, { status: 503 });
  }
  const to = await new RunStore().reserveTestEmail();
  if (!to) {
    return NextResponse.json({ error: `Save an email address first, and wait ${TEST_EMAIL_COOLDOWN_SECONDS} seconds between test emails.` }, { status: 429 });
  }
  const result = await sendTestEmail(to);
  return result.sent
    ? NextResponse.json({ sent: true, to })
    : NextResponse.json({ error: `The email provider did not accept the message: ${result.error ?? "unknown reason"}` }, { status: 502 });
}
