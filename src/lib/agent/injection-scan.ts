const PATTERNS = [
  /ignore\s+(?:all\s+)?previous/i,
  /system\s+prompt/i,
  /disregard\s+(?:all\s+)?(?:instructions|rules)/i,
  /you\s+are\s+now/i,
  /export\s+(?:your\s+)?(?:secrets|data)/i,
  /api\s*key/i,
  /(?:email|contact|send)\s+(?:this|someone|me)/i,
];

export function scanForPromptInjection(text: string): string[] {
  return PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}
