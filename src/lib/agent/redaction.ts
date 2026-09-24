const SENSITIVE_KEY = /(authorization|api[-_]?key|secret|token|password|email|phone)/i;

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)/g;

function redactString(value: string): string {
  return value.replace(EMAIL, "[REDACTED_EMAIL]").replace(PHONE, "[REDACTED_PHONE]");
}

export function redactForLog(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map(redactForLog);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactForLog(child),
      ]),
    );
  }

  return value;
}

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  return redactString(message).slice(0, 500);
}
