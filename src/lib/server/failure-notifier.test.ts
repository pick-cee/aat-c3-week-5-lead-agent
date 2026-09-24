import assert from "node:assert/strict";
import { it } from "node:test";

import { notifyRun } from "./failure-notifier";

it("fails visibly without attempting a notification when server configuration is incomplete", async () => {
  const prior = { key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL };
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  try {
    assert.deepEqual(await notifyRun({ to: "founder@example.com", kind: "failure", runId: "run", objective: "UK SaaS", stage: "discover", reason: "failed" }), { sent: false, error: "Notification provider configuration is incomplete" });
  } finally {
    if (prior.key) process.env.RESEND_API_KEY = prior.key;
    if (prior.from) process.env.RESEND_FROM_EMAIL = prior.from;
  }
});
